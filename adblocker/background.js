// NoAds background — on/off toggle + block counting via the NATIVE
// declarativeNetRequest action badge. No privacy-sensitive permissions:
// only "declarativeNetRequest" + "storage" are used.
//
// displayActionCountAsBadgeText makes Chrome itself show, per tab, how many
// requests this extension blocked. We read that count with action.getBadgeText
// (no special permission) and fold new blocks into a persistent all-time total.
// Cosmetic/YouTube element removals (reported by the content scripts) are added
// on top. This works identically in a published build and unpacked.

let PAUSED = false;
chrome.storage.local.get("paused", (r) => (PAUSED = r.paused === true));

// Earlier builds over-counted (re-counted the same ad on every player re-fetch,
// counted re-inserted cosmetic shells, etc.), so the stored all-time total is
// inflated and not trustworthy. Reset it ONCE on upgrade to this counting model
// so the number the user sees from here on is genuine — one count per real,
// de-duplicated ad blocked.
const COUNT_VERSION = 2;
chrome.storage.local.get("countVersion", (r) => {
  if (r.countVersion !== COUNT_VERSION) {
    chrome.storage.local.set({ totalBlocked: 0, countVersion: COUNT_VERSION });
  }
});

function applyBadge() {
  try {
    chrome.declarativeNetRequest.setExtensionActionOptions({
      displayActionCountAsBadgeText: !PAUSED,
    });
  } catch {}
  chrome.action.setBadgeBackgroundColor({ color: "#5b6cf0" });
  if (PAUSED) chrome.action.setBadgeText({ text: "off" });
}

const tabSeen = {}; // tabId -> native block count already folded into the total
const tabCosmetic = {}; // tabId -> cosmetic removals this page-load

function addTotal(n) {
  if (n <= 0 || PAUSED) return;
  chrome.storage.local.get("totalBlocked", (s) => {
    chrome.storage.local.set({ totalBlocked: (s.totalBlocked || 0) + n });
  });
}

async function badgeCount(tabId) {
  try {
    const t = await chrome.action.getBadgeText({ tabId });
    return parseInt((t || "").replace(/[^\d]/g, ""), 10) || 0;
  } catch {
    return 0;
  }
}

// Read a tab's native block count and add any new blocks to the all-time total.
async function syncTab(tabId) {
  if (PAUSED || tabId == null || tabId < 0) return;
  const n = await badgeCount(tabId);
  const seen = tabSeen[tabId] || 0;
  if (n > seen) {
    addTotal(n - seen);
    tabSeen[tabId] = n;
  }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") {
    tabSeen[tabId] = 0;
    tabCosmetic[tabId] = 0;
  }
  syncTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabSeen[tabId];
  delete tabCosmetic[tabId];
});

function init() {
  applyBadge();
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Cosmetic / YouTube removals count toward the totals too.
  if (msg && msg.type === "NOADS_REMOVED" && msg.n > 0 && !PAUSED) {
    const tabId = sender.tab && sender.tab.id;
    if (tabId != null) tabCosmetic[tabId] = (tabCosmetic[tabId] || 0) + msg.n;
    addTotal(msg.n);
  }
  // Popup asks for the active tab's live count: native badge + cosmetic.
  if (msg && msg.type === "NOADS_TAB_COUNT") {
    (async () => {
      const n = await badgeCount(msg.tabId);
      sendResponse({ count: n + (tabCosmetic[msg.tabId] || 0) });
    })();
    return true; // keep the message channel open for the async response
  }
  return false;
});

// The on/off switch: disable/enable the whole ruleset, toggle the auto badge.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !("paused" in changes)) return;
  PAUSED = changes.paused.newValue === true;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      PAUSED ? { disableRulesetIds: ["ads"] } : { enableRulesetIds: ["ads"] }
    );
  } catch {}
  try {
    chrome.declarativeNetRequest.setExtensionActionOptions({
      displayActionCountAsBadgeText: !PAUSED,
    });
  } catch {}
  chrome.action.setBadgeText({ text: PAUSED ? "off" : "" });
});
