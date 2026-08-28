// Advanced YouTube ad removal — runs in the PAGE's own context (world: MAIN) so
// it can intercept YouTube's player API *response* and delete the ad data before
// the player reads it. Result: YouTube never schedules an ad, so nothing plays,
// nothing stalls, and no "Skip" is needed. streamingData is untouched, so the
// real video plays normally. Fail-safe partner: content-youtube.js.
(function () {
  "use strict";

  const strip = (o) => {
    if (!o || typeof o !== "object") return o;
    try {
      if ("adPlacements" in o) o.adPlacements = [];
      if ("adSlots" in o) o.adSlots = [];
      if ("playerAds" in o) o.playerAds = [];
      if ("adBreakHeartbeatParams" in o) delete o.adBreakHeartbeatParams;
      if (o.playerConfig && o.playerConfig.daiConfig) delete o.playerConfig.daiConfig;
      // Ad data can be nested one level down in some responses.
      if (o.playerResponse) strip(o.playerResponse);
      if (o.response) strip(o.response);
    } catch {}
    return o;
  };

  const isPlayerUrl = (u) =>
    typeof u === "string" &&
    (u.includes("/youtubei/v1/player") ||
      u.includes("/youtubei/v1/next") ||
      u.includes("/youtubei/v1/reel"));

  // 1) The first video's data is embedded as ytInitialPlayerResponse — catch it
  //    via a setter and strip its ads before the player reads it.
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

  // 2) Every later video (SPA navigation) is fetched from the player endpoints.
  //    Strip ads from that JSON response. Rebuild the Response with clean
  //    headers so the re-stringified body isn't rejected as gzip/length-mismatch.
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
