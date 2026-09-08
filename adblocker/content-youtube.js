// YouTube ad fail-safe — MINIMAL & SAFE. The real blocking is done passively by
// yt-adfree.js (it prunes ad data from the player response so ads never
// schedule). This only mops up anything that still slips through, and is tiny so
// it can NEVER freeze or heat the tab: no MutationObserver, one light 500ms
// timer, bounded queries. Honours the global pause AND a per-site pause.
//
// It also owns the on-video notice: YouTube reacts to an ad being taken out by
// showing its own "Experiencing interruptions?" toast (and, sometimes, an
// anti-adblock nag). That blames us for a stall that never happened, so we
// suppress it and put an honest message in its place — what we just stopped and
// how much watching time it saved.
(function () {
  let paused = false;
  let pausedHosts = [];
  let notice = true; // on-video notice; user can switch it off in the popup
  let totalBlocked = 0;
  let totalSaved = 0; // all-time seconds of ads not watched
  const HOST = location.hostname.replace(/^www\./, "");
  const isPaused = () => paused || pausedHosts.indexOf(HOST) !== -1;
  try {
    chrome.storage.local.get(
      ["paused", "pausedHosts", "notice", "totalBlocked", "timeSaved"],
      (r) => {
        paused = r.paused === true;
        pausedHosts = Array.isArray(r.pausedHosts) ? r.pausedHosts : [];
        notice = r.notice !== false;
        totalBlocked = r.totalBlocked || 0;
        totalSaved = r.timeSaved || 0;
      }
    );
    chrome.storage.onChanged.addListener((c) => {
      if (c.paused) paused = c.paused.newValue === true;
      if (c.pausedHosts) pausedHosts = Array.isArray(c.pausedHosts.newValue) ? c.pausedHosts.newValue : [];
      if (c.notice) notice = c.notice.newValue !== false;
      if (c.totalBlocked) totalBlocked = c.totalBlocked.newValue || 0;
      if (c.timeSaved) totalSaved = c.timeSaved.newValue || 0;
    });
  } catch {}

  // A pruned ad break never plays, so its length is never observable. 20s is a
  // deliberately conservative stand-in for a break (YouTube pre-rolls are
  // typically one 30s spot or two 15s ones) — we'd rather under-promise. Ads we
  // actually fast-forward are measured for real, not estimated.
  const EST_SEC_PER_BREAK = 20;

  const fmt = (s) => {
    s = Math.round(s || 0);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m " + String(s % 60).padStart(2, "0") + "s";
    const h = Math.floor(m / 60);
    return h + "h " + String(m % 60).padStart(2, "0") + "m";
  };
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

  const report = (n, sec) => {
    if (!(n > 0) && !(sec > 0)) return;
    try { chrome.runtime.sendMessage({ type: "NOADS_REMOVED", n: n || 0, sec: sec || 0 }); } catch {}
  };

  // ---- the notice ---------------------------------------------------------
  // One reused element in a shadow root, so YouTube's CSS can't reach in and
  // ours can't leak out. Sits where YouTube's own toast sits (bottom-left).
  let host = null;
  let shadow = null;
  let hideTimer = 0;

  const buildNotice = () => {
    if (host) return;
    host = document.createElement("div");
    host.id = "noads-notice-host";
    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.n{position:fixed;left:24px;bottom:24px;z-index:2147483647;max-width:340px;' +
      'display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-radius:12px;' +
      'background:rgba(28,28,30,.96);color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.4);' +
      'font-family:"Roboto","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;' +
      'opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s;pointer-events:none}' +
      '.n.show{opacity:1;transform:none}' +
      '.dot{width:8px;height:8px;border-radius:50%;background:#4ade80;flex:none;margin-top:5px}' +
      '.t{font-size:13.5px;font-weight:600;line-height:1.35;letter-spacing:-.01em}' +
      '.s{font-size:11.5px;color:rgba(255,255,255,.72);line-height:1.45;margin-top:2px}' +
      '</style>' +
      '<div class="n"><div class="dot"></div><div>' +
      '<div class="t"></div><div class="s"></div><div class="s a"></div>' +
      '</div></div>';
  };

  // Fullscreen puts the player on its own layer — a fixed element parked on
  // <html> would be painted underneath it, so follow the fullscreen element.
  const parkNotice = () => {
    const want = document.fullscreenElement || document.body || document.documentElement;
    if (want && host.parentNode !== want) {
      try { want.appendChild(host); } catch {}
    }
  };

  const showNotice = (ads, sec) => {
    if (!notice || isPaused()) return;
    // The first video's ads are pruned while the HTML is still parsing, before
    // there is a <body> to hang anything on. Hold the notice until there is.
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", () => showNotice(ads, sec), { once: true });
      return;
    }
    try {
      buildNotice();
      parkNotice();
      const box = shadow.querySelector(".n");
      shadow.querySelector(".t").textContent = "Ad is being stopped";
      shadow.querySelector(".s").textContent =
        plural(ads, "ad") + " stopped here · " + fmt(sec) + " saved";
      shadow.querySelector(".s.a").textContent =
        totalBlocked.toLocaleString() + " blocked · " + fmt(totalSaved) + " saved all-time";
      box.classList.add("show");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        try { box.classList.remove("show"); } catch {}
      }, 4500);
    } catch {}
  };

  // ---- YouTube's own nag --------------------------------------------------
  // Only toasts that blame playback/ad-blocking are touched — "Added to queue"
  // and friends are left alone.
  const NAG = /experienc|interrupt|reload|ad blocker|adblock|ads? blocker/i;
  const killNag = () => {
    try {
      document.querySelectorAll("tp-yt-paper-toast").forEach((t) => {
        let txt = "";
        try { txt = (t.textContent || "").slice(0, 300); } catch {}
        if (!txt || !NAG.test(txt)) return;
        try { t.removeAttribute("opened"); } catch {}
        try { t.style.display = "none"; } catch {}
      });
      // The harder "Ad blockers violate YouTube's Terms" dialog, which also
      // pauses the video — drop it and let playback continue.
      document.querySelectorAll("ytd-enforcement-message-view-model").forEach((el) => {
        const dlg = el.closest("tp-yt-paper-dialog") || el;
        try { dlg.remove(); } catch {}
        try { document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach((b) => b.remove()); } catch {}
        try { document.body.style.overflow = "auto"; } catch {}
        const v = document.querySelector(".html5-video-player video");
        if (v && v.paused) { try { v.play(); } catch {} }
      });
    } catch {}
  };

  // ---- fail-safe ----------------------------------------------------------
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

  // Per-video running totals shown in the notice.
  let vid = "";
  let hereAds = 0;
  let hereSec = 0;
  const videoId = () => {
    try { return new URLSearchParams(location.search).get("v") || location.pathname; } catch { return ""; }
  };
  const rollOver = () => {
    const v = videoId();
    if (v !== vid) { vid = v; hereAds = 0; hereSec = 0; }
  };

  // One ad element can be seen by many ticks — count each ad once, by its src.
  let lastAdSrc = "";

  const tick = () => {
    if (isPaused()) return;
    try {
      killNag();
      const player = document.querySelector(".html5-video-player");
      if (player && player.classList.contains("ad-showing")) {
        const v = player.querySelector("video");
        // Measure what this ad would have cost before we cut it short. Counted
        // once per ad, and only as TIME — the ad tally stays with yt-adfree.js
        // so it can never be inflated by a re-render.
        const src = (v && v.currentSrc) || "";
        if (v && src && src !== lastAdSrc) {
          lastAdSrc = src;
          const d = v.duration;
          const left = isFinite(d) && d > 0 && d < 600 ? Math.max(0, d - (v.currentTime || 0)) : 0;
          const sec = left || EST_SEC_PER_BREAK;
          rollOver();
          hereAds += 1;
          hereSec += sec;
          totalSaved += sec;
          report(0, sec);
          showNotice(hereAds, hereSec);
        }
        // Skippable ad → click Skip. Unskippable slip-through → fast-forward it
        // out (bounded, so it can't get stuck on a live/broken duration).
        if (!clickSkip()) {
          if (v) {
            v.muted = true;
            const d = v.duration;
            if (isFinite(d) && d > 0 && d < 600) {
              try { v.currentTime = d; } catch {}
            }
            try { v.playbackRate = 10; } catch {}
          }
        }
      }
      // Static overlay / banner / feed / companion ad containers (bounded).
      document.querySelectorAll(".ytp-ad-overlay-close-button").forEach((b) => {
        try { b.click(); } catch {}
      });
      [
        ".ytp-ad-overlay-slot",
        ".ytp-ad-image-overlay",
        "#player-ads",
        "ytd-ad-slot-renderer",
        "ytd-in-feed-ad-layout-renderer",
        "ytd-companion-slot-renderer",
        "ytd-banner-promo-renderer",
        "ytd-statement-banner-renderer",
        "ytd-primetime-promo-renderer",
        "ytd-brand-video-shelf-renderer",
        "ytd-brand-video-singleton-renderer",
        "ytd-video-masthead-ad-v3-renderer",
        "ytd-display-ad-renderer",
        "ytd-promoted-sparkles-web-renderer",
        "ytd-promoted-video-renderer",
        "ytm-promoted-sparkles-web-renderer",
        "ytd-reel-shelf-renderer:has(ytd-ad-slot-renderer)",
        "#masthead-ad",
        "#offer-module",
      ].forEach((s) => {
        let nodes;
        try { nodes = document.querySelectorAll(s); } catch { return; } // :has() on old engines
        nodes.forEach((el) => el.remove());
      });
    } catch {}
  };

  // Relay the genuine, de-duplicated ad count from yt-adfree.js (MAIN world) to
  // the counter. This is the only place YouTube ads are counted — one batch per
  // video — so the number is real, not inflated.
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__noads === true && e.data.blocked > 0 && !isPaused()) {
      const n = e.data.blocked;
      const sec = n * EST_SEC_PER_BREAK;
      rollOver();
      hereAds += n;
      hereSec += sec;
      totalBlocked += n;
      totalSaved += sec;
      report(n, sec);
      showNotice(hereAds, hereSec);
    }
  });

  setInterval(tick, 500);
  tick();
})();
