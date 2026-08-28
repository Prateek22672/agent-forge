const $ = (id) => document.getElementById(id);

function hostFrom(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function refresh() {
  const s = await chrome.storage.local.get(["paused", "totalBlocked"]);
  const on = s.paused !== true;
  $("power").checked = on;
  $("total").textContent = (s.totalBlocked || 0).toLocaleString();
  $("status").innerHTML = on ? "<b>Blocking is on</b>" : "Paused on all sites";
  $("site").classList.toggle("off", !on);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = tab ? hostFrom(tab.url) : null;

    // Current site name + favicon.
    $("host").textContent = host || "This browser page";
    const fav = $("favicon");
    if (host && tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) {
      fav.onerror = () => (fav.hidden = true);
      fav.src = tab.favIconUrl;
      fav.hidden = false;
    } else {
      fav.hidden = true;
    }

    // Live per-tab block count.
    let n = 0;
    if (on && tab && tab.id != null && host) {
      const res = await chrome.runtime.sendMessage({ type: "NOADS_TAB_COUNT", tabId: tab.id });
      n = (res && res.count) || 0;
    }
    $("current").textContent = n.toLocaleString();
  } catch {
    $("current").textContent = "0";
  }
}

$("power").onchange = () => {
  chrome.storage.local.set({ paused: !$("power").checked }, refresh);
};

refresh();
