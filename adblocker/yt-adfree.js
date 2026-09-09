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

  // ---- anti-adblock enforcement -------------------------------------------
  //
  // YouTube now ships a nag ("Video player will be blocked after 3 videos") and
  // then refuses to play. Removing the dialog from the DOM afterwards is a race
  // we lose — by the time the element exists, playback is already stopped and
  // the counter has advanced.
  //
  // So it is handled where the ads are: in the response, before the page reads
  // it. The enforcement arrives as a popup action in ytInitialData and, when it
  // escalates, as a playabilityStatus of ERROR/UNPLAYABLE whose reason mentions
  // the blocker. Both are removed here, and the status is put back to OK so the
  // player simply plays.
  const ENFORCE_KEYS = [
    "enforcementMessageViewModel",
    "adBlockerMessageViewModel",
    "ytdEnforcementMessageViewModel",
  ];

  const isEnforcement = (o) => {
    for (const k of ENFORCE_KEYS) if (o[k]) return true;
    // The same payload also travels wrapped in a generic popup renderer.
    const p = o.popup || o.openPopupAction;
    if (p && typeof p === "object") {
      for (const k of ENFORCE_KEYS) if (p[k] || (p.popup && p.popup[k])) return true;
    }
    return false;
  };

  // Bounded walk: enforcement nodes are shallow in practice, and this runs on
  // every parse, so it must not turn into a deep traversal of huge payloads.
  const stripEnforcement = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 6) return 0;
    let hits = 0;
    if (Array.isArray(o)) {
      for (let i = o.length - 1; i >= 0; i--) {
        const v = o[i];
        if (v && typeof v === "object" && isEnforcement(v)) { o.splice(i, 1); hits++; }
        else hits += stripEnforcement(v, depth + 1);
      }
      return hits;
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (!v || typeof v !== "object") continue;
      if (isEnforcement(v)) { delete o[k]; hits++; continue; }
      hits += stripEnforcement(v, depth + 1);
    }
    return hits;
  };

  // A playability status that blames the blocker is the hard block. Put it back
  // to OK and drop the error renderer the player would show instead of video.
  const BLOCK_REASON = /ad blocker|adblock|blocked|allowlist|allow ?list/i;
  const unblockPlayability = (o) => {
    const ps = o && o.playabilityStatus;
    if (!ps || typeof ps !== "object") return 0;
    const bad = ps.status && ps.status !== "OK";
    const blames = BLOCK_REASON.test(
      (ps.reason || "") + " " + JSON.stringify(ps.errorScreen || "").slice(0, 400)
    );
    if (!bad && !blames) return 0;
    if (!blames) return 0; // a genuinely private/removed video must stay blocked
    ps.status = "OK";
    delete ps.reason;
    delete ps.errorScreen;
    delete ps.messages;
    return 1;
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
      unblockPlayability(o);
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
      try {
        const n = prune(data);
        if (n) countForVideo(n);
        // Only walk for enforcement when the raw text actually mentions it —
        // this runs on every JSON.parse the page makes, so the common case has
        // to be a single substring check, not a tree traversal.
        if (typeof text === "string" && text.indexOf("nforcementMessage") !== -1) {
          stripEnforcement(data, 0);
        }
      } catch {}
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
        try {
          const n = prune(data);
          if (n) countForVideo(n);
          // No raw text here, so guard on the containers enforcement arrives in
          // rather than walking every response the player fetches.
          if (data && (data.popup || data.onResponseReceivedActions || data.responseContext)) {
            stripEnforcement(data, 0);
          }
        } catch {}
        return data;
      });
    };
  } catch {}

  // 3b) ytInitialData — the enforcement popup rides here on a cold page load,
  //     not in the player response, so the setter above never sees it.
  try {
    let _idata;
    Object.defineProperty(window, "ytInitialData", {
      configurable: true,
      get() { return _idata; },
      set(v) {
        try { stripEnforcement(v, 0); } catch {}
        _idata = v;
      },
    });
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
