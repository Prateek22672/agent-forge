// YouTube ad fail-safe. Ads are NOT network-blocked (that stalls the player);
// yt-adfree.js strips ads from the player response so most never schedule. This
// is the guaranteed catch-all: the instant an ad slips through, auto-skip it or
// fast-forward it to the end so the real video plays with NO manual click and no
// lingering "end of ad" frame. Reacts within a frame by watching the player's
// class attribute (.ad-showing) instead of polling slowly. Honours pause.
(function () {
  let paused = false;
  try {
    chrome.storage.local.get("paused", (r) => (paused = r.paused === true));
    chrome.storage.onChanged.addListener((c) => {
      if (c.paused) paused = c.paused.newValue === true;
    });
  } catch {}

  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-container button",
    "button.ytp-ad-skip-button-modern",
  ];

  const nuke = () => {
    if (paused) return;
    try {
      const player = document.querySelector(".html5-video-player");
      const adShowing = player && player.classList.contains("ad-showing");

      // 1. Click any skip button the instant it exists — no manual click.
      for (const sel of SKIP_SELECTORS) {
        const b = document.querySelector(sel);
        if (b) {
          b.click();
          break;
        }
      }

      // 2. An ad is actually on screen → jump straight to its end, muted, at max
      //    speed, so not even the last frame lingers. Only while ad-showing, so
      //    the real video is never touched.
      if (adShowing) {
        const v = player.querySelector("video");
        if (v) {
          v.muted = true;
          const end = isFinite(v.duration) && v.duration > 0 ? v.duration : v.currentTime + 60;
          try { v.currentTime = end; } catch {}
          try { v.playbackRate = 16; } catch {}
        }
      }

      // 3. Overlay / banner / feed / companion ads.
      document
        .querySelectorAll(".ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container")
        .forEach((b) => b.click());
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

  // React within a frame: hook the video element's own events instead of only
  // polling. timeupdate fires ~4x/sec while any (ad) video plays.
  const hook = (v) => {
    if (!v || v.__noads) return;
    v.__noads = true;
    ["timeupdate", "loadedmetadata", "play", "playing", "durationchange"].forEach((ev) =>
      v.addEventListener(ev, nuke, true)
    );
  };
  const findVideo = () => {
    const v = document.querySelector(".html5-main-video, video");
    if (v) hook(v);
  };

  const start = () => {
    try {
      // attributeFilter:["class"] fires the moment YouTube adds/removes
      // .ad-showing on the player — the fastest possible ad signal.
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
  }, 250);
})();
