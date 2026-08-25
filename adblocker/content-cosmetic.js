// Cosmetic ad removal + anti-adblock-nag removal on every page. The DNR rules
// block ad NETWORK requests; this hides leftover ad containers and removes
// "disable your ad blocker" nag overlays (and restores the scroll they lock).
// Counts what it removes so the popup's total reflects it. Fails safe; honours
// the global pause.
(function () {
  let paused = false;
  try {
    chrome.storage.local.get("paused", (r) => (paused = r.paused === true));
    chrome.storage.onChanged.addListener((c) => {
      if (c.paused) paused = c.paused.newValue === true;
    });
  } catch {}

  const AD = [
    ".adsbygoogle", "ins.adsbygoogle", '[id^="ad-"]', '[id*="google_ads"]', '[id*="-ad-slot"]',
    '[class*="ad-slot"]', '[class*="ad-banner"]', '[class*="adBanner"]',
    '[aria-label="Advertisement"]', '[data-ad-slot]',
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
    if (paused) return;
    try {
      AD.forEach((s) => {
        let nodes;
        try { nodes = document.querySelectorAll(s); } catch { return; }
        nodes.forEach((el) => { if (el) { el.remove(); pending++; } });
      });
      const nodes = document.querySelectorAll("div,section,aside,dialog");
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
