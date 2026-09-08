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

// Seconds → "45s" / "12m 05s" / "3h 20m".
function fmtTime(s) {
  s = Math.round(s || 0);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m " + String(s % 60).padStart(2, "0") + "s";
  const h = Math.floor(m / 60);
  return h + "h " + String(m % 60).padStart(2, "0") + "m";
}

let activeTab = null;
let currentHost = null;

async function refresh() {
  const s = await chrome.storage.local.get([
    "paused", "pausedHosts", "totalBlocked", "timeSaved", "notice",
  ]);
  const globalOn = s.paused !== true;
  const pausedHosts = Array.isArray(s.pausedHosts) ? s.pausedHosts : [];

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  currentHost = tab ? hostFrom(tab.url) : null;
  const sitePaused = !!(currentHost && pausedHosts.indexOf(currentHost) !== -1);
  const activeHere = globalOn && !sitePaused;

  $("power").checked = globalOn;
  $("total").textContent = (s.totalBlocked || 0).toLocaleString();
  $("saved").textContent = fmtTime(s.timeSaved || 0);
  $("notice").checked = s.notice !== false;

  // Site row.
  $("host").textContent = currentHost || "This browser page";
  const fav = $("favicon");
  if (currentHost && tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) {
    fav.onerror = () => (fav.hidden = true);
    fav.src = tab.favIconUrl;
    fav.hidden = false;
  } else {
    fav.hidden = true;
  }

  // Card state + copy.
  const card = $("card");
  card.classList.toggle("off", !globalOn);
  card.classList.toggle("sitepaused", globalOn && sitePaused);
  if (!globalOn) {
    $("pill").textContent = "Off";
    $("headline").textContent = "Protection is off";
  } else if (sitePaused) {
    $("pill").textContent = "Paused";
    $("headline").textContent = "Paused on this site";
  } else {
    $("pill").textContent = "Active";
    $("headline").textContent = "This page is being cleaned";
  }

  // Pause-on-site button.
  const btn = $("pauseSite");
  btn.disabled = !globalOn || !currentHost;
  btn.textContent = sitePaused ? "Resume on this site" : "Pause on this site";

  // Live per-tab count.
  let n = 0;
  if (activeHere && tab && tab.id != null && currentHost) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "NOADS_TAB_COUNT", tabId: tab.id });
      n = (res && res.count) || 0;
    } catch {}
  }
  $("current").textContent = n.toLocaleString();
}

// Reload the current tab after a change so on/off takes effect immediately
// (already-loaded ads only clear on a fresh load).
function reloadActive() {
  try {
    if (activeTab && activeTab.id != null) chrome.tabs.reload(activeTab.id);
  } catch {}
}

$("power").onchange = () => {
  chrome.storage.local.set({ paused: !$("power").checked }, () => {
    reloadActive();
    setTimeout(refresh, 60);
  });
};

// The on-video notice is picked up live by the content script's storage
// listener, so this needs no tab reload.
$("notice").onchange = () => {
  chrome.storage.local.set({ notice: $("notice").checked });
};

$("pauseSite").onclick = async () => {
  if (!currentHost) return;
  const s = await chrome.storage.local.get("pausedHosts");
  let hosts = Array.isArray(s.pausedHosts) ? s.pausedHosts : [];
  if (hosts.indexOf(currentHost) !== -1) hosts = hosts.filter((h) => h !== currentHost);
  else hosts = hosts.concat(currentHost);
  chrome.storage.local.set({ pausedHosts: hosts }, () => {
    reloadActive();
    setTimeout(refresh, 60);
  });
};

refresh();
