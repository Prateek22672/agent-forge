// Advanced YouTube ad removal — runs in the PAGE's own context (world: MAIN) so
// it can intercept YouTube's player API *response* and delete the ad data before
// the player reads it. Result: YouTube never schedules an ad, so nothing plays,
// nothing stalls, and no "Skip" race is needed. The video's streamingData is
// untouched, so playback is normal. Belt-and-suspenders with content-youtube.js.
(function () {
  "use strict";

  const strip = (o) => {
    if (!o || typeof o !== "object") return o;
    try {
      if ("adPlacements" in o) o.adPlacements = [];
      if ("playerAds" in o) o.playerAds = [];
      if ("adSlots" in o) o.adSlots = [];
      if ("adBreakHeartbeatParams" in o) delete o.adBreakHeartbeatParams;
      if (o.playerResponse) strip(o.playerResponse);
      if (o.playerConfig && o.playerConfig.daiConfig) delete o.playerConfig.daiConfig;
    } catch {}
    return o;
  };

  // 1) The first video's player data is embedded in the page as
  //    ytInitialPlayerResponse — catch it via a setter and strip its ads.
  try {
    let _ipr;
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get() {
        return _ipr;
      },
      set(v) {
        _ipr = strip(v);
      },
    });
  } catch {}

  // 2) Every later video (SPA navigation) is fetched from /youtubei/v1/player.
  //    Strip ads from that JSON response.
  try {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        if (url.includes("/youtubei/v1/player") || url.includes("/youtubei/v1/next")) {
          const data = strip(await res.clone().json());
          return new Response(JSON.stringify(data), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
      } catch {}
      return res;
    };
  } catch {}
})();
