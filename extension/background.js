importScripts('updates.js');
let starting = false;
async function contexts() {
  return chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
}
async function ensureOffscreen() {
  if (!(await contexts()).length) await chrome.offscreen.createDocument({
    url:'offscreen.html', reasons:['USER_MEDIA','BLOBS'],
    justification:'擷取使用者指定分頁的影音，在背景錄影並儲存本機影片。'
  });
}
async function offscreen(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({target:'offscreen',type,...extra});
  if (!response?.ok) throw new Error(response?.error || '背景錄影機沒有回應。');
  return response.data;
}
async function setBadge(phase) {
  await chrome.action.setBadgeText({text: phase === 'recording' ? 'REC' : ['ready','downloading','saving'].includes(phase) ? '存' : ''});
  await chrome.action.setBadgeBackgroundColor({color:'#d9415b'});
}
async function handle(message) {
  switch (message.type) {
    case 'update-settings': return getUpdateSettings();
    case 'update-source': return saveUpdateSource(message.url);
    case 'check-update': return checkForUpdate();
    case 'open-panel': {
      const tab = await chrome.tabs.get(message.tabId);
      await chrome.storage.session.set({panelTarget:{id:tab.id,title:tab.title || 'Chrome 分頁',url:tab.url || ''}});
      const saved = (await chrome.storage.session.get('panelWindowId')).panelWindowId;
      if (saved) {
        try { await chrome.windows.update(saved,{focused:true,state:'normal'}); return null; }
        catch (_) { /* The previous control window was closed. */ }
      }
      const panel = await chrome.windows.create({url:chrome.runtime.getURL('panel.html'),type:'popup',width:960,height:790});
      await chrome.storage.session.set({panelWindowId:panel.id});
      return null;
    }
    case 'panel-target':
      return (await chrome.storage.session.get('panelTarget')).panelTarget || null;
    case 'status': {
      if (!(await contexts()).length) {
        const saved = (await chrome.storage.local.get('lastError')).lastError;
        return {phase:'idle',error:saved || ''};
      }
      return offscreen('status');
    }
    case 'start': {
      if (starting) throw new Error('正在準備錄製，請稍候。');
      starting = true;
      try {
        const tab = await chrome.tabs.get(message.tabId);
        if (!tab.url || !/^https?:|^file:/.test(tab.url)) throw new Error('請開啟一般網頁；Chrome 設定頁與擴充功能頁不能錄製。');
        await ensureOffscreen();
        const state = await offscreen('status');
        if (!['idle','error'].includes(state.phase)) throw new Error('請先停止錄影並儲存或刪除暫存影片。');
        const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
        const result = await offscreen('start',{streamId,title:tab.title || 'Chrome 分頁',tabId:tab.id,quality:message.quality});
        await chrome.storage.local.remove('lastError');
        await setBadge('recording');
        return result;
      } finally { starting = false; }
    }
    case 'stop': return offscreen('stop');
    case 'download': return offscreen('download');
    case 'discard': return offscreen('discard');
    case 'state':
      await setBadge(message.phase);
      await chrome.storage.local.set({lastError:message.error || ''});
      return null;
    case 'save-file': {
      const id = await chrome.downloads.download({url:message.url,filename:message.filename,saveAs:true});
      await chrome.storage.local.set({pendingDownload:id});
      // Completion may race with storing the ID for very small files.
      const [item] = await chrome.downloads.search({id});
      if (item?.state !== 'in_progress') setTimeout(() => finishDownload(id,item?.state,item?.error),0);
      return {downloadId:id};
    }
    default: throw new Error('未知操作。');
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message.target !== 'background' || sender.id !== chrome.runtime.id) return;
  handle(message).then(data => respond({ok:true,data}),error => respond({ok:false,error:error.message}));
  return true;
});
let finishing = false;
async function finishDownload(id,state,error) {
  if (finishing || !['complete','interrupted'].includes(state)) return;
  if ((await chrome.storage.local.get('pendingDownload')).pendingDownload !== id) return;
  finishing = true;
  try {
    await offscreen('download-ended',{complete:state === 'complete',error:error || '下載取消或失敗，影片仍在暫存，可重新儲存。'});
    await chrome.storage.local.remove('pendingDownload');
  } catch (e) { await chrome.storage.local.set({lastError:e.message}); }
  finally { finishing = false; }
}
chrome.downloads.onChanged.addListener(delta => {
  if (delta.state) finishDownload(delta.id,delta.state.current,delta.error?.current);
});
chrome.runtime.onStartup.addListener(() => setBadge('idle'));
