// YouTube ad fail-safe — MINIMAL & SAFE. The real work is done passively by
// yt-adfree.js, which strips ads from the player-response JSON so they never
// schedule. This script only handles anything that slips through, and is
// deliberately tiny so it can NEVER freeze or heat the tab:
//   * NO MutationObserver, NO video seeking, NO playbackRate hacks
//     (those caused the stuck-black frame + CPU meltdown)
//   * one light 700ms timer: click Skip if present, mute the ad, drop static
//     ad containers — all bounded queries
// Honours the global pause.
(function () {
  let paused = false;
  try {
    chrome.storage.local.get("paused", (r) => (paused = r.paused === true));
    chrome.storage.onChanged.addListener((c) => {
      if (c.paused) paused = c.paused.newValue === true;
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

  const report = (n) => {
    if (n > 0 && !paused) {
      try { chrome.runtime.sendMessage({ type: "NOADS_REMOVED", n }); } catch {}
    }
  };

  let wasAd = false;
  const tick = () => {
    if (paused) return;
    try {
      const player = document.querySelector(".html5-video-player");
      const adShowing = player && player.classList.contains("ad-showing");
      if (adShowing) {
        if (!wasAd) { wasAd = true; report(1); } // count each slipped-through ad
        clickSkip();
        const v = player.querySelector("video");
        if (v) v.muted = true; // mute only — no seeking (seeking stuck the player)
      } else {
        wasAd = false;
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

  // Count ads stripped by yt-adfree.js (MAIN world) so the popup number reflects
  // YouTube ads blocked, not just cosmetic/network ones.
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__noads === true && e.data.blocked > 0) {
      report(e.data.blocked);
    }
  });

  setInterval(tick, 700);
  tick();
})();
