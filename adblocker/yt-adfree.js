// Advanced YouTube ad removal — runs in the PAGE's own context (world: MAIN) so
// it can intercept YouTube's player-API *response* and delete the ad data before
// the player reads it. Result: YouTube never schedules an ad, so nothing plays,
// nothing stalls, no "Skip" is needed. streamingData is untouched, so the real
// video plays normally. This is passive (no loops/DOM work) so it can't freeze
// the tab. It reports how many ads it removed to content-youtube.js for the
// popup counter, via window.postMessage.
(function () {
  "use strict";

  const bump = (n) => {
    if (n > 0) {
      try { window.postMessage({ __noads: true, blocked: n }, "*"); } catch {}
    }
  };

  // Clear ad arrays in place and return how many ad entries were removed.
  const clearAds = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 4) return 0;
    let n = 0;
    try {
      if (Array.isArray(o.adPlacements)) { n += o.adPlacements.length; o.adPlacements = []; }
      if (Array.isArray(o.playerAds)) { n += o.playerAds.length; o.playerAds = []; }
      if (Array.isArray(o.adSlots)) { n += o.adSlots.length; o.adSlots = []; }
      if ("adBreakHeartbeatParams" in o) delete o.adBreakHeartbeatParams;
      if (o.playerConfig && o.playerConfig.daiConfig) delete o.playerConfig.daiConfig;
      if (o.playerResponse) n += clearAds(o.playerResponse, depth + 1);
      if (o.response) n += clearAds(o.response, depth + 1);
    } catch {}
    return n;
  };

  const strip = (o) => {
    const n = clearAds(o, 0);
    if (n) bump(n);
    return o;
  };

  const isPlayerUrl = (u) =>
    typeof u === "string" &&
    (u.includes("/youtubei/v1/player") ||
      u.includes("/youtubei/v1/next") ||
      u.includes("/youtubei/v1/reel"));

  // 1) First video: data embedded as ytInitialPlayerResponse — strip via setter.
  try {
    let _ipr;
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get() { return _ipr; },
      set(v) { _ipr = strip(v); },
    });
  } catch {}

  // 2) Later videos (SPA navigation): fetched from the player endpoints. Strip
  //    the JSON and rebuild the Response with clean headers so the re-stringified
  //    body isn't rejected for a gzip/content-length mismatch.
  try {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        if (isPlayerUrl(url)) {
          const data = strip(await res.clone().json());
          const h = new Headers(res.headers);
          h.delete("content-length");
          h.delete("content-encoding");
          return new Response(JSON.stringify(data), {
            status: res.status,
            statusText: res.statusText,
            headers: h,
          });
        }
      } catch {}
      return res;
    };
  } catch {}
})();
