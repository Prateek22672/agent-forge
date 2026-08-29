// Cosmetic ad + anti-adblock-nag removal on every page. The DNR rules block ad
// NETWORK requests; this hides leftover ad containers and removes "disable your
// ad blocker" nag overlays (restoring any scroll-lock they apply).
//
// LIGHTWEIGHT BY DESIGN — it must never freeze or heat a tab:
//   * NO whole-page MutationObserver (that fed back on itself and pegged the CPU)
//   * NO scanning of every <div> on the page — nag candidates are found by
//     targeted attribute selectors only (usually 0-few matches)
//   * runs on a slow 1.5s interval, all queries are bounded
// Honours the global pause.
(function () {
  let paused = false;
  let pausedHosts = [];
  const HOST = location.hostname.replace(/^www\./, "");
  const isPaused = () => paused || pausedHosts.indexOf(HOST) !== -1;
  try {
    chrome.storage.local.get(["paused", "pausedHosts"], (r) => {
      paused = r.paused === true;
      pausedHosts = Array.isArray(r.pausedHosts) ? r.pausedHosts : [];
    });
    chrome.storage.onChanged.addListener((c) => {
      if (c.paused) paused = c.paused.newValue === true;
      if (c.pausedHosts) pausedHosts = Array.isArray(c.pausedHosts.newValue) ? c.pausedHosts.newValue : [];
    });
  } catch {}

  // Specific leftover ad containers (already network-blocked; this hides shells).
  const AD = [
    ".adsbygoogle",
    "ins.adsbygoogle",
    '[id*="google_ads"]',
    '[id*="-ad-slot"]',
    '[class*="ad-slot"]',
    '[class*="ad-banner"]',
    '[class*="adBanner"]',
    '[aria-label="Advertisement"]',
    '[data-ad-slot]',
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    "#taboola-below-article",
    '[id^="taboola"]',
  ];

  // Nag overlays are matched by name only — no full-DOM scan.
  const NAG_SEL =
    '[class*="adblock" i],[id*="adblock" i],[class*="ad-block" i],[id*="ad-block" i],' +
    '[class*="anti-adblock" i],[class*="detect-adblock" i],[class*="adblocker" i],[id*="adblocker" i]';

  const report = (n) => {
    if (n > 0) {
      try { chrome.runtime.sendMessage({ type: "NOADS_REMOVED", n }); } catch {}
    }
  };

  const clean = () => {
    if (isPaused()) return;
    try {
      // 1. Leftover ad containers (bounded selectors). Not counted — the network
      //    block behind them is already counted by the toolbar badge.
      AD.forEach((s) => {
        let nodes;
        try { nodes = document.querySelectorAll(s); } catch { return; }
        nodes.forEach((el) => el && el.remove());
      });

      // 2. Anti-adblock nag overlays — only elements literally named like a
      //    detector, and only if they behave like a blocking overlay.
      let nags;
      try { nags = document.querySelectorAll(NAG_SEL); } catch { nags = []; }
      let removedNag = 0;
      nags.forEach((el) => {
        let cs;
        try { cs = getComputedStyle(el); } catch { return; }
        if (cs.position === "fixed" || cs.position === "absolute" || (+cs.zIndex || 0) > 999) {
          el.remove();
          removedNag++;
        }
      });

      // 3. Only undo scroll-lock / blur if we actually killed a nag (so we never
      //    fight normal sites).
      if (removedNag) {
        try { if (getComputedStyle(document.body).overflow === "hidden") document.body.style.overflow = "auto"; } catch {}
        try {
          const de = document.documentElement;
          if (getComputedStyle(de).overflow === "hidden") de.style.overflow = "auto";
        } catch {}
        try { if (getComputedStyle(document.body).filter !== "none") document.body.style.filter = "none"; } catch {}
        report(removedNag);
      }
    } catch {}
  };

  setInterval(clean, 1500);
  clean();
})();
