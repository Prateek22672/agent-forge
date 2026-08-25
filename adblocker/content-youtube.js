// YouTube ad skipper. YouTube ads are NOT network-blocked (that stalls the
// player) — the DNR rules exclude youtube.com, and we handle ads here instead:
// click Skip the instant it appears, and fast-forward un-skippable ads to their
// end while muted so the real video starts immediately. Fails safe on markup
// changes. Honours the global pause.
(function () {
  let paused = false;
  try {
    chrome.storage.local.get("paused", (r) => (paused = r.paused === true));
    chrome.storage.onChanged.addListener((c) => {
      if (c.paused) paused = c.paused.newValue === true;
    });
  } catch {}

  const skip = () => {
    if (paused) return;
    try {
      // 1. Skip button (several variants over the years).
      const btn = document.querySelector(
        ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button"
      );
      if (btn) btn.click();

      // 2. Un-skippable ad → jump to its end (muted). Only while an ad is
      //    actually playing, so we never touch the real video.
      const player = document.querySelector(".html5-video-player");
      if (player && player.classList.contains("ad-showing")) {
        const v = player.querySelector("video");
        if (v && isFinite(v.duration) && v.duration > 0) {
          v.muted = true;
          v.currentTime = v.duration;
        }
      }

      // 3. Overlay / banner / feed ads.
      document.querySelectorAll(".ytp-ad-overlay-close-button").forEach((b) => b.click());
      [
        ".ytp-ad-overlay-slot",
        "#player-ads",
        "ytd-ad-slot-renderer",
        ".ytd-ad-slot-renderer",
        "ytd-in-feed-ad-layout-renderer",
        "ytd-promoted-sparkles-web-renderer",
        "#masthead-ad",
      ].forEach((s) => document.querySelectorAll(s).forEach((el) => el.remove()));
    } catch {}
  };

  const start = () => {
    try {
      new MutationObserver(skip).observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
    skip();
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
  setInterval(skip, 400);
})();
