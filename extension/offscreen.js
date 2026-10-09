let state = {phase:'idle',bytes:0};
let media, audio, recorder, root, fileHandle, writer, blobUrl;
let writes = Promise.resolve();
let writeError = null;
let stopping = null;
let filename;
const tempName = 'recording.tmp';
const mimeTypes = ['video/mp4;codecs=avc1.42001E,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
function notify() {
  chrome.runtime.sendMessage({target:'background',type:'state',phase:state.phase,error:state.error || ''}).catch(() => {});
}
async function releaseMedia() {
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
    root = await navigator.storage.getDirectory();
    fileHandle = await root.getFileHandle(tempName,{create:true});
    writer = await fileHandle.createWritable();
    writes = Promise.resolve();
    writeError = null;
    stopping = null;
    media = await navigator.mediaDevices.getUserMedia({
      audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId}},
      video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId,maxFrameRate:30}}
    });
    if (!media.getVideoTracks().length) throw new Error('沒有取得分頁畫面。');
    if (media.getAudioTracks().length) {
      audio = new AudioContext();
      audio.createMediaStreamSource(media).connect(audio.destination);
      await audio.resume();
    }
    const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('這個 Chrome 版本沒有可用的影片編碼器。');
    recorder = new MediaRecorder(media,{mimeType,videoBitsPerSecond:message.quality === 'high' ? 8000000 : 4000000,audioBitsPerSecond:192000});
    const stamp = new Date().toLocaleString('sv-SE').replace(/[^0-9]/g,'');
    filename = `分頁錄影-${stamp}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
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
