// Each capture owns its journal, tracks and writer; exports run one at a time.
const jobs = new Map();
const active = new Map(); // Tab ID -> capture; finished exports stay in jobs.
const captureLimit = 2;
let savingJob = null, pumping = false, preparing = false, root, sessionsRoot;
const exportQueue = [];
function snapshot() {
  const captures = [...active.values()].map(job=>({id:job.id,...job.session.snapshot(),tabId:job.tabId}));
  const foreground = captures.find(capture=>['recording','rotating'].includes(capture.phase)) || captures[0];
  return {
    ...(foreground || {phase:'idle',bytes:0}),captures,captureLimit,preparing,
    jobs:[...jobs.values()].filter(job=>!isActive(job)).flatMap(job=>{
      const state = job.session.snapshot();
      return state.phase === 'idle' ? [] : [{id:job.id,...state,error:job.queueError || state.error || '',phase:job.queued ? 'queued' : state.phase}];
    })
  };
}
function notify() {
  const state = snapshot();
  chrome.runtime.sendMessage({target:'background',type:'state',phase:state.phase === 'idle' && state.jobs.some(job=>job.phase !== 'ready') ? 'saving' : state.phase,error:state.error || ''}).catch(()=>{});
}
function isActive(job) { return active.get(job.tabId) === job; }
function detach(job) { if (isActive(job)) active.delete(job.tabId); }
function addSession(id,sessionRoot,legacy = false,tabId = null) {
  const job = {id,legacy,tabId,queued:false,running:false,finish:null,session:null};
  job.session = createRecordingSession({root:sessionRoot,onChange:state=>{
    if (['ready','error'].includes(state.phase)) detach(job);
    if (job.running && ['ready','idle'].includes(state.phase)) job.finish?.();
    notify();
  },onFinalized:()=>{
    detach(job);
    if (job.session.snapshot().bytes) enqueue(job);
    notify();
  }});
  jobs.set(id,job); return job;
}
const initialized = (async()=>{
  root = await navigator.storage.getDirectory();
  const legacy = addSession('legacy',root,true); await legacy.session.ready;
  if (legacy.session.snapshot().phase === 'idle') jobs.delete(legacy.id);
  sessionsRoot = await root.getDirectoryHandle('recording-sessions',{create:true});
  for await (const [name,handle] of sessionsRoot.entries()) {
    if (handle.kind !== 'directory' || !/^rec-[0-9a-f-]+$/.test(name)) continue;
    const job = addSession(name,handle); await job.session.ready;
    if (job.session.snapshot().phase === 'idle') { jobs.delete(name); await sessionsRoot.removeEntry(name,{recursive:true}); }
  }
  notify();
})();
function enqueue(job,segments = false) {
  if (job.queued || job.running) throw new Error('這部影片已在背景儲存，請稍候。');
  job.queueError = ''; job.queued = true; exportQueue.push({job,segments}); notify();
  void pump();
}
async function cleanup(job) {
  if (job.session.snapshot().phase !== 'idle') return;
  if (!job.legacy) await sessionsRoot.removeEntry(job.id,{recursive:true});
  jobs.delete(job.id);
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (exportQueue.length) {
      const {job,segments} = exportQueue.shift();
      job.queued = false; job.running = true; savingJob = job;
      const finished = new Promise(resolve=>{job.finish = resolve});
      try {
        await job.session.handle({type:segments ? 'save-segments' : 'download'});
        if (!['ready','idle'].includes(job.session.snapshot().phase)) await finished;
        await cleanup(job);
      } catch (error) { job.queueError = error.message; }
      finally { job.running = false; job.finish = null; savingJob = null; notify(); }
    }
  } finally { pumping = false; }
}
async function handle(message) {
  await initialized;
  switch (message.type) {
    case 'status': return snapshot();
    case 'start': {
      const {tabId} = message;
      if (!Number.isInteger(tabId)) throw new Error('請選擇要錄製的分頁。');
      if (active.has(tabId)) throw new Error('這個分頁已在錄影。');
      if (preparing) throw new Error('正在準備錄影，請稍候。');
      if (active.size >= captureLimit) throw new Error('已同時錄製兩個分頁，請先停止其中一個。');
      preparing = true;
      let job;
      try {
        const id = 'rec-' + crypto.randomUUID();
        const directory = await sessionsRoot.getDirectoryHandle(id,{create:true});
        job = addSession(id,directory,false,tabId); await job.session.ready; active.set(tabId,job);
        await job.session.handle(message); return snapshot();
      } catch (error) { if (job) detach(job); throw error; }
      finally { preparing = false; notify(); }
    }
    case 'monitor-off': {
      await active.get(message.tabId)?.session.handle(message);
      return snapshot();
    }
    case 'stop': {
      const job = active.get(message.tabId);
      if (!job || (message.captureId && message.captureId !== job.id)) throw new Error('這個分頁已沒有進行中的錄影。');
      await job.session.handle(message); return snapshot();
    }
    case 'download-ended': if (savingJob) await savingJob.session.handle(message); return snapshot();
    case 'download': case 'save-segments': case 'discard': {
      const job = message.jobId ? jobs.get(message.jobId) : [...jobs.values()].find(job=>!isActive(job) && job.session.snapshot().phase === 'ready');
      if (!job || isActive(job)) throw new Error('找不到待儲存的影片。');
      if (job.queued || job.running) throw new Error('影片正在背景儲存，請稍候。');
      if (message.type === 'discard') { await job.session.handle(message); await cleanup(job); notify(); }
      else enqueue(job,message.type === 'save-segments');
      return snapshot();
    }
    default: throw new Error('未知操作。');
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (message.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  handle(message).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));
  return true;
});
