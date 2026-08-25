// YouTube ad skipper. Network blocking (declarativeNetRequest) can't stop
// YouTube ads because they're served from the same domain as the video — so we
// handle them in the page: click "Skip", fast-forward un-skippable ads to the
// end + mute them, and strip overlay/banner ads. YouTube changes its markup
// often; every step fails safe (does nothing if a selector no longer matches).
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
      // 1. Click any visible skip button (several class variants over time).
      document
        .querySelectorAll(
          ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button"
        )
        .forEach((b) => b.click());

      // 2. If an ad is actually playing, jump to its end and mute it.
      const player = document.querySelector(".html5-video-player");
      if (player && player.classList.contains("ad-showing")) {
        const v = document.querySelector("video");
        if (v && isFinite(v.duration) && v.duration > 0) {
          try {
            v.currentTime = v.duration;
            v.muted = true;
          } catch {}
        }
      }

      // 3. Overlay / banner / promoted ads.
      document.querySelectorAll(".ytp-ad-overlay-close-button").forEach((b) => b.click());
      [
        ".ytp-ad-overlay-slot",
        ".ytp-ad-image-overlay",
        "#player-ads",
        "ytd-ad-slot-renderer",
        ".ytd-ad-slot-renderer",
        "ytd-promoted-sparkles-web-renderer",
        "ytd-in-feed-ad-layout-renderer",
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
  setInterval(skip, 700);
})();
