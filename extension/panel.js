const $ = id => document.getElementById(id);
const preview = new URLSearchParams(location.search).has('demo');
let target = null, state = {phase:'idle'}, busy = false, localError = '';
let updateBusy = false;
let configuredUpdateSource = '';
function updateMessage(text,isError=false) {
  $('update-status').textContent = text;
  $('update-status').dataset.error = String(isError);
}
function clearUpdateResult() {
  $('update-download').hidden = true;
  $('update-download').removeAttribute('href');
  $('update-notes').hidden = true;
  $('update-notes').textContent = '';
}
async function loadUpdateSettings() {
  try {
    const settings = await command('update-settings');
    $('version').textContent = `v${settings.currentVersion}`;
    $('update-source').value = settings.url;
    configuredUpdateSource = settings.url;
    updateMessage(settings.url ? '按「檢查更新」取得最新版本資訊' : '尚未設定更新來源');
  } catch(error) { updateMessage(error.message,true); }
}
function updateButtons() {
  $('check-update').disabled = $('save-update-source').disabled = $('update-source').disabled = preview || updateBusy;
}
$('save-update-source').addEventListener('click',async()=>{
  updateBusy = true; updateButtons(); clearUpdateResult();
  try {
    const value = $('update-source').value.trim();
    const url = value ? updateHttpsUrl(value) : null;
    // Request directly from this click, before any other awaited operation.
    if (url && !(await chrome.permissions.request({origins:[updateHostPattern(url)]}))) throw new Error('未允許連線，更新來源尚未儲存。');
    const settings = await command('update-source',{url:url?.href || ''});
    $('update-source').value = settings.url;
    configuredUpdateSource = settings.url;
    updateMessage(settings.url ? '更新來源已儲存，可以檢查更新。' : '已關閉線上更新檢查。');
  } catch(error) { updateMessage(error.message,true); }
  finally { updateBusy = false; updateButtons(); }
});
$('check-update').addEventListener('click',async()=>{
  updateBusy = true; updateButtons(); clearUpdateResult(); updateMessage('正在檢查更新…');
  try {
    if (configuredUpdateSource && !(await chrome.permissions.request({origins:[updateHostPattern(updateHttpsUrl(configuredUpdateSource))]}))) throw new Error('未允許連線，無法檢查更新。');
    const result = await command('check-update');
    if (result.available) {
      updateMessage(`有新版本 v${result.latestVersion}（目前 v${result.currentVersion}）`);
      $('update-download').href = updateHttpsUrl(result.downloadUrl).href;
      $('update-download').hidden = false;
      if (result.notes) { $('update-notes').textContent = result.notes; $('update-notes').hidden = false; }
    } else {
      updateMessage(result.sourceBehind ? `更新來源版本 v${result.latestVersion} 比目前版本舊，沒有可更新版本。` : `目前已是最新版本 v${result.currentVersion}`);
    }
  } catch(error) { updateMessage(error.message,true); }
  finally { updateBusy = false; updateButtons(); }
});
async function command(type,extra={}) {
  const response = await chrome.runtime.sendMessage({target:'background',type,...extra});
  if (!response?.ok) throw new Error(response?.error || '無法連線至錄影機。');
  return response.data;
}
function render() {
  const labels = {idle:'準備開始錄影',starting:'正在準備錄影…',recording:'正在錄製分頁影音',saving:'正在完成影片…',ready:'影片已暫存，等待儲存',downloading:'正在儲存影片…',error:'錄影發生錯誤'};
  const short = {idle:'準備就緒',starting:'準備中',recording:'● REC',saving:'儲存中',ready:'待儲存',downloading:'下載中',error:'請檢查'};
  $('status').textContent = labels[state.phase] || state.phase;
  $('badge').textContent = short[state.phase] || state.phase;
  $('light').classList.toggle('recording',state.phase === 'recording');
  const seconds = state.startedAt ? Math.max(0,Math.floor(((state.endedAt || Date.now()) - state.startedAt) / 1000)) : 0;
  $('time').textContent = [Math.floor(seconds / 3600),Math.floor(seconds / 60) % 60,seconds % 60].map(n=>String(n).padStart(2,'0')).join(':');
  $('size').textContent = `${((state.bytes || 0) / 1048576).toFixed(1)} MB`;
  $('capture-format').textContent = state.captureFormat ? `Chrome 擷取設定：${state.captureFormat}` : '尚未擷取；實際畫面更新率取決於來源與硬體';
  const recording = !['idle','error'].includes(state.phase);
  $('title').textContent = (recording ? state.title : target?.title) || '尚未選擇錄製分頁';
  $('site').textContent = recording && state.tabId !== target?.id ? '已固定錄製目標' : (target?.url || '在目標分頁開啟此控制視窗');
  $('start').disabled = preview || busy || recording || !target;
  $('stop').disabled = preview || busy || state.phase !== 'recording';
  $('quality').disabled = preview || busy || recording;
  $('monitor-audio').disabled = preview || busy || recording;
  $('locate').disabled = preview || !(recording ? state.tabId : target?.id);
  $('retry').hidden = $('discard').hidden = state.phase !== 'ready';
  $('retry').disabled = $('discard').disabled = preview || busy;
  $('error').textContent = localError || state.error || '';
}
async function refresh() {
  if (preview || busy) return;
  try {
    const [nextState,nextTarget] = await Promise.all([command('status'),command('panel-target')]);
    state = nextState; target = nextTarget;
  } catch (error) { localError = error.message; }
  render();
}
async function run(type,extra={}) {
  busy = true; localError = ''; render();
  try { await command(type,extra); }
  catch (error) { localError = error.message; }
  finally { busy = false; await refresh(); }
}
$('start').addEventListener('click',()=>run('start',{tabId:target?.id,quality:$('quality').value,monitorAudio:$('monitor-audio').checked}));
$('stop').addEventListener('click',()=>run('stop'));
$('retry').addEventListener('click',()=>run('download'));
$('discard').addEventListener('click',()=>{if(confirm('確定刪除尚未儲存的暫存影片？'))run('discard')});
$('locate').addEventListener('click',async()=>{
  try {
    const id = !['idle','error'].includes(state.phase) ? state.tabId : target?.id;
    const tab = await chrome.tabs.update(id,{active:true});
    await chrome.windows.update(tab.windowId,{focused:true});
  } catch (_) { localError = '目標分頁已關閉，請重新選擇分頁。'; render(); }
});
if (preview) {
  $('demo').hidden = false;
  target = {id:1,title:'教學影片 — 已選擇的 Chrome 分頁',url:'https://example.com/video'};
  render();
  $('version').textContent = 'v1.5.0';
  updateButtons();
} else { refresh(); loadUpdateSettings(); setInterval(refresh,1000); }
