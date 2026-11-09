// Changes only the captured tab after tabCapture has suppressed local playback.
let audioTransition = Promise.resolve();
function audioLocked(action) {
  const result = audioTransition.then(action);
  audioTransition = result.catch(() => {});
  return result;
}
function prepareCapturedAudio(tabId) {
  return audioLocked(async () => {
    const tab = await chrome.tabs.get(tabId);
    const originallyMuted = tab.mutedInfo?.muted === true;
    const entries = await capturedAudioEntries();
    entries[tabId] = {tabId,restoreMuted:originallyMuted};
    await chrome.storage.session.set({captureAudio:entries});
    if (originallyMuted) await chrome.tabs.update(tabId,{muted:false});
    return {originallyMuted};
  });
}
async function capturedAudioEntries() {
  const {captureAudio} = await chrome.storage.session.get('captureAudio');
  // Recover the single-tab entry left by an earlier version.
  return Number.isInteger(captureAudio?.tabId) ? {[captureAudio.tabId]:captureAudio} : captureAudio || {};
}
function restoreCapturedAudio(tabId) {
  return audioLocked(async () => {
    const entries = await capturedAudioEntries();
    const restoring = tabId === undefined ? Object.values(entries) : [entries[tabId]].filter(Boolean);
    for (const entry of restoring) {
      if (entry.restoreMuted) {
        let tab;
        try { tab = await chrome.tabs.get(entry.tabId); }
        catch (_) { /* Closed tab has no audio state to restore. */ }
        if (tab && !tab.mutedInfo?.muted) await chrome.tabs.update(tab.id,{muted:true});
      }
      delete entries[entry.tabId];
    }
    // Mute events take the same lock and only see the remaining live entries.
    if (Object.keys(entries).length) await chrome.storage.session.set({captureAudio:entries});
    else await chrome.storage.session.remove('captureAudio');
  });
}
function capturedTabMuted(tabId,change) {
  if (!change.mutedInfo?.muted) return Promise.resolve();
  return audioLocked(async () => {
    const entries = await capturedAudioEntries();
    if (!entries[tabId]) return;
    // Respect the user's intention to silence speakers while retaining capture.
    await offscreen('monitor-off',{tabId});
    entries[tabId].restoreMuted = true;
    await chrome.storage.session.set({captureAudio:entries});
    await chrome.tabs.update(tabId,{muted:false});
  });
}
