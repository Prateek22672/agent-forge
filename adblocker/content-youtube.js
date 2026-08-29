// YouTube ad fail-safe — MINIMAL & SAFE. The real blocking is done passively by
// yt-adfree.js (it prunes ad data from the player response so ads never
// schedule). This only mops up anything that still slips through, and is tiny so
// it can NEVER freeze or heat the tab: no MutationObserver, one light 500ms
// timer, bounded queries. Honours the global pause AND a per-site pause.
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

  const SKIP = [
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-container button",
  ];
  const clickSkip = () => {
    for (const s of SKIP) {
      const el = document.querySelector(s);
      if (el) {
        try { el.click(); } catch {}
        try {
          ["pointerdown", "pointerup", "click"].forEach((t) =>
            el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
          );
        } catch {}
        return true;
      }
    }
    return false;
  };

  const tick = () => {
    if (isPaused()) return;
    try {
      const player = document.querySelector(".html5-video-player");
      if (player && player.classList.contains("ad-showing")) {
        // Skippable ad → click Skip. Unskippable slip-through → fast-forward it
        // out (bounded, so it can't get stuck on a live/broken duration).
        if (!clickSkip()) {
          const v = player.querySelector("video");
          if (v) {
            v.muted = true;
            const d = v.duration;
            if (isFinite(d) && d > 0 && d < 600) {
              try { v.currentTime = d; } catch {}
            }
            try { v.playbackRate = 10; } catch {}
          }
        }
      }
      // Static overlay / banner / feed / companion ad containers (bounded).
      document.querySelectorAll(".ytp-ad-overlay-close-button").forEach((b) => {
        try { b.click(); } catch {}
      });
      [
        ".ytp-ad-overlay-slot",
        "#player-ads",
        "ytd-ad-slot-renderer",
        "ytd-in-feed-ad-layout-renderer",
        "ytd-companion-slot-renderer",
        "#masthead-ad",
      ].forEach((s) => document.querySelectorAll(s).forEach((el) => el.remove()));
    } catch {}
  };

  // Relay the genuine, de-duplicated ad count from yt-adfree.js (MAIN world) to
  // the counter. This is the only place YouTube ads are counted — one batch per
  // video — so the number is real, not inflated.
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__noads === true && e.data.blocked > 0 && !isPaused()) {
      try { chrome.runtime.sendMessage({ type: "NOADS_REMOVED", n: e.data.blocked }); } catch {}
    }
  });

  setInterval(tick, 500);
  tick();
})();
