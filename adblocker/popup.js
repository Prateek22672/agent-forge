const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await chrome.storage.local.get(["paused", "totalBlocked"]);
  const on = s.paused !== true;
  $("power").checked = on;
  $("total").textContent = (s.totalBlocked || 0).toLocaleString();
  $("status").innerHTML = on ? "<b>Blocking is on</b>" : "Paused";

  // Live per-tab count from the background (accurate — counted as they happen).
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let n = 0;
    if (tab && tab.id != null) {
      const res = await chrome.runtime.sendMessage({ type: "NOADS_TAB_COUNT", tabId: tab.id });
      n = (res && res.count) || 0;
    }
    $("current").textContent = on ? n.toLocaleString() : "0";
  } catch {
    $("current").textContent = "0";
  }
}

$("power").onchange = () => {
  chrome.storage.local.set({ paused: !$("power").checked }, refresh);
};

refresh();
