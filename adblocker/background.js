// NoAds background — blocking toggle, accurate counting, per-tab counts.
//
// Counting: onRuleMatchedDebug fires in real time for every blocked request
// (works while the extension is loaded unpacked — i.e. while testing). In a
// published build it doesn't fire, so we fall back to polling getMatchedRules.
// Either way we keep a persistent all-time total + a live per-tab count.

let PAUSED = false;
chrome.storage.local.get("paused", (r) => (PAUSED = r.paused === true));

function applyBadge() {
  try {
    chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  } catch {}
  chrome.action.setBadgeBackgroundColor({ color: "#5b6cf0" });
}

// ruleId -> ad domain (for future breakdown; harmless if unused by the popup).
const RULE_DOMAIN = {};
async function loadRuleMap() {
  try {
    const rules = await (await fetch(chrome.runtime.getURL("rules.json"))).json();
    for (const r of rules) {
      const f = (r.condition && r.condition.urlFilter) || "";
      const m = f.match(/\|\|([^\^]+)\^/);
      RULE_DOMAIN[r.id] = m ? m[1] : "other";
    }
  } catch {}
}

const tabCounts = {}; // tabId -> blocked this page-load (live)
let pendingTotal = 0;
let flushTimer = null;

function flushSoon() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (pendingTotal <= 0) return;
    const add = pendingTotal;
    pendingTotal = 0;
    const s = await chrome.storage.local.get("totalBlocked");
    await chrome.storage.local.set({ totalBlocked: (s.totalBlocked || 0) + add });
  }, 1200);
}

function countBlock(tabId) {
  if (PAUSED) return;
  pendingTotal++;
  if (tabId != null && tabId >= 0) tabCounts[tabId] = (tabCounts[tabId] || 0) + 1;
  flushSoon();
}

// Real-time, accurate (unpacked/dev builds).
try {
  if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      countBlock(info.request && info.request.tabId);
    });
  }
} catch {}

// Reset a tab's live count when it navigates; drop it when it closes.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") tabCounts[tabId] = 0;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabCounts[tabId];
});

function init() {
  applyBadge();
  loadRuleMap();
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Cosmetic / YouTube removals count toward the all-time total too.
  if (msg && msg.type === "NOADS_REMOVED" && msg.n > 0 && !PAUSED) {
    pendingTotal += msg.n;
    flushSoon();
  }
  // Popup asks for the active tab's live count.
  if (msg && msg.type === "NOADS_TAB_COUNT") {
    sendResponse({ count: tabCounts[msg.tabId] || 0 });
  }
  return false;
});

// The on/off switch: disable/enable the whole ruleset, stop counting, clear badge.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !("paused" in changes)) return;
  PAUSED = changes.paused.newValue === true;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      PAUSED ? { disableRulesetIds: ["ads"] } : { enableRulesetIds: ["ads"] }
    );
  } catch {}
  try {
    // Off = truly off: turn the auto badge off and show "off".
    chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: !PAUSED });
  } catch {}
  chrome.action.setBadgeText({ text: PAUSED ? "off" : "" });
});
