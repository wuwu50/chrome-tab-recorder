const $ = id => document.getElementById(id);
const preview = new URLSearchParams(location.search).has('demo');
let target = null, state = {phase:'idle'}, busy = false, localError = '';
let updateBusy = false;
let configuredUpdateSource = '';
const officialUpdateSource = 'https://raw.githubusercontent.com/wuwu50/chrome-tab-recorder/main/version.json';
function nativeUpdateAvailable() { return navigator.userAgent.includes('Windows') && configuredUpdateSource === officialUpdateSource; }
function updateMessage(text,isError=false) {
  $('update-status').textContent = text;
  $('update-status').dataset.error = String(isError);
}
function clearUpdateResult() {
  $('update-install').hidden = true;
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
    updateButtons();
    updateMessage(settings.url ? '按「檢查更新」取得最新版本資訊' : '尚未設定更新來源');
  } catch(error) { updateMessage(error.message,true); }
}
function updateButtons() {
  $('check-update').textContent = nativeUpdateAvailable() ? '↻ 更新並自動安裝' : '↻ 檢查更新';
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
  if (nativeUpdateAvailable()) {
    if (busy || !['idle','error'].includes(state.phase)) { updateMessage('請先停止錄影並完成儲存，才能安裝更新。',true); return; }
    // Launch directly from the click so Chrome retains the user's activation.
    // The native updater checks, confirms, downloads and installs; no web download.
    $('update-install').click(); return;
  }
  updateBusy = true; updateButtons(); clearUpdateResult(); updateMessage('正在檢查更新…');
  try {
    if (configuredUpdateSource && !(await chrome.permissions.request({origins:[updateHostPattern(updateHttpsUrl(configuredUpdateSource))]}))) throw new Error('未允許連線，無法檢查更新。');
    const result = await command('check-update');
    if (result.available) {
      updateMessage(`有新版本 v${result.latestVersion}（目前 v${result.currentVersion}）`);
      $('update-download').href = updateHttpsUrl(result.downloadUrl).href;
      $('update-download').hidden = false;
      $('update-install').hidden = true;
      updateMessage(`有新版本 v${result.latestVersion}（目前 v${result.currentVersion}）；自訂來源請展開「設定更新來源／手動下載」。`);
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
  const labels = {idle:'準備開始錄影',starting:'正在準備錄影…',recording:'正在錄製分頁影音',rotating:'正在切換下一段 MP4…',saving:'正在完成影片…',ready:'影片已暫存，等待儲存',downloading:'正在儲存影片…',error:'錄影發生錯誤'};
  const short = {idle:'準備就緒',starting:'準備中',recording:'● REC',rotating:'分段中',saving:'儲存中',ready:'待儲存',downloading:'下載中',error:'請檢查'};
  $('status').textContent = labels[state.phase] || state.phase;
  $('badge').textContent = short[state.phase] || state.phase;
  $('light').classList.toggle('recording',state.phase === 'recording');
  const seconds = state.startedAt ? Math.max(0,Math.floor(((state.endedAt || Date.now()) - state.startedAt) / 1000)) : 0;
  $('time').textContent = [Math.floor(seconds / 3600),Math.floor(seconds / 60) % 60,seconds % 60].map(n=>String(n).padStart(2,'0')).join(':');
  $('size').textContent = `${((state.bytes || 0) / 1048576).toFixed(1)} MB`;
  $('segments').textContent = state.segmented ? `第 ${state.partNumber || 1} 段 MP4 · 已儲存 ${state.savedParts || 0} 段` : '長錄會自動分段，每段約 1 GB 或 5 分鐘';
  $('capture-format').textContent = state.captureFormat ? `Chrome 擷取設定：${state.captureFormat}` : '尚未擷取；實際畫面更新率取決於來源與硬體';
  const recording = !['idle','error'].includes(state.phase);
  $('update-install').setAttribute('aria-disabled',String(recording || busy));
  $('update-install').classList.toggle('disabled-link',recording || busy);
  $('title').textContent = (recording ? state.title : target?.title) || '尚未選擇錄製分頁';
  $('site').textContent = recording && state.tabId !== target?.id ? '已固定錄製目標' : (target?.url || '在目標分頁開啟此控制視窗');
  $('start').disabled = preview || busy || recording || !target;
  $('stop').disabled = preview || busy || !['recording','rotating'].includes(state.phase);
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
$('diagnostics').disabled = preview;
$('diagnostics').addEventListener('click',async()=>{
  try {
    const report = await command('diagnostics');
    const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = '錄影機錯誤紀錄.json'; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  } catch (error) { localError = error.message; render(); }
});
$('discard').addEventListener('click',()=>{if(confirm('確定刪除尚未儲存的暫存影片？'))run('discard')});
$('locate').addEventListener('click',async()=>{
  try {
    const id = !['idle','error'].includes(state.phase) ? state.tabId : target?.id;
    const tab = await chrome.tabs.update(id,{active:true});
    await chrome.windows.update(tab.windowId,{focused:true});
  } catch (_) { localError = '目標分頁已關閉，請重新選擇分頁。'; render(); }
});
$('update-install').addEventListener('click',event=>{
  if (busy || !['idle','error'].includes(state.phase)) {
    event.preventDefault();updateMessage('請先停止錄影並完成儲存，才能安裝更新。',true);
  } else {
    updateMessage('已呼叫自動更新器，請在更新視窗確認安裝。會自動下載並沿用原本位置，不需要選擇 EXE 或資料夾。若沒有開啟，請使用桌面錄影機的「檢查更新並安裝」。');
  }
});
if (preview) {
  $('demo').hidden = false;
  target = {id:1,title:'教學影片 — 已選擇的 Chrome 分頁',url:'https://example.com/video'};
  render();
  $('version').textContent = 'v1.9.0';
  updateButtons();
} else { refresh(); loadUpdateSettings(); setInterval(refresh,1000); }
