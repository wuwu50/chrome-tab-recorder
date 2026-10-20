// Each capture owns its journal, tracks and writer; exports run one at a time.
const jobs = new Map();
let active = null, savingJob = null, pumping = false, preparing = false, root, sessionsRoot;
const exportQueue = [];
function snapshot() {
  return {...(active?.session.snapshot() || {phase:'idle',bytes:0}),jobs:[...jobs.values()].filter(job=>job !== active && job.session.snapshot().phase !== 'idle').map(job=>({id:job.id,...job.session.snapshot(),error:job.queueError || job.session.snapshot().error || '',phase:job.queued ? 'queued' : job.session.snapshot().phase})),preparing};
}
function notify() {
  const state = snapshot();
  chrome.runtime.sendMessage({target:'background',type:'state',phase:state.phase === 'idle' && state.jobs.some(job=>job.phase !== 'ready') ? 'saving' : state.phase,error:state.error || ''}).catch(()=>{});
}
function addSession(id,sessionRoot,legacy = false) {
  const job = {id,legacy,queued:false,running:false,finish:null,session:null};
  job.session = createRecordingSession({root:sessionRoot,onChange:state=>{
    if (active === job && ['ready','error'].includes(state.phase)) active = null;
    if (job.running && ['ready','idle'].includes(state.phase)) job.finish?.();
    notify();
  },onFinalized:()=>{
    if (active === job) active = null;
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
      if (active || preparing) throw new Error('請先停止目前錄影，等待擷取結束。背景儲存不影響下一次錄影。');
      preparing = true;
      let job;
      try {
        const id = 'rec-' + crypto.randomUUID();
        const directory = await sessionsRoot.getDirectoryHandle(id,{create:true});
        job = addSession(id,directory); await job.session.ready; active = job;
        await job.session.handle(message); return snapshot();
      } catch (error) { if (active === job) active = null; throw error; }
      finally { preparing = false; notify(); }
    }
    case 'monitor-off': if (active) await active.session.handle(message); return snapshot();
    case 'stop':
      if (!active) throw new Error('目前沒有進行中的錄影。');
      await active.session.handle(message); return snapshot();
    case 'download-ended': if (savingJob) await savingJob.session.handle(message); return snapshot();
    case 'download': case 'save-segments': case 'discard': {
      const job = message.jobId ? jobs.get(message.jobId) : [...jobs.values()].find(job=>job !== active && job.session.snapshot().phase === 'ready');
      if (!job || job === active) throw new Error('找不到待儲存的影片。');
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
