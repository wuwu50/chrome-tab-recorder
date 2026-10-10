let state = {phase:'idle',bytes:0};
let media, audio, recorder, root, fileHandle, writer, blobUrl;
let writes = Promise.resolve();
let writeError = null;
let stopping = null;
let filename;
const tempName = 'recording.tmp';
const mimeTypes = ['video/mp4;codecs=avc1,mp4a.40.2','video/mp4'];
const profiles = {
  normal:{fps:30,bitrate:4000000},high:{fps:30,bitrate:8000000},
  '1080p60':{width:1920,height:1080,fps:60,bitrate:16000000},
  '1080p120':{width:1920,height:1080,fps:120,bitrate:32000000}
};
function notify() {
  chrome.runtime.sendMessage({target:'background',type:'state',phase:state.phase,error:state.error || ''}).catch(() => {});
}
async function releaseMedia() {
  if (media) {
    const restored = await chrome.runtime.sendMessage({target:'background',type:'restore-audio'}).catch(() => null);
    if (!restored?.ok) state.error = '無法確認分頁靜音已恢復，請檢查 Chrome 分頁的靜音狀態。';
  }
  media?.getTracks().forEach(track => track.stop());
  media = null;
  if (audio) { await audio.close().catch(() => {}); audio = null; }
}
async function discard() {
  if (!['ready','idle','error'].includes(state.phase)) throw new Error('請先停止錄影。');
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  if (root) await root.removeEntry(tempName).catch(() => {});
  fileHandle = null;
  state = {phase:'idle',bytes:0};
  notify();
}
async function start(message) {
  if (!['idle','error'].includes(state.phase)) throw new Error('已有錄影或尚未儲存的影片。');
  state = {phase:'starting',bytes:0,title:message.title,tabId:message.tabId};
  notify();
  try {
    const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('此 Chrome 沒有可用的 MP4 編碼器，請更新 Chrome 後再錄影。');
    root = await navigator.storage.getDirectory();
    fileHandle = await root.getFileHandle(tempName,{create:true});
    writer = await fileHandle.createWritable();
    writes = Promise.resolve();
    writeError = null;
    stopping = null;
    const profile = profiles[message.quality || 'normal'];
    if (!profile) throw new Error('不支援的錄影設定。');
    const videoConstraints = {chromeMediaSource:'tab',chromeMediaSourceId:message.streamId,maxFrameRate:profile.fps};
    if (profile.width) Object.assign(videoConstraints,{minWidth:profile.width,maxWidth:profile.width,minHeight:profile.height,maxHeight:profile.height,minFrameRate:profile.fps});
    media = await navigator.mediaDevices.getUserMedia({
      audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId}},
      video:{mandatory:videoConstraints}
    });
    if (!media.getVideoTracks().length) throw new Error('沒有取得分頁畫面。');
    const settings = media.getVideoTracks()[0].getSettings();
    if (profile.width && (settings.width !== profile.width || settings.height !== profile.height || !(settings.frameRate >= profile.fps - 0.01))) {
      throw new Error(`Chrome 未提供 ${profile.width}×${profile.height} / ${profile.fps} FPS 擷取設定（回報 ${settings.width || '?'}×${settings.height || '?'} / ${settings.frameRate || '?'} FPS）。請改選較低設定。`);
    }
    state.captureFormat = `${settings.width || '?'}×${settings.height || '?'} / ${settings.frameRate || '?'} FPS`;
    state.requestedFps = profile.fps;
    const prepared = await chrome.runtime.sendMessage({target:'background',type:'prepare-audio',tabId:message.tabId});
    if (!prepared?.ok) throw new Error(prepared?.error || '無法準備分頁音訊。');
    state.monitorAudio = message.monitorAudio === true && !prepared.data?.originallyMuted;
    state.audioMode = state.monitorAudio ? '錄音並播放到喇叭' : '安靜錄影，持續錄入分頁音訊';
    if (state.monitorAudio && media.getAudioTracks().length) {
      audio = new AudioContext();
      audio.createMediaStreamSource(media).connect(audio.destination);
      await audio.resume();
    }
    recorder = new MediaRecorder(media,{mimeType,videoBitsPerSecond:profile.bitrate,audioBitsPerSecond:192000});
    if (!recorder.mimeType.toLowerCase().startsWith('video/mp4')) throw new Error('編碼器未使用 MP4，已取消錄影。');
    const stamp = new Date().toLocaleString('sv-SE').replace(/[^0-9]/g,'');
    filename = `分頁錄影-${stamp}.mp4`;
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      writes = writes.then(async () => {
        if (writeError) return;
        await writer.write(event.data);
        state.bytes += event.data.size;
      }).catch(error => {
        writeError = error;
        state.error = `暫存寫入失敗：${error.message}；已寫入的部分會嘗試儲存。`;
        stop().catch(() => {});
      });
    };
    recorder.onerror = event => {
      state.error = `編碼失敗：${event.error?.message || '未知原因'}；嘗試儲存已錄製的部分。`;
      stop().catch(() => {});
    };
    // Assign before start, so automatically ended captures also finalize the file.
    recorder.onstop = () => finalize().catch(error => {
      state.phase = 'error'; state.error = error.message; notify();
    });
    for (const track of media.getTracks()) track.addEventListener('ended',() => {
      if (state.phase === 'recording') stop().catch(() => {});
    });
    recorder.start(1000);
    state.phase = 'recording'; state.startedAt = Date.now();
    notify();
    return {...state};
  } catch (error) {
    await releaseMedia();
    if (writer) await writer.abort().catch(() => {});
    writer = null;
    state.phase = 'error'; state.error = `無法開始錄影：${error.message}`;
    notify();
    throw new Error(state.error);
  }
}
async function stop() {
  if (stopping) return stopping;
  if (!recorder || !['recording','saving'].includes(state.phase)) throw new Error('目前沒有進行中的錄影。');
  state.phase = 'saving'; state.endedAt = Date.now(); notify();
  if (recorder.state !== 'inactive') recorder.stop();
  // onstop performs finalization once the final dataavailable event arrives.
  return {...state};
}
async function finalize() {
  if (stopping) return stopping;
  stopping = (async () => {
    state.phase = 'saving'; state.endedAt ||= Date.now(); notify();
    await releaseMedia();
    await writes;
    await writer.close(); writer = null;
    state.phase = 'ready'; notify();
    if (!state.bytes) { state.error = '沒有錄到影片資料。'; notify(); return; }
    await download();
  })();
  return stopping;
}
async function download() {
  if (state.phase !== 'ready') throw new Error('影片尚未準備好，請稍候。');
  const file = await fileHandle.getFile();
  if (!file.size) throw new Error('暫存影片是空的，請刪除並重新錄影。');
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(file);
  state.phase = 'downloading'; notify();
  try {
    const response = await chrome.runtime.sendMessage({target:'background',type:'save-file',url:blobUrl,filename});
    if (!response?.ok) throw new Error(response?.error || '無法儲存影片。');
  } catch (error) {
    state.phase = 'ready'; state.error = `儲存未完成：${error.message}。請按「重新儲存影片」。`; notify();
  }
  return {...state};
}
async function handle(message) {
  switch (message.type) {
    case 'monitor-off':
      if (audio) { await audio.close(); audio = null; }
      state.monitorAudio = false;
      state.audioMode = '安靜錄影，持續錄入分頁音訊';
      return {...state};
    case 'status': return {...state};
    case 'start': return start(message);
    case 'stop': return stop();
    case 'download': return download();
    case 'discard': await discard(); return {...state};
    case 'download-ended':
      if (message.complete) await discardAfterDownload();
      else { state.phase = 'ready'; state.error = message.error; notify(); }
      return {...state};
    default: throw new Error('未知操作。');
  }
}
async function discardAfterDownload() {
  state.phase = 'ready';
  await discard();
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  handle(message).then(data => respond({ok:true,data}),error => respond({ok:false,error:error.message}));
  return true;
});
