// YouTube ad fail-safe. Ads are NOT network-blocked (that stalls the player);
// yt-adfree.js strips ads from the player response so most never schedule. This
// is the guaranteed catch-all for ads that still slip through — including ad
// PODS (2-4 back-to-back, mix of skippable + unskippable):
//   * skippable ad  -> force-click Skip the instant the button exists
//                      (YouTube blocks seeking during ads, so a click is the
//                       only reliable skip)
//   * unskippable   -> jump to the end, muted, at max speed
// Reacts within a frame by watching the player's .ad-showing class. Honours pause.
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
    "button.ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-modern button",
    ".videoAdUiSkipButton",
  ];

  // Some skip buttons listen on pointerup, not click — fire the whole sequence.
  const forceClick = (el) => {
    try { el.click(); } catch {}
    try {
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
      );
    } catch {}
  };

  const clickSkip = () => {
    for (const s of SKIP) {
      const el = document.querySelector(s);
      if (el) { forceClick(el); return true; }
    }
    // Fallback: any "skip"-ish button inside the player (class name changes).
    const p = document.querySelector("#movie_player, .html5-video-player");
    if (p) {
      const c = p.querySelector(
        'button[class*="skip" i], [class*="skip" i][role="button"], a[class*="skip" i]'
      );
      if (c) { forceClick(c); return true; }
    }
    return false;
  };

  const nuke = () => {
    if (paused) return;
    try {
      const player = document.querySelector(".html5-video-player");
      const adShowing = player && player.classList.contains("ad-showing");

      if (adShowing) {
        // Prefer the Skip button; if there isn't one, fast-forward the ad out.
        if (!clickSkip()) {
          const v = player.querySelector("video");
          if (v) {
            v.muted = true;
            const d = v.duration;
            try { v.currentTime = isFinite(d) && d > 0 ? d : 1e7; } catch {}
            try { v.playbackRate = 16; } catch {}
          }
        }
      } else {
        // The Skip button can render a frame before .ad-showing settles.
        clickSkip();
      }

      // Overlay / banner / feed / companion ads.
      document
        .querySelectorAll(".ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container")
        .forEach((b) => forceClick(b));
      [
        ".ytp-ad-overlay-slot",
        ".ytp-ad-overlay-container",
        "#player-ads",
        "ytd-ad-slot-renderer",
        ".ytd-ad-slot-renderer",
        "ytd-in-feed-ad-layout-renderer",
        "ytd-promoted-sparkles-web-renderer",
        "ytd-companion-slot-renderer",
        "#masthead-ad",
      ].forEach((s) => document.querySelectorAll(s).forEach((el) => el.remove()));
    } catch {}
  };

  // React within a frame: hook the video element's own events, not just a poll.
  const hook = (v) => {
    if (!v || v.__noads) return;
    v.__noads = true;
    ["timeupdate", "loadedmetadata", "play", "playing", "durationchange", "progress"].forEach(
      (ev) => v.addEventListener(ev, nuke, true)
    );
  };
  const findVideo = () => {
    document.querySelectorAll(".html5-main-video, video").forEach(hook);
  };

  const start = () => {
    try {
      // attributeFilter:["class"] fires the instant YouTube toggles .ad-showing.
      new MutationObserver(() => {
        nuke();
        findVideo();
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    } catch {}
    findVideo();
    nuke();
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
  setInterval(() => {
    nuke();
    findVideo();
  }, 200);
})();
