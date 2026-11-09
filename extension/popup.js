const $ = id => document.getElementById(id);
let busy = false, currentCapture = null;
async function command(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({target: 'background', type, ...extra});
  if (!response?.ok) throw new Error(response?.error || '無法連線至錄影機。');
  return response.data;
}
async function refresh() {
  if (busy) return;
  try {
    const [status,tabs] = await Promise.all([command('status'),chrome.tabs.query({active:true,currentWindow:true})]);
    if (busy) return;
    const tab = tabs[0];
    const captures = status.captures || [];
    currentCapture = captures.find(capture=>capture.tabId === tab?.id) || null;
    const s = currentCapture || {phase:'idle'};
    const atCapacity = captures.length >= (status.captureLimit || 2);
    const names = {rotating:'正在切換錄影片段…',idle:'尚未開始',starting:'準備錄製…',recording:'● 錄製中',saving:'正在儲存…',ready:'影片已暫存，請儲存',downloading:'正在下載影片…',error:'錄影發生錯誤'};
    const pending = (status.jobs || []).length;
    $('status').textContent = currentCapture ? names[s.phase] || s.phase : atCapacity ? '已有兩個錄影，請先停止其中一個' : captures.length ? '另一個分頁錄製中，可開始錄製此分頁' : pending ? `背景處理 ${pending} 部影片，可開始錄影` : names.idle;
    $('title').textContent = s.title || tab?.title || '開啟要錄製的網頁，再按開始';
    const seconds = s.startedAt ? Math.floor(((s.endedAt || Date.now()) - s.startedAt) / 1000) : 0;
    $('time').textContent = [Math.floor(seconds / 3600),Math.floor(seconds / 60) % 60,seconds % 60].map(n => String(n).padStart(2,'0')).join(':');
    $('size').textContent = s.bytes ? `已寫入 ${(s.bytes / 1048576).toFixed(1)} MB` : '';
    $('start').disabled = !!status.preparing || atCapacity || !!currentCapture || !tab;
    $('stop').disabled = !['recording','rotating'].includes(s.phase);
    $('quality').disabled = !['idle','error'].includes(s.phase);
    $('monitor-audio').disabled = !['idle','error'].includes(s.phase);
    $('retry').hidden = s.phase !== 'ready';
    $('discard').hidden = s.phase !== 'ready';
    $('error').textContent = s.error || status.error || ((status.jobs || []).some(job=>job.error) ? '有影片尚未儲存完成，請開啟獨立控制視窗處理。' : '');
  } catch (error) { $('error').textContent = error.message; }
}
async function run(type, extra = {}) {
  busy = true;
  let operationError = '';
  for (const id of ['start','stop','retry','discard']) $(id).disabled = true;
  $('error').textContent = '';
  try { await command(type, extra); }
  catch (error) { operationError = error.message; }
  finally {
    busy = false;
    $('retry').disabled = $('discard').disabled = false;
    await refresh();
    if (operationError) $('error').textContent = operationError;
  }
}
$('start').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  await run('start', {tabId:tab?.id,quality:$('quality').value,monitorAudio:$('monitor-audio').checked});
});
$('stop').addEventListener('click', () => { if (currentCapture) run('stop',{tabId:currentCapture.tabId,captureId:currentCapture.id}); });
$('panel').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    await command('open-panel',{tabId:tab?.id});
    window.close();
  } catch (error) { $('error').textContent = error.message; }
});
$('retry').addEventListener('click', () => run('download'));
$('discard').addEventListener('click', () => {
  if (confirm('確定刪除尚未儲存的暫存影片？')) run('discard');
});
refresh();
setInterval(refresh,1000);
