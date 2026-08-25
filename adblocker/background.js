// NoAds background — badge, all-time block counting, and per-site controls.
//
// Counting in MV3: declarativeNetRequest doesn't hand you a lifetime total, so
// we poll getMatchedRules (the declarativeNetRequestFeedback permission) on an
// alarm and accumulate a persistent counter, mapping each matched rule back to
// the ad domain it blocked so the popup can show WHAT was blocked. Cosmetic /
// YouTube removals from the content scripts are added in too.

function applyBadge() {
  try {
    chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  } catch {}
  chrome.action.setBadgeBackgroundColor({ color: "#5b6cf0" });
}

// ruleId -> the domain/pattern it blocks (for the "what was blocked" breakdown).
const RULE_DOMAIN = {};
async function loadRuleMap() {
  try {
    const res = await fetch(chrome.runtime.getURL("rules.json"));
    const rules = await res.json();
    for (const r of rules) {
      const f = (r.condition && r.condition.urlFilter) || "";
      const m = f.match(/\|\|([^\^]+)\^/);
      RULE_DOMAIN[r.id] = m ? m[1] : f.replace(/[|^*]/g, "") || "other";
    }
  } catch {}
}

let lastStamp = 0;
async function pollMatches() {
  try {
    if (!Object.keys(RULE_DOMAIN).length) await loadRuleMap();
    const res = await chrome.declarativeNetRequest.getMatchedRules({});
    const matches = (res && res.rulesMatchedInfo) || [];
    if (!matches.length) return;
    const store = await chrome.storage.local.get(["totalBlocked", "perDomain"]);
    let total = store.totalBlocked || 0;
    const per = store.perDomain || {};
    let newest = lastStamp;
    for (const info of matches) {
      if (info.timeStamp <= lastStamp) continue;
      newest = Math.max(newest, info.timeStamp);
      total += 1;
      const d = RULE_DOMAIN[info.rule.ruleId] || "other";
      per[d] = (per[d] || 0) + 1;
    }
    lastStamp = newest;
    await chrome.storage.local.set({ totalBlocked: total, perDomain: per });
  } catch {}
}

function init() {
  applyBadge();
  loadRuleMap();
  chrome.alarms.create("poll", { periodInMinutes: 1 });
  pollMatches();
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init();

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "poll") pollMatches();
});

// Content scripts report cosmetic / YouTube removals so they count too.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "NOADS_REMOVED" && msg.n > 0) {
    (async () => {
      const store = await chrome.storage.local.get(["totalBlocked", "perDomain"]);
      const per = store.perDomain || {};
      per["page elements (hidden)"] = (per["page elements (hidden)"] || 0) + msg.n;
      await chrome.storage.local.set({
        totalBlocked: (store.totalBlocked || 0) + msg.n,
        perDomain: per,
      });
    })();
  }
  if (msg && msg.type === "NOADS_POLL_NOW") {
    pollMatches().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Global pause (from the popup toggle) enables/disables the whole ruleset.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !("paused" in changes)) return;
  const paused = changes.paused.newValue === true;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      paused ? { disableRulesetIds: ["ads"] } : { enableRulesetIds: ["ads"] }
    );
  } catch {}
  chrome.action.setBadgeText({ text: paused ? "off" : "" });
});
