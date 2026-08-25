// Show the number of network requests AdVanish blocked, per tab, on the badge —
// a live "it's working" signal. declarativeNetRequest surfaces this natively via
// setExtensionActionOptions (no manual counting, no extra permissions).
function applyBadge() {
  try {
    chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  } catch {}
  chrome.action.setBadgeBackgroundColor({ color: "#5b6cf0" });
}

chrome.runtime.onInstalled.addListener(applyBadge);
chrome.runtime.onStartup.addListener(applyBadge);
applyBadge();

// Pause / resume blocking: toggling the "paused" flag both disables the
// network ruleset and tells the content scripts (which watch storage) to stop.
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
