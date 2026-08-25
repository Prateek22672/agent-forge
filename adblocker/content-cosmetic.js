// Cosmetic ad removal + anti-adblock-nag removal + user custom selectors.
// declarativeNetRequest blocks ad NETWORK requests; this handles what it can't:
// ad containers that still take space, "disable your ad blocker" nag overlays,
// and any CSS selectors the user added in the popup. Counts what it removes and
// reports to the background so the all-time total reflects it. Best-effort and
// fails safe. Honours the global pause and the per-site pause list.
(function () {
  const HOST = location.hostname;
  let paused = false;
  let pausedHere = false;
  let customAll = [];
  let customSite = [];

  const readState = (r) => {
    paused = r.paused === true;
    pausedHere = Array.isArray(r.pausedSites) && r.pausedSites.includes(HOST);
    customAll = (r.customAll || []).filter(Boolean);
    customSite = ((r.customSite || {})[HOST] || []).filter(Boolean);
  };
  try {
    chrome.storage.local.get(["paused", "pausedSites", "customAll", "customSite"], readState);
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== "local") return;
      chrome.storage.local.get(["paused", "pausedSites", "customAll", "customSite"], readState);
    });
  } catch {}

  const AD = [
    ".adsbygoogle", "ins.adsbygoogle", '[id^="ad-"]', '[id*="google_ads"]', '[id*="-ad-slot"]',
    '[class*="ad-slot"]', '[class*="ad-banner"]', '[class*="adBanner"]',
    '[aria-label="Advertisement"]', '[aria-label="Advertisements"]', '[data-ad-slot]',
    'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]', 'iframe[src*="/ads/"]',
    "#taboola-below-article", '[id^="taboola"]', '[class*="trc_related"]',
  ];
  const NAG = ["adblock", "ad-block", "ad_block", "disable-adblock", "anti-adblock", "adblocker", "detect-adblock"];

  let pending = 0;
  const flush = () => {
    if (pending > 0) {
      try { chrome.runtime.sendMessage({ type: "NOADS_REMOVED", n: pending }); } catch {}
      pending = 0;
    }
  };

  const clean = () => {
    if (paused || pausedHere) return;
    try {
      const sels = AD.concat(customAll, customSite);
      sels.forEach((s) => {
        let nodes;
        try { nodes = document.querySelectorAll(s); } catch { return; }
        nodes.forEach((el) => { if (el) { el.remove(); pending++; } });
      });

      const nodes = document.querySelectorAll("div,section,aside,dialog,ytd-popup-container");
      for (const el of nodes) {
        const cls = typeof el.className === "string" ? el.className : "";
        const idc = (el.id + " " + cls).toLowerCase();
        if (!NAG.some((h) => idc.includes(h))) continue;
        let cs;
        try { cs = getComputedStyle(el); } catch { continue; }
        if (cs.position === "fixed" || cs.position === "absolute" || (+cs.zIndex || 0) > 999) {
          el.remove();
          pending++;
        }
      }

      if (getComputedStyle(document.body).overflow === "hidden") document.body.style.overflow = "auto";
      const de = document.documentElement;
      if (getComputedStyle(de).overflow === "hidden") de.style.overflow = "auto";
      if (getComputedStyle(document.body).filter !== "none") document.body.style.filter = "none";
    } catch {}
    flush();
  };

  const start = () => {
    try { new MutationObserver(clean).observe(document.documentElement, { childList: true, subtree: true }); } catch {}
    clean();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
  setInterval(clean, 1200);
})();
