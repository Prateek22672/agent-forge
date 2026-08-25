const $ = (id) => document.getElementById(id);

async function refresh() {
  // Freshen the all-time counter, then read state + the current tab's count.
  try {
    await chrome.runtime.sendMessage({ type: "NOADS_POLL_NOW" });
  } catch {}
  const s = await chrome.storage.local.get(["paused", "totalBlocked"]);
  const on = s.paused !== true;
  $("power").checked = on;
  $("total").textContent = (s.totalBlocked || 0).toLocaleString();
  $("status").innerHTML = on ? "<b>Blocking is on</b>" : "Paused";

  // Current-page blocked count (this session).
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id != null) {
      const res = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
      $("current").textContent = ((res && res.rulesMatchedInfo) || []).length.toLocaleString();
    }
  } catch {
    $("current").textContent = "0";
  }
}

$("power").onchange = () => {
  chrome.storage.local.set({ paused: !$("power").checked }, refresh);
};

refresh();
