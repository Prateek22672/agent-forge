// YouTube ad remover — runs in the PAGE context (world: MAIN, document_start).
// This is the real blocker: it deletes ad data from YouTube's player responses
// BEFORE the player reads them, so ads are never scheduled — the main video
// plays seamlessly, no stall, no "skip". It's the method working blockers use
// (uBlock's json-prune, youtube-webos, adblock userscripts): intercept every
// path the player data can arrive by and prune the ad fields.
//
//   1. JSON.parse override       — XHR/desktop-client JSON the page parses itself
//   2. Response.prototype.json   — fetch().json(), how SPA navigations load ads
//   3. ytInitialPlayerResponse   — the first video, embedded in the HTML
//
// Passive (no loops, no DOM, no observers) so it cannot freeze or heat the tab.
// Counts ad breaks removed — ONCE per video (deduped) — so the popup number is
// genuine, not inflated by YouTube re-fetching the same video's data.
(function () {
  "use strict";

  const bump = (n) => {
    if (n > 0) {
      try { window.postMessage({ __noads: true, blocked: n }, "*"); } catch {}
    }
  };

  // Count each video's ad breaks only once — YouTube fetches the player response
  // several times per video (quality changes, retries), and we must not count
  // the same ads on each fetch. Keyed by the ?v= id.
  let lastCountedVid = null;
  const countForVideo = (n) => {
    if (n <= 0) return;
    let vid = "";
    try { vid = new URLSearchParams(location.search).get("v") || location.pathname; } catch {}
    if (vid && vid === lastCountedVid) return;
    lastCountedVid = vid;
    bump(n);
  };

  // Delete ad data from a player-response-shaped object; return ad breaks removed.
  const prune = (o) => {
    if (!o || typeof o !== "object") return 0;
    let n = 0;
    try {
      if (Array.isArray(o.adPlacements)) { n += o.adPlacements.length; o.adPlacements = []; }
      if (Array.isArray(o.playerAds)) { if (!n) n += o.playerAds.length; o.playerAds = []; }
      if (Array.isArray(o.adSlots)) { o.adSlots = []; }
      if (o.adBreakHeartbeatParams) delete o.adBreakHeartbeatParams;
      if (o.playerConfig && o.playerConfig.daiConfig) delete o.playerConfig.daiConfig;
      // The /youtubei/v1/next payload wraps the real playerResponse one level in.
      if (o.playerResponse && typeof o.playerResponse === "object") n += prune(o.playerResponse);
    } catch {}
    return n;
  };

  // 1) JSON.parse — catches anything the page parses itself (incl. XHR player
  //    responses). Cheap: prune only checks a handful of top-level keys.
  try {
    const origParse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const data = origParse.call(this, text, reviver);
      try { const n = prune(data); if (n) countForVideo(n); } catch {}
      return data;
    };
  } catch {}

  // 2) Response.prototype.json — how the desktop player loads each video's data
  //    on SPA navigation (fetch(/youtubei/v1/player).json()). Prune the resolved
  //    object regardless of URL, so we never miss it.
  try {
    const origJson = Response.prototype.json;
    Response.prototype.json = function () {
      return origJson.apply(this, arguments).then((data) => {
        try { const n = prune(data); if (n) countForVideo(n); } catch {}
        return data;
      });
    };
  } catch {}

  // 3) ytInitialPlayerResponse — the first video's data, embedded in the HTML as
  //    a JS object literal (never JSON.parse'd), caught via a property setter.
  try {
    let _ipr;
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get() { return _ipr; },
      set(v) {
        try { const n = prune(v); if (n) countForVideo(n); } catch {}
        _ipr = v;
      },
    });
  } catch {}
})();
