// Cosmetic ad + anti-adblock-nag removal on every page. The DNR rules block ad
// NETWORK requests; this takes the leftovers out of the page entirely — the ad
// element, any ad video/audio still playing inside it, AND the empty wrapper it
// leaves behind, so there is no blank gap where the ad used to be. It also
// removes "disable your ad blocker" nag overlays (restoring any scroll-lock
// they apply).
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
  //
  // NOTE ON MATCHING: [class*="ad-slot"] is a trap — a substring match also hits
  // "upload-slot", just as "ad-container" hits "head-container" and "ad-wrapper"
  // hits "download-wrapper". Every ad-* name below is therefore anchored to the
  // START of a class token (^= for the first class, *=" " for any later one), so
  // we only ever match a class that really begins "ad-".
  const adToken = (t) => ['[class^="' + t + '"]', '[class*=" ' + t + '"]'];
  const AD = [
    ".adsbygoogle",
    "ins.adsbygoogle",
    '[id*="google_ads"]',
    '[id^="google_ads_iframe"]',
    '[id^="div-gpt-ad"]',
    "[data-google-query-id]",
    '[id*="-ad-slot"]',
    ...adToken("ad-slot"),
    ...adToken("ad-banner"),
    ...adToken("ad-container"),
    ...adToken("ad-wrapper"),
    ...adToken("adBanner"),
    ...adToken("sticky-ad"),
    ...adToken("ad-sticky"),
    '[id^="sticky-ad"]',
    '[class*="sponsored-post"]',
    '[aria-label="Advertisement"]',
    '[aria-label^="Ads by"]',
    "[data-ad-slot]",
    "[data-ad-client]",
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="adservice."]',
    "#taboola-below-article",
    '[id^="taboola"]',
    '[id^="outbrain"]',
    '[class*="OUTBRAIN"]',
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

  // An ad video that is merely detached can keep playing audio in some engines,
  // and an ad iframe can keep running timers. Stop them before dropping the node.
  const silence = (el) => {
    const stop = (m) => {
      try { m.pause(); } catch {}
      try { m.muted = true; } catch {}
      try { m.removeAttribute("src"); m.load(); } catch {}
    };
    try {
      if (el.tagName === "VIDEO" || el.tagName === "AUDIO") stop(el);
      el.querySelectorAll("video,audio").forEach(stop);
      if (el.tagName === "IFRAME") { try { el.src = "about:blank"; } catch {} }
      el.querySelectorAll("iframe").forEach((f) => { try { f.src = "about:blank"; } catch {} });
    } catch {}
  };

  // Removing the ad often leaves its wrapper behind holding reserved height —
  // a blank gap mid-article. Walk up a few levels and drop wrappers that are now
  // genuinely empty. Guarded hard: anything with real content, or the page's own
  // structure, is left alone.
  const KEEP = /^(BODY|HTML|HEAD|MAIN|ARTICLE|NAV|HEADER|FOOTER|SECTION|FORM|UL|OL|TABLE)$/;
  const collapse = (start) => {
    let p = start;
    for (let hops = 0; p && hops < 3; hops++) {
      if (KEEP.test(p.tagName) || p.id === "content" || p.childElementCount > 0) break;
      if ((p.textContent || "").trim()) break;
      const next = p.parentElement;
      try { p.remove(); } catch { break; }
      p = next;
    }
  };

  const nuke = (el) => {
    if (!el || !el.parentElement) return;
    const parent = el.parentElement;
    silence(el);
    try { el.remove(); } catch { return; }
    collapse(parent);
  };

  const clean = () => {
    if (isPaused()) return;
    try {
      // 1. Leftover ad containers (bounded selectors). Not counted — the network
      //    block behind them is already counted by the toolbar badge.
      AD.forEach((s) => {
        let nodes;
        try { nodes = document.querySelectorAll(s); } catch { return; }
        nodes.forEach(nuke);
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
          nuke(el);
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
