// Cosmetic ad removal + anti-adblock-nag removal, on every page.
//
// declarativeNetRequest blocks ad NETWORK requests; this handles the two things
// it can't: (1) ad containers that still take up space, and (2) "please disable
// your ad blocker" nag overlays that some sites throw up. Best-effort and fails
// safe — if a site's markup doesn't match, it simply does nothing. Skipped
// entirely while the user has paused blocking from the popup.
(function () {
  let paused = false;
  try {
    chrome.storage.local.get("paused", (r) => (paused = r.paused === true));
    chrome.storage.onChanged.addListener((c) => {
      if (c.paused) paused = c.paused.newValue === true;
    });
  } catch {}

  // Common ad-container selectors (kept specific to avoid nuking real content).
  const AD = [
    ".adsbygoogle",
    "ins.adsbygoogle",
    '[id^="ad-"]',
    '[id*="google_ads"]',
    '[id*="-ad-slot"]',
    '[class*="ad-slot"]',
    '[class*="ad-banner"]',
    '[class*="adBanner"]',
    '[aria-label="Advertisement"]',
    '[aria-label="Advertisements"]',
    '[data-ad-slot]',
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="/ads/"]',
    "#taboola-below-article",
    '[id^="taboola"]',
    '[class*="trc_related"]',
  ];

  // Hints that an element is an anti-adblock nag (only removed if it behaves
  // like a blocking overlay — fixed/absolute and high z-index or full-screen).
  const NAG = ["adblock", "ad-block", "ad_block", "disable-adblock", "anti-adblock", "adblocker", "detect-adblock"];

  const clean = () => {
    if (paused) return;
    try {
      AD.forEach((s) => document.querySelectorAll(s).forEach((el) => el && el.remove()));

      const nodes = document.querySelectorAll("div,section,aside,dialog,ytd-popup-container");
      for (const el of nodes) {
        const cls = typeof el.className === "string" ? el.className : "";
        const idc = (el.id + " " + cls).toLowerCase();
        if (!NAG.some((h) => idc.includes(h))) continue;
        let cs;
        try {
          cs = getComputedStyle(el);
        } catch {
          continue;
        }
        const overlay = cs.position === "fixed" || cs.position === "absolute" || (+cs.zIndex || 0) > 999;
        if (overlay) el.remove();
      }

      // Undo the scroll-lock nags apply so the page is usable again.
      if (getComputedStyle(document.body).overflow === "hidden") document.body.style.overflow = "auto";
      const de = document.documentElement;
      if (getComputedStyle(de).overflow === "hidden") de.style.overflow = "auto";
      // Remove blur some nags put on the page behind their overlay.
      if (getComputedStyle(document.body).filter !== "none") document.body.style.filter = "none";
    } catch {}
  };

  const start = () => {
    try {
      new MutationObserver(clean).observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
    clean();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
  setInterval(clean, 1200);
})();
