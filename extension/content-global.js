// AgentFury — select-to-ask, works on ANY page (including Gmail's reading
// pane, not just compose). Highlight text like you would to "Search Google
// for…", and a small bar appears letting you ask AgentFury about it right
// there — Explain, Summarize, or type your own question. Also reachable via
// right-click → "Ask AgentFury about…" (see background.js contextMenus).
(function () {
  function extensionAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function send(msg, timeoutMs = 45000) {
    return new Promise((resolve) => {
      if (!extensionAlive()) {
        resolve({ ok: false, error: "extension_reloaded", contextInvalid: true });
        return;
      }
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) {
            finish({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          finish(r);
        });
      } catch (e) {
        finish({ ok: false, error: String(e.message || e), contextInvalid: true });
        return;
      }
      setTimeout(() => finish({ ok: false, error: "timeout", timedOut: true }), timeoutMs);
    });
  }

  function friendlyError(r) {
    if (r.contextInvalid) return "AgentFury was updated — refresh this page.";
    if (r.timedOut) return "Still waking up — try again, it'll be quick now.";
    if (r.status === 401) return "Sign in via the AgentFury extension icon first.";
    // Every path we call exists in the current backend, so a 404 never means
    // "wrong URL" — it means this extension is newer than the server it's
    // talking to (a feature shipped in the extension before the backend was
    // deployed). Say that, instead of the raw "Not Found".
    if (r.status === 404) return "This feature isn't on the AgentFury server yet — it needs the latest backend deployed.";
    return "Failed: " + (r.error || "unknown error") + " — try again.";
  }

  // AgentFury now runs in EVERY frame, not just the top document (see
  // "all_frames" in manifest.json). That is what makes copy-restore, the image
  // AI badge and select-to-ask work on the sites people most need them on:
  // course players, "protected" readers and document viewers put their content
  // inside an iframe, and a top-frame-only content script never sees a word of
  // it. The trade-off is that a page can carry dozens of tiny ad/tracking
  // frames, so anything with UI is gated:
  //   - top frame only: the corner bubble and the PDF/doc card (one per tab).
  //   - frames big enough to hold it: the selection bar, image and edit UI.
  //   - every frame: copy/selection restore, which is cheap and is the whole
  //     reason for running in frames at all.
  const IS_TOP = (() => {
    try {
      return window.top === window.self;
    } catch {
      return false; // cross-origin parent — treat as a sub-frame
    }
  })();
  const isTinyFrame = () => !IS_TOP && (window.innerWidth < 320 || window.innerHeight < 220);

  send({ type: "WARM_UP" });

  // All of our UI (bar, capture card, bubble, highlight overlay) renders
  // inside a closed Shadow DOM instead of directly in the page. Two problems
  // this solves at once, both reported in the wild:
  //  1. Style bleed — some sites' global CSS (e.g. "input { background:
  //     white }") was leaking straight into our elements, since a plain
  //     content-script <div> appended to document.body is just another node
  //     in the page's own cascade. A shadow boundary blocks that cascade in
  //     both directions: page CSS can't reach in, and ours can't leak out.
  //  2. Detectability — with `mode: "closed"`, the host element's
  //     `.shadowRoot` property returns null to any page script, and
  //     `document.querySelector` can't pierce the boundary at all. Page JS
  //     can see there's a host <div> but has no way to inspect, target, or
  //     remove what's inside it — the same property that makes the native
  //     chrome.sidePanel undetectable, applied here to our in-page UI.
  // Absolutely-positioned children inside the shadow tree still resolve
  // their containing block by walking OUT through the (unpositioned) host,
  // same as before — so all the existing scrollX/scrollY-based positioning
  // math below needs no changes.
  // The brand logo as a data URI (a small circular AF mark) so the icon shows
  // the real logo instead of plain "AF" text — no web_accessible_resources or
  // network needed, works on every page.
  const AF_LOGO =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAJDUlEQVR4nM2Z749U1RnHP8+5d2Z2l/29K5RdWSTqAFaxwSi/LBtXbKsCW3+AVUPSF2IDLxrtSxODxIgNfaE0FTX+AS1CbKwlWGvFtRVQW9NEWmEKBSSiKOwyd4dld+ee8/TFvTPMLrO7sxXRZ3Jyc++c8zzf85zn1zlHmBSt8mC7Lbylp6db84lEp8JiVBep0CwwG9C4iygcFKUXkb0CexL5fE/ms8ypsXhORFJhPxM/HeB1dMy9xSDrVXWxiJkmIqgqoPGzRIAIIBT6qLqTIrLHoVs/+eTj3YAdxf8rA/ZipsycOed+UfMYcG0EwKERQhfzKrRS0pJmRERETGFi+1XcpmPHDvx2tKz/C3AnnX4PPWFb25y07/GsEXM7gFPnUFVETIWTHjkBVYeIGDEm5rcrtDxy4sSBTEHmZAEXNOVmtKVXG8/bKiItzlkbfzdjjJssOUCN8TxVPe2sXX/8ROblmH9hVUZQOcGFSbiOy+dsMJ7ZpmiLdaElWrKLBbYg37MutIq2GM9s67h8zgbO2/IFCi2nYR+wM9rSL3q+v9basOAUk136yZICzvN8z4bhS8dPZH5GpKAR5jFKW50+ELa3X73BeN7a0OaHQb1LAJZIhnqhzQ8bz1vb3n71hghspz+qU5E8wLa3X3WvEW+7qs2D+JcIbCkpaCjiJZzaVZ9+emgHJdGjAMYAzJhx1Sy18oFAo0b2fqnBFkgFQeGMeHrj8eOHjsTfXalJOGf1eUSaHM5plKX4hpo4nEOkyVl9npKEIkROFra1XbnaYLapujD+9m2gUMT4DnffiROHXwZ8A7hVq/DU6ZOKoqiJn9+GX4TF6ZOrVuEBTgDap115C0b+ouoUqTDOKoiRuFaIP6miTkdavoIxZkxvKDtmpBwnYgSnt3568vBuHxAr9lEPTxR1F+aW8iQiDA0Nkc/niaQpyWSSRCIxogAS4OzAWZwrX9f4vk8qlbqgaCqFLKixYh8F3paOjo6m4SGTMUZaVVHQCSODZzyCIGBF93LWrVtLPh+SSPhsemoz7767l9raWpyziAj54Ty/3PwUs2dfjYtLEFVwzuEZw5tvvsWWLc9RV1eHc+XqHlERxDk9lUy5tD98ji7xpEWdKhWEsaInKzz00E9ZsmRR8b8HHriP3W/1IHUUqwDrHAsX3Mg1351bll8QBAwPDY8YM0qiqKIi0jJ8ji4fkaWAKFqoFcYlYwwDAwPMnptmwYKbCMOQXO4sdXW1LLuti7b26QRBgO/7aDy9/lwOay1hPuS113ZyJpvFGIMxhvf2vU+qKoVTF/cvS04QD5GlvsJ8UQWtLEmICOcGBrjj9h9SXV1Fb28vO3e+zpo1DzBt2lSWLr2Zbb/bTlNzE866otN5nkc+n2fjxk0cOHCQmupqnHP4vk9NdVXUdxyxRNOZb1R1ahxCpJJAY62lZkoN3d3LUVUOHfovW597keHhYQC6f7wiYq/nx5SutTESadeLWjKVxOmEciNsqlN9EdKqDpAJNWyMIZfLsWDhTcy7fh4iwr597/H3f3zAgY8PMu/66+js/D6zZl3BZ599TiqVGrU6hiVLFjFzZgfJZBJV5aOP9tPX1xeZ0NgRSuKaP+3HWxwZw+JHCYShwSG6Vy7H9z2cc7y+6w3C8Bw7d+5i3vXX0djYwLJlXbzwwktUV1ehJb7s+z5bn//1CJ733P0Tdu36E42NjWNEiVJSNZVmdxHI5/O0XtbK8hV3AHDkyFGOHTtGe9ss3n//A8IwKl3vunsliUQijr0jFTE0NMS5c4MMDAwwODhIPp9HjFSEARRftTLtGmPo78+xcuWdXHHFTKx1tLe38de/7cYYQ2RWke0uXLiAOXNn85/MIc7vqCEM86xe/SBHjhylKpVCFU6ePElNdTWhtYxnExGJ+KhmxEhadeI47JzjnnvviodCVVUVVVVVI/qEYUgqleLOO37E0//cTG1dbfE/VeXo0aNkDmaojqNEIpGIUvf4YFVERJ1mfEW/ANJR/ikPWEQYHByko+Nybr21C1UlCAIeXruebDZLIpkklzvLTTfewOZfPY2qsrJ7BVu2/CbSXOThqCqpVKo40WLmm3iFlShXfOELfIhy83ijPM/Ql8uxZs2DtLQ0A7Bv73ts37GdKTV1qCphGPKvj/bz6C9+zvTp05k//3vccMN83u7pIZlIIiIkEglQxTlXbBVSYTfxobHq3onnP6YDWudIpZIsu62LM2eyZLNZXvn9q6RS1TQ01FNbO4WW1hb6czn+8OofyWajPsuWdeFcSBAEZLNZTp/uPa/xCp2M82WmWnXvSENDR5PnDWcEaS2ovtwERQwNDfVFBwqC/tjRSstLRyKRZMqUGiCy+SDop66uFs+Lsn5/fy4OXxXvvgrmcMraZFoAaW7+zqtGZIXq+PVEIWxBFFPLctcoG0KEyfd8rLXFiXq+h0xuq2hFxHOqr/X2ft7tAyqiz6iyXFXL84r17vt+UTEa1R8XFOsigp/wi++qGmk3DrVxiq1cwVGNoyL6DHHtawBpapr6b0HSRBu+i3m681XIAUbRTF/fF9cAaojAWXCPxzWRu6S7tvF/LloJ9zjxsWzpuYRrarzsDRFzm6qrqDb+msmKGE/V/bnvzJc/KGAsXXpjHetUXZ+C0Tj3fENNFYyq67OOdZSYaOnJtwTBl4ed2ocFBNWwuAG7tE1RDQXEqX04CL48THz0WwoYIhvxs9neHU7dRhFJKJr/Buw2LyIJp25jNtu7g/g0tQByzOPW+vqWF40xa2N7vmTHrSLGc869FASnyx63lgNR+KaN9c0bVOQJovj5dTqijTaZIKpPnAl6N5bimAhw4bsArr6+aTXIVhFpiTPhRb8yEBFPVU+Drg+CvnGvDCZaZh8I6+pa0yLhsxBdymhURGjMeOLNYEx6/hFtIqNLHcDtUvUf6e8/lSnIHIvHpK696uub7lfVx0Tk2iiQKHH0K7n2Go1/RHQ0Ec4oT6vqfhHZFAR9F+faq4RGXCw2NDTc4pysBxYD04qFwrhU7HMS2GOMbs1ms7v5Gi4WS2mEBmpra1vB6wRZrKqLgGaRUVe3ykGgV0T2gu4B25PL5U6NxXMi+h973AlmJ6pBzAAAAABJRU5ErkJggg==";

  const AF_CSS_TEXT = `
.af-sel-highlight { position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147482999; }
.af-sel-highlight-box { position: fixed; background: rgba(91, 108, 240, .28); border-radius: 2px; }
.af-logo { background: url(${AF_LOGO}) center / cover no-repeat !important; color: transparent !important; font-size: 0 !important; }

/* The bar adapts to the page: dark tokens by default, a .af-light override
   applied at build time when the page's background is light (see pageIsLight).
   Everything below reads these custom properties, so theming is one class. */
.af-sel-bar {
  --bg: rgba(22,22,26,.72); --fg:#f4f4f6; --muted:rgba(255,255,255,.5); --border:rgba(255,255,255,.09);
  --chip:rgba(255,255,255,.055); --chip-brd:rgba(255,255,255,.08); --chip-hover:rgba(255,255,255,.11); --accent:#5b6cf0;
  --icon-bg:#ffffff; --icon-fg:#111214;
  position: fixed; z-index: 2147483000; display: flex; flex-direction: column; gap: 8px;
  padding: 9px 10px; background: var(--bg); color: var(--fg);
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--border); border-radius: 18px;
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 14px 48px rgba(0,0,0,.42), 0 2px 8px rgba(0,0,0,.22);
  font-family: -apple-system, "Segoe UI", "Inter", ui-sans-serif, system-ui, sans-serif;
  font-weight: 400; -webkit-font-smoothing: antialiased;
  max-width: 360px; min-width: 300px; box-sizing: border-box;
  opacity: 0; transform: translateY(6px) scale(.985);
  transition: opacity .16s ease, transform .16s cubic-bezier(.2,.8,.3,1);
}
.af-sel-bar.af-light {
  --bg: rgba(255,255,255,.72); --fg:#1b1b1f; --muted:rgba(0,0,0,.5); --border:rgba(0,0,0,.07);
  --chip:rgba(0,0,0,.035); --chip-brd:rgba(0,0,0,.06); --chip-hover:rgba(0,0,0,.07); --icon-bg:#1b1b1f; --icon-fg:#fff;
  box-shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 14px 48px rgba(0,0,0,.15), 0 2px 8px rgba(0,0,0,.07);
}
.af-sel-bar * { box-sizing: border-box; }
.af-sel-bar.af-in { opacity: 1; transform: translateY(0) scale(1); }
.af-sel-row { display: flex; align-items: center; gap: 8px; padding-left: 4px; }
.af-sel-icon { flex-shrink: 0; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: var(--icon-bg); color: var(--icon-fg); border-radius: 50%; font-size: 8.5px; font-weight: 700; letter-spacing: -.01em; }
.af-sel-input { flex: 1; min-width: 110px; background: transparent; border: none; color: var(--fg); font-size: 13.5px; font-weight: 400; outline: none; font-family: inherit; padding: 0; margin: 0; letter-spacing: .005em; }
.af-sel-input::placeholder { color: var(--muted); font-weight: 400; }
.af-ic { flex-shrink: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 9px; color: var(--muted); cursor: pointer; padding: 0; transition: background .12s ease, color .12s ease; }
.af-ic:hover { background: var(--chip); color: var(--fg); }
.af-ic.af-ok { color: #22c55e; }
.af-sel-send { flex-shrink: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: var(--icon-bg); color: var(--icon-fg); border: none; border-radius: 9px; cursor: pointer; padding: 0; transition: transform .12s ease, opacity .12s ease; }
.af-sel-send:hover { opacity: .88; transform: translateX(1px); }
.af-sel-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.af-sel-more { flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 8px; margin-top: 1px; border-top: 1px solid var(--border); }
.af-sel-more:not([hidden]) { display: flex; } /* [hidden] must win, so only show when NOT hidden */
.af-sel-chip { flex-shrink: 0; background: var(--chip); color: var(--fg); border: 1px solid var(--chip-brd); border-radius: 10px; padding: 5px 12px; font-size: 12px; font-weight: 450; cursor: pointer; white-space: nowrap; font-family: inherit; transition: background .12s ease, border-color .12s ease; }
.af-sel-chip:hover { background: var(--chip-hover); border-color: var(--border); }
.af-more-btn { margin-left: auto; background: transparent; border-color: transparent; color: var(--muted); }
.af-more-btn:hover { background: var(--chip); color: var(--fg); border-color: transparent; }
.af-sel-action:hover { background: var(--accent); color: #fff; border-color: transparent; }
.af-answer { background: linear-gradient(180deg, #45464d, #2b2c31); color: #fff; font-weight: 500; border-color: transparent; box-shadow: 0 2px 9px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.1); }
.af-answer:hover { border-color: transparent; filter: brightness(1.14); box-shadow: 0 3px 12px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.12); }
.af-answer:hover { background: linear-gradient(180deg, #45464d, #2b2c31); } /* keep grey on hover, not the accent */

/* Drag handle / minimize / resize for the selection bar. */
.af-sel-handle { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: -3px -3px 3px; padding: 1px 3px; cursor: grab; user-select: none; }
.af-sel-handle:active { cursor: grabbing; }
.af-grip { display: inline-flex; align-items: center; color: var(--muted); padding: 2px 2px; }
.af-grip:hover { color: var(--fg); }
.af-min-label { display: none; font-size: 12px; font-weight: 500; color: var(--fg); }
.af-min { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 20px; background: transparent; border: none; color: var(--muted); cursor: pointer; border-radius: 6px; padding: 0; }
.af-min:hover { background: var(--chip); color: var(--fg); }
.af-sel-bar.af-min-state { min-width: 0 !important; width: auto !important; }
.af-sel-bar.af-min-state .af-sel-row,
.af-sel-bar.af-min-state .af-sel-chips,
.af-sel-bar.af-min-state .af-sel-more,
.af-sel-bar.af-min-state .af-sel-answer { display: none !important; }
.af-sel-bar.af-min-state .af-min-label { display: inline; }
.af-sel-bar.af-min-state .af-resize { display: none; }
.af-resize { position: absolute; right: 2px; bottom: 2px; width: 16px; height: 16px; cursor: nwse-resize; opacity: .55; }
.af-resize::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); border-bottom-right-radius: 2px; }
.af-resize:hover { opacity: 1; }
/* Static flex child (not absolutely positioned) so the bar's own size includes
   it and positionBar keeps the whole thing on screen. max-height is set per
   render in JS (fitAnswerBox) to the space left below/above the bar, so it
   never spills off the viewport. */
.af-sel-answer { width: 100%; margin-top: 2px; overflow-y: auto; background: transparent; color: var(--fg); border-top: 1px solid var(--border); padding-top: 10px; font-size: 12.5px; line-height: 1.55; opacity: 0; transform: translateY(3px); transition: opacity .14s ease, transform .14s ease; box-sizing: border-box; }
.af-sel-answer.af-in { opacity: 1; transform: translateY(0); }
.af-sel-answer.af-err { color: #e5484d; }
.af-sel-answer-text { margin-bottom: 8px; white-space: normal; }
.af-verdict { margin-bottom: 8px; }
.af-src-toggle { display: block; margin-top: 6px; background: transparent; color: var(--muted); border: none; padding: 2px 0; font-size: 11px; font-weight: 600; cursor: pointer; }
.af-src-toggle:hover { color: var(--fg); }
.af-src-list { margin-top: 4px; }
.af-code-wrap { position: relative; margin: 6px 0 10px; }
.af-code { margin: 0; padding: 10px 11px; background: rgba(127,127,127,.14); border: 1px solid var(--border); border-radius: 8px; font-family: ui-monospace, "Cascadia Code", "Consolas", monospace; font-size: 11.5px; line-height: 1.5; overflow-x: auto; white-space: pre; }
.af-code-copy { position: absolute; top: 6px; right: 6px; background: var(--bg); color: var(--muted); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; font-size: 10.5px; cursor: pointer; }
.af-code-copy:hover { color: var(--fg); }
.af-sel-spin { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--border); border-top-color: var(--fg); border-radius: 50%; margin-right: 7px; vertical-align: -1px; animation: af-spin .7s linear infinite; }
@keyframes af-spin { to { transform: rotate(360deg); } }
.af-copy { background: transparent; color: var(--muted); border: 1px solid var(--border); border-radius: 8px; padding: 4px 11px; font-size: 11px; cursor: pointer; }
.af-copy:hover { color: var(--fg); }
.af-result { display: block; padding: 9px 0; border-bottom: 1px solid var(--border); text-decoration: none; }
.af-result:last-child { border-bottom: none; }
.af-result:hover .af-result-title { text-decoration: underline; }
.af-result-title { color: var(--accent); font-size: 12.5px; font-weight: 600; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-result-url { color: var(--muted); font-size: 10.5px; margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-result-snippet { color: var(--fg); font-size: 11.5px; line-height: 1.45; opacity: .82; }
/* Compact trigger — shown first on a selection so it barely covers text; click
   it to expand the full bar. Follows the selection on scroll (repositioned in
   JS) so you can read/scroll with it, instead of it dying on the first scroll. */
.af-sel-pill { --bg: rgba(22,22,26,.74); --fg:#f4f4f6; --muted:rgba(255,255,255,.5); --border:rgba(255,255,255,.1); --icon-bg:#ffffff; --icon-fg:#111214;
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%);
  position: fixed; z-index: 2147483000; display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 5px 4px 13px; background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.30);
  cursor: pointer; font-family: -apple-system, "Segoe UI", "Inter", ui-sans-serif, system-ui, sans-serif;
  font-size: 12.5px; font-weight: 500; letter-spacing: .01em; box-sizing: border-box;
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 8px 24px rgba(0,0,0,.34);
  opacity: 0; transform: translateY(4px) scale(.96);
  transition: opacity .13s ease, transform .13s cubic-bezier(.2,.8,.3,1); }
.af-sel-pill.af-light { --bg: rgba(255,255,255,.74); --fg:#1b1b1f; --muted:rgba(0,0,0,.5); --border:rgba(0,0,0,.08); --icon-bg:#1b1b1f; --icon-fg:#fff; box-shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 8px 24px rgba(0,0,0,.13); }
.af-sel-pill.af-in { opacity: 1; transform: translateY(0) scale(1); }
.af-sel-pill:hover { transform: translateY(0) scale(1.02); }
.af-sel-pill .af-sel-icon { width: 20px; height: 20px; }
.af-pill-label { padding-left: 1px; }
.af-bubble { position: fixed; bottom: 22px; right: 22px; z-index: 2147483000; width: 40px; height: 40px; border-radius: 50%; background: #fff; color: #000; border: none; font-size: 11px; font-weight: 800; letter-spacing: -.02em; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.35); font-family: -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif; opacity: 0; transform: scale(.8); transition: opacity .18s ease, transform .18s cubic-bezier(.2,.8,.3,1), box-shadow .12s ease; padding: 0; }
.af-bubble.af-in { opacity: 1; transform: scale(1); }
.af-bubble:hover { box-shadow: 0 8px 26px rgba(0,0,0,.5); transform: scale(1.06); }
.af-capture-card { position: fixed; bottom: 72px; right: 22px; z-index: 2147483000; width: 300px; background: #0b0b0b; color: #fff; border: 1px solid rgba(255,255,255,.16); border-radius: 14px; box-shadow: 0 16px 40px rgba(0,0,0,.5); padding: 14px; font-family: -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif; opacity: 0; transform: translateY(8px) scale(.97); transition: opacity .16s ease, transform .16s cubic-bezier(.2,.8,.3,1); box-sizing: border-box; }
.af-capture-card * { box-sizing: border-box; }
.af-capture-card.af-in { opacity: 1; transform: translateY(0) scale(1); }
.af-capture-title { font-size: 13px; font-weight: 700; }
.af-capture-sub { font-size: 11px; color: rgba(255,255,255,.5); margin-top: 2px; margin-bottom: 10px; }
.af-capture-input { width: 100%; min-height: 70px; background: #151515; border: 1px solid rgba(255,255,255,.18); border-radius: 8px; color: #fff; font-size: 12.5px; font-family: inherit; padding: 8px 10px; outline: none; resize: vertical; margin: 0; }
.af-capture-input:focus { border-color: rgba(255,255,255,.5); }
.af-capture-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
.af-capture-save { background: #fff; color: #000; border: none; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; }
.af-capture-save:hover { opacity: .88; }
.af-capture-open { font-size: 11px; color: rgba(255,255,255,.5); text-decoration: none; }
.af-capture-open:hover { color: #fff; }
.af-capture-msg { font-size: 11px; color: rgba(255,255,255,.55); margin-top: 8px; min-height: 14px; }
.af-capture-msg.af-err { color: #ff8a8a; }

/* Copy button on the collapsed pill — copy the selection without expanding. */
.af-pill-main { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.af-pill-copy { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 24px; padding: 0; background: transparent; border: none; border-left: 1px solid var(--border); color: var(--muted); cursor: pointer; }
.af-pill-copy:hover { color: var(--fg); }
.af-pill-copy.af-ok { color: #22c55e; }

/* Document assistant card — shown when a PDF/doc is open in the tab. */
.af-doc-card { position: fixed; top: 16px; right: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px); background: rgba(18,18,22,.93); -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); color: #f4f4f6; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.5); padding: 14px; font-family: -apple-system, "Segoe UI", "Inter", ui-sans-serif, system-ui, sans-serif; box-sizing: border-box; opacity: 0; transform: translateY(-6px) scale(.98); transition: opacity .16s ease, transform .16s cubic-bezier(.2,.8,.3,1); }
.af-doc-card * { box-sizing: border-box; }
.af-doc-card.af-in { opacity: 1; transform: translateY(0) scale(1); }
.af-doc-head { display: flex; align-items: center; gap: 10px; }
.af-doc-ic { font-size: 20px; line-height: 1; }
.af-doc-titles { flex: 1; min-width: 0; }
.af-doc-title { font-size: 13px; font-weight: 600; }
.af-doc-name { font-size: 11px; color: rgba(255,255,255,.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-doc-x { flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; color: rgba(255,255,255,.5); font-size: 15px; cursor: pointer; border-radius: 7px; padding: 0; }
.af-doc-x:hover { background: rgba(255,255,255,.1); color: #fff; }
.af-doc-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
.af-doc-btn { background: rgba(255,255,255,.06); color: #f4f4f6; border: 1px solid rgba(255,255,255,.09); border-radius: 9px; padding: 6px 12px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; }
.af-doc-btn:hover { background: rgba(255,255,255,.12); }
.af-doc-btn.primary { background: linear-gradient(180deg, #6d7bff, #4f5cd8); border-color: transparent; box-shadow: 0 2px 9px rgba(79,92,216,.4); }
.af-doc-search { width: 100%; margin-top: 10px; background: #15151a; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; font-size: 12px; padding: 7px 10px; outline: none; font-family: inherit; }
.af-doc-search:focus { border-color: rgba(255,255,255,.4); }
.af-doc-status { font-size: 11px; color: rgba(255,255,255,.5); margin-top: 8px; }
.af-doc-status:empty { display: none; }
.af-doc-status.err { color: #ff8a8a; }
.af-doc-body { margin-top: 10px; max-height: 320px; overflow-y: auto; font-size: 12px; line-height: 1.55; color: #e6e6ea; }
.af-doc-body:empty { display: none; }
.af-doc-text { white-space: pre-wrap; word-break: break-word; }
.af-doc-hit { background: rgba(109,123,255,.5); color: #fff; border-radius: 2px; }
.af-doc-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
.af-doc-tool { background: transparent; color: rgba(255,255,255,.6); border: 1px solid rgba(255,255,255,.14); border-radius: 7px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-family: inherit; }
.af-doc-tool:hover { color: #fff; }
.af-doc-spin { display: inline-block; width: 11px; height: 11px; border: 2px solid rgba(255,255,255,.2); border-top-color: #fff; border-radius: 50%; margin-right: 7px; vertical-align: -1px; animation: af-spin .7s linear infinite; }
`;


  // Styles for the three newer surfaces — the image-AI badge/card, the
  // auto-edit badge/menu that appears in text fields, and the shared panel
  // tokens both use. Kept in its own literal rather than bolted onto
  // AF_CSS_TEXT so the older selection-bar CSS stays readable; both strings
  // are concatenated into the same <style> inside the shadow root.
  const AF_CSS_EXTRA = `
/* Shared tokens for the newer cards, mirroring the bar's light/dark switch. */
.af-panel { --bg: rgba(18,18,22,.95); --fg:#f4f4f6; --muted:rgba(255,255,255,.52); --border:rgba(255,255,255,.1);
  --chip:rgba(255,255,255,.06); --chip-brd:rgba(255,255,255,.1); --chip-hover:rgba(255,255,255,.13); --accent:#5b6cf0;
  position: fixed; z-index: 2147483002; background: var(--bg); color: var(--fg);
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.45);
  font-family: -apple-system, "Segoe UI", "Inter", ui-sans-serif, system-ui, sans-serif;
  box-sizing: border-box; opacity: 0; transform: translateY(6px) scale(.985);
  transition: opacity .15s ease, transform .15s cubic-bezier(.2,.8,.3,1); }
.af-panel { max-height: calc(100vh - 20px); overflow-y: auto; overscroll-behavior: contain; }
.af-panel * { box-sizing: border-box; }
.af-panel.af-in { opacity: 1; transform: translateY(0) scale(1); }
.af-panel.af-light { --bg: rgba(255,255,255,.96); --fg:#1b1b1f; --muted:rgba(0,0,0,.5); --border:rgba(0,0,0,.09);
  --chip:rgba(0,0,0,.04); --chip-brd:rgba(0,0,0,.08); --chip-hover:rgba(0,0,0,.08);
  box-shadow: 0 16px 48px rgba(0,0,0,.16); }
.af-chip { background: var(--chip); color: var(--fg); border: 1px solid var(--chip-brd); border-radius: 10px;
  padding: 5px 11px; font-size: 12px; font-weight: 450; cursor: pointer; white-space: nowrap;
  font-family: inherit; transition: background .12s ease; }
.af-chip:hover { background: var(--chip-hover); }
.af-chip.primary { background: linear-gradient(180deg, #6d7bff, #4f5cd8); color: #fff; border-color: transparent; box-shadow: 0 2px 9px rgba(79,92,216,.35); }
.af-chip.primary:hover { filter: brightness(1.08); }
.af-chip[disabled] { opacity: .4; cursor: not-allowed; }
.af-x { flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: var(--muted); font-size: 15px; cursor: pointer; border-radius: 7px; padding: 0; }
.af-x:hover { background: var(--chip); color: var(--fg); }
.af-status { font-size: 11px; color: var(--muted); margin-top: 8px; line-height: 1.5; }
.af-status:empty { display: none; }
.af-status.err { color: #ff8a8a; }
.af-body { margin-top: 9px; max-height: 300px; overflow-y: auto; font-size: 12.5px; line-height: 1.55; color: var(--fg); }
.af-body:empty { display: none; }
.af-body .af-sel-answer-text { margin-bottom: 8px; }
.af-body .af-out { white-space: pre-wrap; word-break: break-word; }

/* ---------- Image AI: the badge that sits on every image ---------- */
.af-img-badge { position: fixed; z-index: 2147483001; display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 9px 0 5px; background: rgba(18,18,22,.86); color: #fff;
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  border: 1px solid rgba(255,255,255,.16); border-radius: 999px; cursor: pointer;
  font: 500 11.5px -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif; letter-spacing: .01em;
  box-shadow: 0 4px 14px rgba(0,0,0,.36); opacity: 0; transform: scale(.88);
  transition: opacity .12s ease, transform .12s cubic-bezier(.2,.8,.3,1), background .12s ease; }
.af-img-badge.af-in { opacity: 1; transform: scale(1); }
.af-img-badge:hover { background: rgba(30,30,38,.96); transform: scale(1.05); }
.af-img-badge .af-ib-logo { width: 18px; height: 18px; border-radius: 50%; flex: none; }

/* The image card itself — actions + result, anchored next to the image. */
.af-img-card { width: 330px; max-width: calc(100vw - 24px); padding: 13px; }
.af-card-head { display: flex; align-items: center; gap: 9px; }
.af-card-ic { width: 22px; height: 22px; border-radius: 50%; flex: none; }
.af-card-titles { flex: 1; min-width: 0; }
.af-card-title { font-size: 13px; font-weight: 600; }
.af-card-sub { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-img-thumb { display: block; width: 100%; max-height: 110px; object-fit: contain; margin-top: 10px;
  border-radius: 10px; background: rgba(127,127,127,.14); border: 1px solid var(--border); }
.af-row-wrap { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.af-ask-row { display: flex; align-items: center; gap: 6px; margin-top: 9px; }
.af-ask-input { flex: 1; min-width: 0; background: var(--chip); border: 1px solid var(--chip-brd); border-radius: 9px;
  color: var(--fg); font-size: 12px; font-family: inherit; padding: 6px 9px; outline: none; }
.af-ask-input:focus { border-color: var(--muted); }
.af-ask-input::placeholder { color: var(--muted); }
.af-ask-go { flex: none; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  background: var(--fg); color: var(--bg); border: none; border-radius: 9px; cursor: pointer; padding: 0; }
.af-ask-go:hover { opacity: .88; }
.af-tools { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
.af-tool { background: transparent; color: var(--muted); border: 1px solid var(--chip-brd); border-radius: 7px;
  padding: 4px 10px; font-size: 11px; cursor: pointer; font-family: inherit; }
.af-tool:hover { color: var(--fg); }

/* ---------- The auto-spotted question badge ---------- */
.af-q-badge { position: fixed; z-index: 2147483001; display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 11px 0 5px; background: rgba(24,26,42,.92); color: #eef0ff;
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  border: 1px solid rgba(126,140,255,.42); border-radius: 999px; cursor: pointer;
  font: 600 11.5px -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif; letter-spacing: .01em;
  box-shadow: 0 4px 16px rgba(0,0,0,.4); opacity: 0; transform: translateX(-4px) scale(.92);
  transition: opacity .14s ease, transform .14s cubic-bezier(.2,.8,.3,1), background .12s ease; }
.af-q-badge.af-in { opacity: .94; transform: translateX(0) scale(1); }
.af-q-badge:hover { opacity: 1; background: rgba(36,40,66,.97); transform: translateX(0) scale(1.05); }
.af-q-badge .af-ib-logo { width: 18px; height: 18px; border-radius: 50%; flex: none; }

/* ---------- Auto-edit: the badge inside any text field + its menu ---------- */
.af-edit-badge { position: fixed; z-index: 2147483001; display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 7px 0 4px; background: rgba(18,18,22,.82); color: #fff;
  border: 1px solid rgba(255,255,255,.16); border-radius: 999px; cursor: pointer;
  font: 600 10px -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em;
  box-shadow: 0 3px 10px rgba(0,0,0,.28); opacity: 0; transform: scale(.9);
  transition: opacity .12s ease, transform .12s ease; }
.af-edit-badge.af-in { opacity: .72; transform: scale(1); }
.af-edit-badge:hover { opacity: 1; transform: scale(1.06); }
.af-edit-badge .af-ib-logo { width: 15px; height: 15px; border-radius: 50%; flex: none; }
.af-edit-menu { width: 288px; max-width: calc(100vw - 24px); padding: 12px; }
/* The badge turns into a live count the moment there's something to fix. */
.af-edit-badge.af-has-issues { background: #b4451f; opacity: .95; }
.af-edit-badge.af-has-issues .af-badge-label { font-weight: 700; }
.af-suggests { margin-top: 10px; border-top: 1px solid var(--border); padding-top: 9px; max-height: 190px; overflow-y: auto; }
.af-suggest-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 11px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
.af-suggest { display: flex; align-items: center; gap: 7px; width: 100%; text-align: left;
  background: var(--chip); border: 1px solid var(--chip-brd); border-radius: 9px; padding: 6px 9px;
  margin-bottom: 5px; color: var(--fg); font-family: inherit; font-size: 12px; cursor: pointer; }
.af-suggest:hover { background: var(--chip-hover); }
.af-suggest s { color: var(--muted); text-decoration-color: #e5484d; }
.af-suggest b { font-weight: 600; }
.af-suggest-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; }
.af-suggest-empty { font-size: 11.5px; color: var(--muted); }

/* Confirmation for actions with no UI of their own (shortcut / menu copy). */
.af-toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%) translateY(8px);
  z-index: 2147483005; background: rgba(18,18,22,.95); color: #fff; padding: 9px 16px;
  border: 1px solid rgba(255,255,255,.14); border-radius: 999px; box-shadow: 0 8px 26px rgba(0,0,0,.42);
  font: 500 12.5px -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  opacity: 0; transition: opacity .14s ease, transform .14s ease; pointer-events: none; white-space: nowrap; }
.af-toast.af-in { opacity: 1; transform: translateX(-50%) translateY(0); }
.af-toast.af-err { background: rgba(120,26,30,.95); }

/* ---------- Snip & read: the drag-a-box-over-anything overlay ---------- */
.af-snip { position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 2147483004;
  cursor: crosshair; background: rgba(10,10,14,.34); }
.af-snip-hint { position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
  background: rgba(18,18,22,.94); color: #fff; padding: 8px 15px; border-radius: 999px;
  font: 500 12.5px -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 6px 20px rgba(0,0,0,.4); white-space: nowrap; }
.af-snip-box { position: fixed; border: 1.5px solid #7d8bff; background: rgba(125,139,255,.16);
  border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,.35); }
/* Inline code from renderRich's light markdown pass. */
.af-sel-answer code, .af-body code { background: rgba(127,127,127,.18); padding: 1px 4px;
  border-radius: 4px; font-family: ui-monospace, "Cascadia Code", "Consolas", monospace; font-size: .94em; }
/* Same spinner as the doc card, but themed off the panel tokens so it stays
   visible on a light page too (@keyframes af-spin lives in AF_CSS_TEXT). */
.af-spin { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--chip-brd);
  border-top-color: var(--fg); border-radius: 50%; margin-right: 7px; vertical-align: -1px;
  animation: af-spin .7s linear infinite; }
`;

  let afHost = null;
  let afRoot = null;
  function getAfRoot() {
    if (afRoot) return afRoot;
    afHost = document.createElement("div");
    // "all: initial" strips any inherited/cascaded page styling off the host
    // itself before we lock down the handful of properties that matter —
    // this is what stops a page's broad `div { ... !important }` rules from
    // putting a border/background on our otherwise-invisible wrapper.
    afHost.style.cssText =
      "all: initial !important; position: static !important; display: block !important; margin: 0 !important; padding: 0 !important;";
    (document.body || document.documentElement).appendChild(afHost);
    afRoot = afHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = AF_CSS_TEXT + AF_CSS_EXTRA;
    afRoot.appendChild(style);
    return afRoot;
  }

  // ---------- Privacy mode: an OFF SWITCH, not an invisibility cloak --------
  // Removes AgentFury's UI from the page entirely, on every open tab at once
  // (toggled from Settings or the keyboard shortcut in manifest.json). Use it
  // when screen-sharing, presenting, or recording a tutorial and you'd rather
  // your personal assistant not be on screen.
  //
  // To be precise about what this does and doesn't do: it works because the UI
  // is genuinely GONE, not because it's concealed from a recorder. No web API
  // can hide a rendered element from screen capture — a recorder reads the
  // composited framebuffer, which is downstream of the DOM, Shadow DOM,
  // iframes and z-index alike. Capture exclusion exists only at the OS
  // compositor level (Windows SetWindowDisplayAffinity / macOS sharingType),
  // operates on native window handles, and is deliberately unavailable to web
  // content because an invisible-to-screenshare overlay is a phishing tool.
  // So: while privacy mode is on, the features are off too. That's the deal.
  let privacyMode = false;

  function enterPrivacyMode() {
    privacyMode = true;
    removePill();
    removeBar();
    closeCapture();
    unmountBubble();
    removeDocCard();
    teardownExtras();
    // Drop the shadow host itself so nothing of ours remains in the page.
    if (afHost) {
      afHost.remove();
      afHost = null;
      afRoot = null;
    }
  }

  function exitPrivacyMode() {
    privacyMode = false;
    if (bubbleEnabled) mountBubble();
    // A page loaded while privacy mode was on skipped these during init, so
    // apply them now — otherwise copy-restore stays dead on that tab until it
    // is reloaded. Both self-guard against running twice.
    restoreCopyPaste();
    initExtras();
  }

  // ---------- Copy / selection restore ----------
  // Some sites block text SELECTION itself (not just the clipboard) — via CSS
  // (user-select: none), by cancelling selectstart/copy/contextmenu in JS, by
  // trapping the Ctrl+C keystroke, or by wiping the selection from a
  // selectionchange handler the moment it appears. If nothing can be selected,
  // the bar never gets a chance to appear, the Copy chip has nothing to copy,
  // and — the reason this matters most — the assistant has no way to read the
  // text you want it to answer about. Undone in three layers:
  //  1. a CSS override that forces selection (and a VISIBLE highlight) back on;
  //  2. capture-phase listeners on `window` — the outermost point an event
  //     passes through — so they run before any handler the page attached on
  //     document/body, in capture OR bubble phase, whenever its script ran;
  //  3. only on pages that look deliberately hostile, a harder layer that
  //     strips inline blockers and silences selectionchange (see below).
  // Whatever still resists all three, Alt+click reads straight out of the DOM
  // (see "Ask without highlighting" further down) — that path needs no
  // selection at all.
  // Does this page look like it is DELIBERATELY blocking copying, as opposed
  // to an ordinary page a user happened to copy something on? Computed once,
  // BEFORE we apply any override, so it reflects the page's original intent.
  // It drives two separate things:
  //  1. the (reporting-only) telemetry event below — see app/models.py
  //     BypassEvent for the full rationale; it is never an automatic judgment.
  //  2. whether to switch on the SECOND, more aggressive layer of unblocking
  //     (applyHardUnblock). That layer is deliberately off by default: it
  //     suppresses events ordinary pages use legitimately — selectionchange in
  //     particular is how rich text editors track the caret — so it is only
  //     worth its cost on a page that is actually fighting the user.
  let blockedGuess = null;
  const BLOCK_ATTRS = [
    "oncopy",
    "oncut",
    "onselectstart",
    "oncontextmenu",
    "ondragstart",
    "onbeforecopy",
  ];

  function looksCopyBlocked() {
    if (blockedGuess !== null) return blockedGuess;
    let hit = false;
    try {
      const body = document.body || document.documentElement;
      const cs = getComputedStyle(body);
      // Sites almost never set user-select: none on their whole body/root
      // unless copy-blocking is intentional.
      hit = cs.userSelect === "none" || cs.webkitUserSelect === "none";
      if (!hit) {
        // The other half of how this is done in the wild, and just as
        // deliberate: <body oncopy="return false" onselectstart="return false">.
        const roots = [document.documentElement, document.body].filter(Boolean);
        hit = roots.some((el) => BLOCK_ATTRS.some((a) => el.hasAttribute(a)));
      }
      if (!hit) hit = !!document.querySelector('[unselectable="on"]');
    } catch {
      /* best effort — a failed guess just means the gentle layer only */
    }
    blockedGuess = hit;
    return hit;
  }

  function reportIfLooksBlocked() {
    try {
      if (!looksCopyBlocked()) return;
      send({
        type: "API_CALL",
        path: "/telemetry/bypass-event",
        method: "POST",
        body: { domain: location.hostname },
      });
    } catch {
      /* best effort — never let telemetry break the actual feature */
    }
  }

  // Remove the inline handlers a page uses to cancel copy/selection outright.
  // Scoped to <html> and <body> on purpose: those are where blanket blockers
  // are installed, and touching every element in the tree would be both slow
  // and far more likely to break a legitimate widget.
  function stripBlockingAttrs() {
    [document.documentElement, document.body].forEach((el) => {
      if (!el) return;
      BLOCK_ATTRS.forEach((a) => {
        if (el.hasAttribute(a)) el.removeAttribute(a);
        try {
          el[a] = null; // also clear the property form (el.oncopy = ...)
        } catch {}
      });
    });
    // The legacy IE-era attribute, still shipped by a surprising number of
    // "protected" reader templates. Bounded so a huge page can't stall.
    try {
      const marked = document.querySelectorAll('[unselectable="on"]');
      for (let i = 0; i < Math.min(marked.length, 400); i++) marked[i].removeAttribute("unselectable");
    } catch {}
  }

  // A stylesheet rule with !important beats an inline `style="user-select:none"`
  // — but NOT an inline `!important`, which is the one case our CSS override
  // loses. Strip it off the element the user actually clicked and its nearest
  // ancestors, which is where such a rule is ever set.
  function stripInlineUserSelect(node) {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    for (let i = 0; i < 8 && el && el.style; i++) {
      const v = el.style.userSelect || el.style.webkitUserSelect;
      if (v && v.toLowerCase() === "none") {
        el.style.removeProperty("user-select");
        el.style.removeProperty("-webkit-user-select");
      }
      if (el.hasAttribute && el.hasAttribute("unselectable")) el.removeAttribute("unselectable");
      el = el.parentElement;
    }
  }

  // A page stylesheet does NOT cross a shadow boundary, so a component that
  // sets user-select:none inside its OWN shadow root is completely untouched
  // by the override above — which is why the odd widget (a quiz card, an
  // embedded reader, a design-system component) still refuses to be selected
  // on a page where everything else works. Fix it by putting the same rules
  // INSIDE each open shadow root. No tree walk: the composed path of whatever
  // the user just reached for is exactly the chain of roots involved, so this
  // costs nothing and only touches components actually being used.
  const shadowPatched = new WeakSet();
  function unblockShadowRoot(root) {
    if (!root || shadowPatched.has(root)) return;
    shadowPatched.add(root);
    try {
      const st = document.createElement("style");
      st.textContent = restoreStyle
        ? restoreStyle.textContent
        : "* { -webkit-user-select: text !important; user-select: text !important; }";
      root.appendChild(st);
    } catch {
      /* a closed root can't be reached from here at all — nothing to do */
    }
  }

  function unblockAlongPath(e) {
    const path = (e.composedPath && e.composedPath()) || [];
    for (let i = 0; i < Math.min(path.length, 24); i++) {
      const node = path[i];
      if (node && node.nodeType === 11 && node.host) unblockShadowRoot(node);
    }
    stripInlineUserSelect(path[0] || e.target);
  }

  let copyPasteRestored = false;
  let restoreStyle = null;
  function restoreCopyPaste() {
    if (!selectEnabled || copyPasteRestored) return;
    copyPasteRestored = true;
    const blocked = looksCopyBlocked(); // read the page's intent first
    reportIfLooksBlocked();

    restoreStyle = document.createElement("style");
    restoreStyle.id = "af-restore-select";
    restoreStyle.textContent = `
      * { -webkit-user-select: text !important; -moz-user-select: text !important;
          -ms-user-select: text !important; user-select: text !important; }
      * { -webkit-touch-callout: default !important; }
      /* Some sites leave selection working but paint the highlight invisible,
         so you can't see what you grabbed. Force a visible one back. */
      ::selection { background: rgba(91,108,240,.32) !important; }
      ::-moz-selection { background: rgba(91,108,240,.32) !important; }
    `;
    (document.head || document.documentElement).appendChild(restoreStyle);

    // Anti-copy scripts routinely delete injected stylesheets they don't
    // recognize. Watch the two places ours can live and put it straight back —
    // childList only (no subtree), so this costs nothing on a busy page.
    try {
      const keepAlive = new MutationObserver(() => {
        if (restoreStyle && !restoreStyle.isConnected) {
          (document.head || document.documentElement).appendChild(restoreStyle);
        }
      });
      keepAlive.observe(document.documentElement, { childList: true });
      if (document.head) keepAlive.observe(document.head, { childList: true });
    } catch {}

    // A capture-phase listener on `window` — the outermost point an event
    // passes through — runs before any listener the page attached on
    // document/body, in capture OR bubble phase, regardless of when the page's
    // script ran. stopImmediatePropagation() there stops the page's own
    // blocking handler from ever firing, without needing to know anything
    // about how the site implemented the block. Note we never preventDefault:
    // the browser's own copy still happens, we only silence the page's
    // reaction to it.
    // Paste belongs on this list as much as copy does: "paste is disabled in
    // this field" (confirm-your-email boxes, exam portals, banking forms) is
    // the same trick pointed the other way, and it is just as easily undone —
    // stop the page's handler, let the browser's own paste happen.
    ["selectstart", "copy", "cut", "paste", "beforecopy", "beforecut", "beforepaste", "contextmenu"].forEach((type) => {
      window.addEventListener(type, (e) => e.stopImmediatePropagation(), true);
    });

    // Some anti-copy scripts don't hook those events at all — they listen for
    // the Ctrl/Cmd+C keystroke directly and react to that instead (block it,
    // flash a warning, swap the DOM to "catch" the attempt). Neutralize it the
    // same way. Ctrl+A is in the same family of blocks, but only silenced on a
    // page we already judged hostile: plenty of legitimate apps (editors,
    // canvases, mail clients) bind Ctrl+A to their own select-all, and taking
    // that away everywhere would break them for no gain.
    window.addEventListener(
      "keydown",
      (e) => {
        const key = (e.key || "").toLowerCase();
        if (!(e.ctrlKey || e.metaKey)) return;
        if (key === "c" || key === "x" || key === "v" || (key === "a" && hardUnblocked)) {
          e.stopImmediatePropagation();
        }
      },
      true
    );

    // Runs on every page, not just hostile ones: it is cheap (a short path
    // walk on a click you already made) and it is the only thing that reaches
    // inside a shadow-DOM component or beats an inline `!important`.
    window.addEventListener("mousedown", unblockAlongPath, true);

    if (blocked) applyHardUnblock();
  }

  // The second layer, only for pages that are actually fighting the user.
  let hardUnblocked = false;
  function applyHardUnblock() {
    if (hardUnblocked) return;
    hardUnblocked = true;
    stripBlockingAttrs();

    // The nastiest variant: a script that lets you select, then wipes the
    // selection from a selectionchange handler so the highlight dies the
    // instant it appears. selectionchange is fired at `document`, so a capture
    // listener on window sees it first and can stop it reaching the page.
    window.addEventListener("selectionchange", (e) => e.stopImmediatePropagation(), true);

    // Blocked pages are also the ones that cancel dragstart to stop images and
    // text being dragged out. Safe to neutralize HERE, where we already know
    // the site is hostile — doing it everywhere would break legitimate
    // drag-and-drop UIs (Trello-style boards, file drop zones).
    window.addEventListener("dragstart", (e) => e.stopImmediatePropagation(), true);
  }

  // Some sites disable copy/paste (block the native "copy"/"paste" events,
  // or preventDefault on Ctrl+C/Ctrl+V) to stop people lifting content off
  // the page. That blocking targets the page's own DOM events — it can't
  // reach the OS clipboard directly. So for anything of ours (the selection
  // bar's input, the quick-capture note box) we bypass the page entirely and
  // talk to the Clipboard API ourselves.
  function forceCopy(text) {
    if (!text) return Promise.resolve(false);
    // 1) The async Clipboard API — best when available and permitted.
    const viaApi = () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
      } catch {}
      return Promise.resolve(false);
    };
    // 2) Fallback: a hidden textarea + execCommand('copy'). This works in many
    //    places the async API refuses (page not focused, clipboard permission
    //    blocked). restoreCopyPaste()'s capture-phase 'copy' listener stops the
    //    page's own copy-blocker from cancelling it.
    const viaExec = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
        (document.body || document.documentElement).appendChild(ta);
        ta.focus();
        ta.select();
        try { ta.setSelectionRange(0, text.length); } catch {}
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    };
    return viaApi().then((ok) => ok || viaExec());
  }

  function enablePasteBypass(el) {
    el.addEventListener("keydown", (e) => {
      const key = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "v") {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text == null) return;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;
            el.value = el.value.slice(0, start) + text + el.value.slice(end);
            const caret = start + text.length;
            el.setSelectionRange(caret, caret);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          })
          .catch(() => {});
      }
    });
  }

  let bar = null;
  let assistantAgentId = null;
  let lastSelectionText = "";
  // Drag / resize state for the bar (reset each time a new bar is shown).
  let barMoved = false; // user dragged it → stop auto-repositioning on scroll
  let userBarWidth = null; // user-set width via the resize handle
  let userAnswerHeight = null; // user-set answer-box height via the resize handle

  // Remembered bar state so closing and reopening doesn't lose what you typed or
  // the answer you got. Kept in memory AND mirrored to sessionStorage, so it also
  // survives a page reload (per tab). Restored every time the bar is shown.
  let savedQuestion = "";
  let savedAnswer = null;
  let savedAnswerError = false;
  let savedWidth = null;
  let savedAnswerHeight = null;
  let savedMinimized = false;
  let savedPos = null; // { left, top }
  try {
    const raw = sessionStorage.getItem("af_bar_state");
    if (raw) {
      const s = JSON.parse(raw);
      savedQuestion = s.q || "";
      savedAnswer = s.a != null ? s.a : null;
      savedAnswerError = !!s.e;
      savedWidth = s.w || null;
      savedAnswerHeight = s.ah || null;
      savedMinimized = !!s.m;
      savedPos = s.p || null;
    }
  } catch {}
  function persistBarState() {
    try {
      sessionStorage.setItem(
        "af_bar_state",
        JSON.stringify({
          q: savedQuestion,
          a: savedAnswer,
          e: savedAnswerError,
          w: savedWidth,
          ah: savedAnswerHeight,
          m: savedMinimized,
          p: savedPos,
        })
      );
    } catch {}
  }
  // Apply remembered size / position / minimized / answer onto a freshly built bar.
  function restoreBarState(barEl) {
    if (savedWidth) {
      userBarWidth = savedWidth;
      barEl.style.width = savedWidth + "px";
      barEl.style.maxWidth = "none";
    }
    if (savedAnswerHeight) userAnswerHeight = savedAnswerHeight;
    if (savedPos) {
      barMoved = true;
      const w = barEl.offsetWidth || 320;
      const h = barEl.offsetHeight || 120;
      const left = Math.max(4, Math.min(savedPos.left, window.innerWidth - w - 4));
      const top = Math.max(4, Math.min(savedPos.top, window.innerHeight - h - 4));
      barEl.style.left = left + "px";
      barEl.style.top = top + "px";
    }
    if (savedMinimized) {
      barEl.classList.add("af-min-state");
      const mb = barEl.querySelector(".af-min");
      if (mb) {
        mb.innerHTML = SVG_EXPAND;
        mb.title = "Restore";
      }
    }
    if (savedAnswer != null && savedAnswer !== "") {
      showAnswer(savedAnswer, savedAnswerError, false);
    }
  }

  // Select-to-ask and the floating bubble can both be turned off from the
  // popup (Settings). Cached locally and kept live via storage.onChanged, so
  // toggling takes effect on every open tab immediately — no refresh needed.
  // The bubble is OFF by default now: it duplicated the highlight bar's Save
  // action and just added clutter to every page. Off unless a user opts in.
  let selectEnabled = true;
  let bubbleEnabled = false;
  // Image AI and auto-edit are ON by default: both only ever show up in
  // response to something the user is already doing (hovering an image,
  // focusing a text box), and hiding them behind an opt-in is how a feature
  // never gets found. Same live-toggle wiring as the other two.
  let imageAiEnabled = true;
  let autoEditEnabled = true;
  // Live suggestions call the backend on a typing pause, so they get their own
  // switch rather than riding on auto-edit's.
  let proofEnabled = true;
  // Spotting questions on the page and offering to answer them, with no
  // highlighting at all.
  let questionSpotEnabled = true;
  try {
    chrome.storage.local.get(
      [
        "af_select_enabled",
        "af_bubble_enabled",
        "af_privacy_mode",
        "af_image_ai_enabled",
        "af_autoedit_enabled",
        "af_proof_enabled",
        "af_qspot_enabled",
      ],
      (r) => {
        if (typeof r.af_select_enabled === "boolean") selectEnabled = r.af_select_enabled;
        if (typeof r.af_bubble_enabled === "boolean") bubbleEnabled = r.af_bubble_enabled;
        if (typeof r.af_image_ai_enabled === "boolean") imageAiEnabled = r.af_image_ai_enabled;
        if (typeof r.af_autoedit_enabled === "boolean") autoEditEnabled = r.af_autoedit_enabled;
        if (typeof r.af_proof_enabled === "boolean") proofEnabled = r.af_proof_enabled;
        if (typeof r.af_qspot_enabled === "boolean") questionSpotEnabled = r.af_qspot_enabled;
        privacyMode = r.af_privacy_mode === true;
        if (privacyMode) return; // stay fully off — don't mount anything
        if (bubbleEnabled) mountBubble();
        restoreCopyPaste();
        initExtras();
        initDocAssistant();
      }
    );
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if ("af_privacy_mode" in changes) {
        if (changes.af_privacy_mode.newValue === true) enterPrivacyMode();
        else exitPrivacyMode();
      }
      if ("af_select_enabled" in changes) {
        selectEnabled = changes.af_select_enabled.newValue !== false;
        if (!selectEnabled) closeSelUI();
        else restoreCopyPaste();
      }
      if ("af_bubble_enabled" in changes) {
        bubbleEnabled = changes.af_bubble_enabled.newValue !== false;
        if (bubbleEnabled) mountBubble();
        else unmountBubble();
      }
      if ("af_image_ai_enabled" in changes) {
        imageAiEnabled = changes.af_image_ai_enabled.newValue !== false;
        if (!imageAiEnabled) {
          removeImgBadge();
          removeImgCard();
        }
      }
      if ("af_qspot_enabled" in changes) {
        questionSpotEnabled = changes.af_qspot_enabled.newValue !== false;
        if (questionSpotEnabled) scheduleQuestionScan(200);
        else removeQBadge();
      }
      if ("af_proof_enabled" in changes) {
        proofEnabled = changes.af_proof_enabled.newValue !== false;
        if (!proofEnabled) {
          proofIssues = [];
          paintProofCount();
        }
      }
      if ("af_autoedit_enabled" in changes) {
        autoEditEnabled = changes.af_autoedit_enabled.newValue !== false;
        if (!autoEditEnabled) {
          closeEditMenu();
          removeEditBadge();
        }
      }
    });
  } catch {
    /* extension context not ready yet — defaults to enabled */
    restoreCopyPaste();
    initExtras();
    initDocAssistant();
  }

  let highlightOverlay = null;

  function clearHighlightOverlay() {
    if (highlightOverlay) {
      highlightOverlay.remove();
      highlightOverlay = null;
    }
  }

  // Paint our OWN highlight boxes over the selected text instead of relying on
  // the browser's native selection staying visible. Necessary because many
  // sites (React/virtualized feeds like X, infinite-scroll pages, etc.)
  // re-render their DOM on their own schedule, which silently collapses the
  // native Selection — even though nothing we do touches it. Our overlay is
  // independent of that: once drawn, it stays until we explicitly clear it.
  function drawHighlightOverlay(range) {
    clearHighlightOverlay();
    let rects;
    try {
      rects = range.getClientRects();
    } catch {
      return;
    }
    if (!rects || !rects.length) return;
    const container = document.createElement("div");
    container.className = "af-sel-highlight";
    for (const r of rects) {
      if (r.width < 1 || r.height < 1) continue;
      const box = document.createElement("div");
      box.className = "af-sel-highlight-box";
      box.style.top = `${r.top}px`;
      box.style.left = `${r.left}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      container.appendChild(box);
    }
    getAfRoot().appendChild(container);
    highlightOverlay = container;
  }

  function removeBar() {
    if (bar) {
      bar.remove();
      bar = null;
    }
    clearHighlightOverlay();
    // The question badge stands down while the bar is open; once it closes,
    // look again — the next question is usually right there.
    try {
      scheduleQuestionScan(300);
    } catch {
      /* spotter not initialised on this page */
    }
  }

  // Collapse-first UX: a selection shows a tiny PILL, not the full bar, so it
  // barely covers the text. Clicking the pill expands the bar. The pill + bar
  // both follow the selection on scroll (via anchorRange) so you can read.
  let pill = null;
  let anchorRange = null; // the selection's Range, kept so we can re-anchor

  function removePill() {
    if (pill) {
      pill.remove();
      pill = null;
    }
  }
  // Close everything the selection flow put on screen.
  function closeSelUI() {
    removePill();
    removeBar(); // also clears the highlight overlay
  }

  function anchorRect() {
    // Live viewport rect of the current selection — recomputed each call so it
    // tracks scrolling. Returns null if the range is gone/collapsed off-screen.
    if (!anchorRange) return null;
    try {
      const r = anchorRange.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return null;
      return r;
    } catch {
      return null;
    }
  }

  function showPill(rect) {
    if (!selectEnabled || privacyMode || isTinyFrame()) return;
    removePill();
    if (bar) {
      bar.remove();
      bar = null;
    }
    pill = document.createElement("div");
    pill.className = "af-sel-pill" + (pageIsLight() ? " af-light" : "");
    pill.innerHTML = `<span class="af-pill-main"><span class="af-pill-label">Ask</span><span class="af-sel-icon af-logo">AF</span></span><button type="button" class="af-pill-copy" title="Copy selection (works even where copying is blocked)">${SVG_COPY}</button>`;
    getAfRoot().appendChild(pill);
    // Position just under the selection start, clamped to the viewport.
    const m = 8;
    const w = pill.offsetWidth || 72;
    const h = pill.offsetHeight || 30;
    let left = Math.max(m, Math.min(rect.left, window.innerWidth - w - m));
    let top = rect.bottom + m;
    if (top + h > window.innerHeight - m) {
      const above = rect.top - h - m;
      top = above >= m ? above : rect.bottom + m;
    }
    pill.style.left = `${left}px`;
    pill.style.top = `${top}px`;
    requestAnimationFrame(() => pill.classList.add("af-in"));
    // Don't let the click steal/clear the selection; expand to the full bar.
    pill.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    // The "Ask AF" part expands to the full bar…
    pill.querySelector(".af-pill-main").onclick = () => {
      const r = anchorRect() || rect;
      removePill();
      showBar(r, "", false);
    };
    // …and the copy icon copies the selection directly, without expanding —
    // through the Clipboard API, so it works even where the page blocks copying.
    const pillCopy = pill.querySelector(".af-pill-copy");
    pillCopy.onclick = async (e) => {
      e.stopPropagation();
      const ok = await forceCopy(lastSelectionText);
      pillCopy.innerHTML = ok ? SVG_CHECK : SVG_COPY;
      pillCopy.classList.toggle("af-ok", ok);
      setTimeout(() => {
        if (pillCopy) {
          pillCopy.innerHTML = SVG_COPY;
          pillCopy.classList.remove("af-ok");
        }
      }, 1400);
    };
  }

  // Viewport coordinates, paired with position: fixed. Deliberately NOT
  // absolute + scroll offsets: an absolutely-positioned element resolves
  // against its nearest *positioned* ancestor, and on app-like sites (ChatGPT,
  // Gmail, most React layouts) some ancestor almost always has `transform` or
  // `position: relative`, which silently moves the containing block and puts
  // the bar off-screen — present in the DOM, invisible to the user. `fixed`
  // always resolves against the viewport, so getBoundingClientRect() values
  // can be used directly and the result is identical on every site.
  // Position the bar in VIEWPORT coordinates (it's position: fixed). Measures
  // the bar's real size after it's in the DOM, then:
  //  • horizontally: aligns to the selection's left edge but clamps so the bar
  //    never runs off either side (the old code used a hardcoded 380 width,
  //    which misplaced the now-wider multi-chip bar).
  //  • vertically: sits below the selection if it fits, otherwise flips ABOVE
  //    it — so a selection near the bottom of the screen no longer pushes the
  //    bar off-screen or has it appear detached ("going up") from the text.
  function positionBar(rect) {
    if (!bar) return;
    if (barMoved) return; // user dragged it somewhere — leave it put
    const m = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = bar.offsetWidth || 320;
    const h = bar.offsetHeight || 120;

    let left = Math.min(rect.left, vw - w - m);
    left = Math.max(m, left);

    let top = rect.bottom + m;
    if (top + h > vh - m) {
      const above = rect.top - h - m;
      top = above >= m ? above : Math.max(m, vh - h - m);
    }
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  function ensureAnswerBox() {
    let box = bar.querySelector(".af-sel-answer");
    if (!box) {
      box = document.createElement("div");
      box.className = "af-sel-answer";
      bar.appendChild(box);
      requestAnimationFrame(() => box.classList.add("af-in"));
    }
    return box;
  }

  // Cap the answer/results box to the space actually left on screen below the
  // bar, so it can never spill past the viewport into a blind spot. Then
  // re-place the bar (it may need to flip up) so the whole thing stays visible.
  function fitAnswerBox() {
    const box = bar && bar.querySelector(".af-sel-answer");
    if (!box) return;
    const barRect = bar.getBoundingClientRect();
    if (userAnswerHeight) {
      // User set a height with the resize handle — honour it.
      box.style.maxHeight = userAnswerHeight + "px";
    } else {
      const below = window.innerHeight - barRect.bottom - 16;
      const above = barRect.top - 16;
      // Give it whichever side has more room; hard cap so it always fits.
      const avail = Math.max(below, above, 140);
      box.style.maxHeight = Math.min(avail, Math.round(window.innerHeight * 0.6)) + "px";
    }
    const r = anchorRect();
    if (r) positionBar(r);
  }

  // Wire the bar's drag handle, minimize button, and resize corner.
  function wireBarChrome(barEl) {
    const handle = barEl.querySelector(".af-sel-handle");
    const minBtn = barEl.querySelector(".af-min");
    const resizer = barEl.querySelector(".af-resize");

    // Drag by the handle (but not when clicking the minimize button).
    if (handle) {
      handle.addEventListener("mousedown", (e) => {
        if (e.target.closest(".af-min")) return;
        e.preventDefault();
        const r = barEl.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
        const move = (ev) => {
          barMoved = true;
          let nl = start.left + (ev.clientX - start.x);
          let nt = start.top + (ev.clientY - start.y);
          nl = Math.max(4, Math.min(nl, window.innerWidth - barEl.offsetWidth - 4));
          nt = Math.max(4, Math.min(nt, window.innerHeight - 28));
          barEl.style.left = nl + "px";
          barEl.style.top = nt + "px";
          savedPos = { left: nl, top: nt };
          persistBarState();
        };
        const up = () => {
          window.removeEventListener("mousemove", move, true);
          window.removeEventListener("mouseup", up, true);
        };
        window.addEventListener("mousemove", move, true);
        window.addEventListener("mouseup", up, true);
      });
    }

    // Minimize / restore — collapse to just the handle strip.
    if (minBtn) {
      minBtn.onclick = (e) => {
        e.stopPropagation();
        const min = barEl.classList.toggle("af-min-state");
        minBtn.innerHTML = min ? SVG_EXPAND : SVG_MIN;
        minBtn.title = min ? "Restore" : "Minimize";
        savedMinimized = min;
        persistBarState();
      };
    }

    // Resize from the bottom-right corner: width + answer-box height.
    if (resizer) {
      resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = barEl.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, w: r.width };
        let lastY = e.clientY;
        const move = (ev) => {
          const nw = Math.max(300, Math.min(start.w + (ev.clientX - start.x), Math.min(760, window.innerWidth - 20)));
          userBarWidth = nw;
          barEl.style.width = nw + "px";
          barEl.style.maxWidth = "none";
          const box = barEl.querySelector(".af-sel-answer");
          if (box) {
            const cur = box.getBoundingClientRect().height || 140;
            userAnswerHeight = Math.max(90, cur + (ev.clientY - lastY));
            box.style.maxHeight = userAnswerHeight + "px";
          }
          lastY = ev.clientY;
          savedWidth = userBarWidth;
          savedAnswerHeight = userAnswerHeight;
          persistBarState();
        };
        const up = () => {
          window.removeEventListener("mousemove", move, true);
          window.removeEventListener("mouseup", up, true);
        };
        window.addEventListener("mousemove", move, true);
        window.addEventListener("mouseup", up, true);
      });
    }
  }

  // Render text with fenced ```code blocks``` as real code blocks (monospace,
  // horizontal-scroll, own Copy button). Everything else is escaped plain text.
  function renderRich(container, text) {
    container.innerHTML = "";
    const parts = String(text).split(/```/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        // code block — first line may be a language label
        let code = part.replace(/^\n/, "");
        const nl = code.indexOf("\n");
        if (nl > -1 && /^[a-z0-9+#-]{1,15}$/i.test(code.slice(0, nl).trim())) {
          code = code.slice(nl + 1);
        }
        code = code.replace(/\n$/, "");
        const wrap = document.createElement("div");
        wrap.className = "af-code-wrap";
        const pre = document.createElement("pre");
        pre.className = "af-code";
        pre.textContent = code;
        const cbtn = document.createElement("button");
        cbtn.type = "button";
        cbtn.className = "af-code-copy";
        cbtn.textContent = "Copy";
        cbtn.onclick = () => {
          navigator.clipboard.writeText(code).catch(() => {});
          cbtn.textContent = "Copied";
          setTimeout(() => (cbtn.textContent = "Copy"), 1400);
        };
        wrap.appendChild(cbtn);
        wrap.appendChild(pre);
        container.appendChild(wrap);
      } else if (part) {
        const d = document.createElement("div");
        d.className = "af-sel-answer-text";
        // Models answer in light markdown whether you asked for it or not (the
        // image "solve" mode is the worst offender: a bold answer, then a
        // heading, then bullets). Rendering the handful of marks they actually
        // use beats showing raw ** and ### to the user. Everything is escaped
        // FIRST, so only these fixed tags can ever reach the DOM.
        d.innerHTML = escapeHtml(part)
          .replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, "<strong>$1</strong>")
          .replace(/^\s*[-*•]\s+(.+)$/gm, "• $1")
          .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
          .replace(/`([^`\n]+)`/g, "<code>$1</code>")
          .replace(/\n/g, "<br>");
        container.appendChild(d);
      }
    });
  }

  function showAnswer(text, isError, busy) {
    if (!bar) return;
    const box = ensureAnswerBox();
    box.classList.toggle("af-err", !!isError);
    if (busy) {
      box.innerHTML = `<span class="af-sel-spin"></span><span>${escapeHtml(text)}</span>`;
      fitAnswerBox();
      return;
    }
    renderRich(box, text);
    // Remember this answer so reopening the bar restores it.
    savedAnswer = text;
    savedAnswerError = !!isError;
    persistBarState();
    if (!isError) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "af-copy";
      copyBtn.textContent = "Copy all";
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(text).catch(() => {});
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy all"), 1400);
      };
      box.appendChild(copyBtn);
    }
    fitAnswerBox();
  }

  function prettyUrl(u) {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u || "";
    }
  }
  function safeUrl(u) {
    try {
      const x = new URL(u);
      return x.protocol === "http:" || x.protocol === "https:" ? x.href : "#";
    } catch {
      return "#";
    }
  }

  // Render real web results in the answer box below the bar — brings the
  // "search appears here" experience inline instead of redirecting to a new
  // tab. Results come from our backend's free web search (ddgs), so this
  // costs zero LLM/Groq credits. Clicking a result opens that page (expected).
  // Answer-first: the AI verdict is the hero; the raw web sources collapse into
  // a small "Sources (N)" toggle, hidden by default, so the user sees the
  // answer — not a wall of links to sift.
  function showResults(results, verdict) {
    if (!bar) return;
    const box = ensureAnswerBox();
    box.classList.remove("af-err");
    box.innerHTML = "";

    if (verdict && verdict.trim()) {
      const v = document.createElement("div");
      v.className = "af-verdict";
      renderRich(v, verdict); // supports code blocks in the verdict too
      box.appendChild(v);
      // Remember the searched answer so reopening restores it.
      savedAnswer = verdict;
      savedAnswerError = false;
      persistBarState();
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "af-copy";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(verdict).catch(() => {});
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1400);
      };
      box.appendChild(copyBtn);
    } else if (!results || !results.length) {
      box.innerHTML = `<div class="af-sel-answer-text">No answer — try the Answer button.</div>`;
      fitAnswerBox();
      return;
    }

    if (results && results.length) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "af-src-toggle";
      toggle.textContent = `Sources (${results.length})`;
      const list = document.createElement("div");
      list.className = "af-src-list";
      list.hidden = true; // collapsed by default
      list.innerHTML = results
        .map(
          (r) => `
        <a class="af-result" href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">
          <div class="af-result-title">${escapeHtml(r.title || prettyUrl(r.url))}</div>
          <div class="af-result-url">${escapeHtml(prettyUrl(r.url))}</div>
          <div class="af-result-snippet">${escapeHtml((r.snippet || "").slice(0, 160))}</div>
        </a>`
        )
        .join("");
      toggle.onclick = () => {
        list.hidden = !list.hidden;
        toggle.textContent = (list.hidden ? "Sources" : "Hide sources") + ` (${results.length})`;
        fitAnswerBox();
      };
      box.appendChild(toggle);
      box.appendChild(list);
    }
    fitAnswerBox();
  }

  // Turn a messy selection into a good web query. A multiple-choice question
  // selected whole (stem + A/B/C/D options) makes a terrible search — the engine
  // latches onto a stray word (e.g. "following") and returns junk. Prefer the
  // question stem: everything up to and including the first '?'. Otherwise the
  // first line, capped, drops the option noise.
  function searchQuery(text) {
    const q = (text || "").trim();
    const qm = q.indexOf("?");
    if (qm > 10 && qm < 220) return q.slice(0, qm + 1);
    const firstLine = q.split(/\n/)[0].trim();
    return (firstLine.length > 8 ? firstLine : q).slice(0, 220);
  }

  // Google chip → search + VERDICT: the backend runs the free web search, then
  // a fast model reads the results and gives a direct answer, shown above the
  // source links. Turns "here are 6 links, go sift" into "here's the answer,
  // and the sources." Cheap: ddgs (free) + fast Groq.
  async function searchWeb() {
    showAnswer("Searching…", false, true);
    const r = await send({
      type: "API_CALL",
      path: `/write/search-answer?q=${encodeURIComponent(searchQuery(lastSelectionText))}`,
      method: "GET",
    });
    if (!r.ok) {
      showAnswer(friendlyError(r), true);
      return;
    }
    const answer = r.data && r.data.answer;
    const results = r.data && r.data.results;
    // If the web synthesis came back empty (junk/no results), fall back to a
    // pure AI answer so the user is never left with nothing useful.
    if (!answer || !answer.trim()) {
      await ask("Respond to the highlighted text");
      return;
    }
    showResults(results, answer);
  }

  // Selection-bar answers go through the FAST /write/answer endpoint — one
  // direct Groq call, no agent graph / tools / memory — so replies land as
  // quickly as Groq can produce them. (The full agent, with memory + tools,
  // lives behind "Open in panel" for when you want depth over speed.)
  // `question` may be a specific ask or the Answer-mode prompt; either way the
  // selected text is sent as context.
  async function ask(question) {
    const q = (question || "").trim();
    if (!q && !lastSelectionText) return;
    showAnswer("Thinking…", false, true);

    // If the user typed a real question, pass it as `question`; the Answer-mode
    // prompt (long, canned) is treated as "no explicit question" so the backend
    // uses its own smart default on the selection.
    const isCanned = q.startsWith("Respond to the highlighted text");
    const body = {
      text: lastSelectionText.slice(0, 6000),
      question: isCanned ? "" : q,
    };
    const r = await send(
      { type: "API_CALL", path: "/write/answer", method: "POST", body },
      45000
    );
    if (!r.ok) {
      showAnswer(friendlyError(r), true);
      return;
    }
    showAnswer((r.data && r.data.answer) || "No answer.", false);
  }

  // One-click actions that DON'T ask the AI anything — they just save the
  // selection straight into your account. This is the thing generic
  // "select and ask AI" extensions can't offer: it's plugged into the same
  // backend as your Planner, Notes, and Brain, so it actually DOES something
  // for you instead of only answering a question. "Save note" in particular
  // is the study use case: highlight a passage on any article/site and it
  // lands in your Notes for review later — a web clipper, basically free.
  async function quickAction(kind) {
    if (!lastSelectionText) return;
    const labels = {
      remind: "Adding to your reminders…",
      brain: "Saving to your Brain…",
      note: "Saving note…",
    };
    showAnswer(labels[kind] || "Saving…", false, true);

    let r;
    if (kind === "remind") {
      const title = lastSelectionText.slice(0, 300);
      r = await send({ type: "API_CALL", path: "/reminders", method: "POST", body: { title, remind_at: "" } });
    } else if (kind === "brain") {
      const text = lastSelectionText.slice(0, 300);
      r = await send({ type: "API_CALL", path: "/brain", method: "POST", body: { text } });
    } else {
      // note: keep the page title so a saved snippet is traceable back to
      // its source later — the full text goes in the note body.
      const title = (document.title || "Note").slice(0, 200);
      const content = lastSelectionText.slice(0, 4000);
      r = await send({ type: "API_CALL", path: "/notes", method: "POST", body: { title, content } });
    }
    if (!r.ok) {
      showAnswer(friendlyError(r), true);
      return;
    }
    const done = {
      remind: "✓ Added to your Reminders.",
      brain: "✓ Saved to your Brain.",
      note: "✓ Saved to your Notes.",
    };
    showAnswer(done[kind] || "✓ Saved.", false);

    // Tell the side panel (if open) to refresh — otherwise a reminder/note
    // saved from the highlight bar wouldn't show up there until you manually
    // switch tabs and back.
    try {
      chrome.runtime.sendMessage({ type: "AF_DATA_CHANGED", kind }).catch(() => {});
    } catch {
      /* extension context not ready — the side panel just won't auto-refresh this once */
    }
  }

  // ---------- Persistent bubble (always visible — the point is discovery) ----
  // Requiring a toolbar-icon click means most students never find the
  // extension again after installing it. A small always-on bubble in the
  // corner of every page is a constant, low-friction reminder that AgentFury
  // is right there — click it to jot down whatever they're stuck on, without
  // needing the full side panel.
  let bubble = null;
  let captureCard = null;

  function closeCapture() {
    if (captureCard) {
      captureCard.remove();
      captureCard = null;
    }
  }

  function openCapture() {
    if (captureCard) {
      closeCapture();
      return;
    }
    captureCard = document.createElement("div");
    captureCard.className = "af-capture-card";
    captureCard.innerHTML = `
      <div class="af-capture-title">Stuck on something here?</div>
      <div class="af-capture-sub">Jot it down — it's saved to your Notes for later.</div>
      <textarea class="af-capture-input" placeholder="e.g. don't understand how this formula works…"></textarea>
      <div class="af-capture-row">
        <button type="button" class="af-capture-save">Save note</button>
        <a class="af-capture-open" href="#">Open AgentFury ↗</a>
      </div>
      <div class="af-capture-msg"></div>
    `;
    getAfRoot().appendChild(captureCard);
    requestAnimationFrame(() => captureCard.classList.add("af-in"));

    const input = captureCard.querySelector(".af-capture-input");
    const msg = captureCard.querySelector(".af-capture-msg");
    enablePasteBypass(input);
    input.focus();

    captureCard.querySelector(".af-capture-save").onclick = async () => {
      const text = input.value.trim();
      if (!text) return;
      msg.textContent = "Saving…";
      msg.className = "af-capture-msg";
      const title = (document.title || "Note").slice(0, 200);
      const r = await send({
        type: "API_CALL",
        path: "/notes",
        method: "POST",
        body: { title, content: text.slice(0, 4000) },
      });
      if (!r.ok) {
        msg.textContent = friendlyError(r);
        msg.className = "af-capture-msg af-err";
        return;
      }
      msg.textContent = "✓ Saved to your Notes.";
      input.value = "";
      try {
        chrome.runtime.sendMessage({ type: "AF_DATA_CHANGED", kind: "note" }).catch(() => {});
      } catch {
        /* best effort */
      }
      setTimeout(closeCapture, 900);
    };

    captureCard.querySelector(".af-capture-open").onclick = (e) => {
      e.preventDefault();
      try {
        chrome.runtime.sendMessage({ type: "AF_OPEN_PANEL" }).catch(() => {});
      } catch {
        /* if opening the panel isn't possible here, the click still closed nothing — fine */
      }
    };

    captureCard.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  function mountBubble() {
    if (bubble || !bubbleEnabled || privacyMode) return;
    if (!IS_TOP) return; // one bubble per tab, not one per iframe
    bubble = document.createElement("button");
    bubble.type = "button";
    bubble.className = "af-bubble";
    bubble.title = "AgentFury — note a difficulty, or click the toolbar icon for the full assistant";
    bubble.textContent = "AF";
    bubble.onclick = openCapture;
    getAfRoot().appendChild(bubble);
    requestAnimationFrame(() => bubble.classList.add("af-in"));
  }

  function unmountBubble() {
    closeCapture();
    if (bubble) {
      bubble.remove();
      bubble = null;
    }
  }

  // With a closed shadow root, any click that originates inside our UI is
  // retargeted to `afHost` by the time a document-level listener sees it —
  // the browser doesn't reveal which internal element was actually clicked.
  // So "was this an outside click" is just: did it NOT land on our host.
  // Capture phase for the same reason as the selection listeners below —
  // a page that stops mousedown propagation would otherwise leave this card
  // permanently un-dismissable.
  window.addEventListener(
    "mousedown",
    (e) => {
      if (captureCard && e.target !== afHost) closeCapture();
    },
    true
  );

  // Inline SVGs (currentColor, so they pick up the theme token).
  const SVG_COPY =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const SVG_CHECK =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  const SVG_SEND =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';
  const SVG_GRIP =
    '<svg width="18" height="10" viewBox="0 0 18 10" fill="currentColor"><circle cx="3" cy="3" r="1.35"/><circle cx="9" cy="3" r="1.35"/><circle cx="15" cy="3" r="1.35"/><circle cx="3" cy="7" r="1.35"/><circle cx="9" cy="7" r="1.35"/><circle cx="15" cy="7" r="1.35"/></svg>';
  const SVG_MIN =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>';
  const SVG_EXPAND =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 20h5v-5"/></svg>';

  // Decide light vs dark by the page's actual background luminance, so the bar
  // blends into whatever site it's on instead of always being a dark block on
  // a white page (the reported problem). Walks up a few ancestors to find a
  // real (non-transparent) background; falls back to prefers-color-scheme.
  function pageIsLight() {
    try {
      let el = document.body || document.documentElement;
      for (let i = 0; el && i < 5; i++, el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor || "";
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) continue;
        const parts = m[1].split(",").map((n) => parseFloat(n));
        const [r, g, b, a = 1] = parts;
        if (a < 0.2) continue; // transparent — keep walking up
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return lum > 0.6;
      }
      return !(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch {
      return false;
    }
  }

  // "Answer" mode prompt — the trained default for both the Answer chip and
  // the send button when nothing is typed. Handles the three things people
  // actually select: a question / MCQ (answer it), a term or concept
  // (explain it), or a claim (say if it's right). Kept tight so the reply is
  // short and lands fast.
  const ANSWER_PROMPT =
    "Respond to the highlighted text based on what it is:\n" +
    "- If it is a question (including multiple choice), give the correct answer directly, then a one-line reason. For multiple choice, name the correct option (e.g. \"C\") and its text.\n" +
    "- If it is a term, concept, or phrase, explain it clearly in 1–3 sentences.\n" +
    "- If it is a statement/claim, say whether it is correct and briefly why.\n" +
    "Be accurate and concise. No preamble.";

  function showBar(rect, prefill, autoFocus) {
    if (!selectEnabled || privacyMode || isTinyFrame()) return; // one choke point for every switch
    removePill();
    removeBar(); // clears the highlight — redraw it below from anchorRange
    if (anchorRange) drawHighlightOverlay(anchorRange);
    bar = document.createElement("div");
    bar.className = "af-sel-bar" + (pageIsLight() ? " af-light" : "");
    barMoved = false;
    userBarWidth = null;
    userAnswerHeight = null;
    bar.innerHTML = `
      <div class="af-sel-handle">
        <span class="af-grip" title="Drag to move">${SVG_GRIP}</span>
        <span class="af-min-label">AgentFury</span>
        <button type="button" class="af-min" title="Minimize">${SVG_MIN}</button>
      </div>
      <div class="af-sel-row">
        <input type="text" class="af-sel-input" placeholder="Ask about this…" />
        <button type="button" class="af-ic af-copy-ic" title="Copy (works even where copying is blocked)">${SVG_COPY}</button>
        <button type="button" class="af-sel-send" title="Get an AI answer (Enter)">${SVG_SEND}</button>
      </div>
      <div class="af-sel-chips">
        <button type="button" class="af-sel-chip af-answer" data-answer="1" title="Answer or explain this — solves questions and multiple-choice directly">Answer</button>
        <button type="button" class="af-sel-chip" data-web="1" title="Search the web — results appear right here, no redirect">Google</button>
        <button type="button" class="af-sel-chip af-sel-action" data-action="note" title="Save to your Notes">Save</button>
        <button type="button" class="af-sel-chip af-more-btn" data-more="1">More</button>
      </div>
      <div class="af-sel-more" hidden>
        <button type="button" class="af-sel-chip" data-q="Summarize this concisely.">Summarize</button>
        <button type="button" class="af-sel-chip" data-search="gemini" title="Open Gemini (Google AI Mode) in a new tab">Gemini ↗</button>
        <button type="button" class="af-sel-chip" data-search="chatgpt" title="Open ChatGPT in a new tab">ChatGPT ↗</button>
        <button type="button" class="af-sel-chip af-sel-action" data-action="remind" title="Add as a reminder">Remind</button>
        <button type="button" class="af-sel-chip af-sel-action" data-action="brain" title="Teach your AI's memory">Brain</button>
        <button type="button" class="af-sel-chip" data-copypage="1" title="Copy all the readable text on this page — works where the site blocks copying">Copy page text</button>
        <button type="button" class="af-sel-chip" data-open="1" title="Open in the side panel — roomier for code or long text">Open in panel ↗</button>
      </div>
      <div class="af-resize" title="Drag to resize"></div>
    `;
    getAfRoot().appendChild(bar);
    positionBar(rect); // measure real size, then place viewport-aware
    requestAnimationFrame(() => bar.classList.add("af-in"));
    wireBarChrome(bar); // drag handle, minimize, resize
    restoreBarState(bar); // bring back last size / position / minimized / answer

    const input = bar.querySelector(".af-sel-input");
    enablePasteBypass(input);
    input.value = prefill || savedQuestion || "";
    if (autoFocus) input.focus();
    // Remember what's typed so reopening restores it.
    input.addEventListener("input", () => {
      savedQuestion = input.value;
      persistBarState();
    });

    // One smart "ask": typed question if there is one, else a merged
    // explain+summarize default (this replaces the separate Explain/Summarize
    // chips — one better inline answer, like a lens for text).
    const smartAsk = () => ask(input.value.trim() || ANSWER_PROMPT);
    bar.querySelector(".af-sel-send").onclick = smartAsk;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        smartAsk();
      }
    });

    const answerChip = bar.querySelector("[data-answer]");
    if (answerChip) answerChip.onclick = () => ask(ANSWER_PROMPT);

    bar.querySelectorAll(".af-sel-chip[data-q]").forEach((c) => {
      c.onclick = () => ask(c.dataset.q);
    });
    const webChip = bar.querySelector(".af-sel-chip[data-web]");
    if (webChip) webChip.onclick = () => searchWeb();
    bar.querySelectorAll(".af-sel-action[data-action]").forEach((c) => {
      c.onclick = () => quickAction(c.dataset.action);
    });
    bar.querySelectorAll(".af-sel-chip[data-search]").forEach((c) => {
      c.onclick = () => {
        const q = encodeURIComponent(lastSelectionText.slice(0, 500));
        // Google: web search. Gemini: Google "AI Mode" (udm=50), Gemini-powered
        // and prefillable. ChatGPT: chatgpt.com/?q= prefills the prompt. These
        // open in a new tab — their result pages can't be embedded inline
        // (X-Frame-Options / CSP block iframing), so external is the only path.
        const url =
          c.dataset.search === "gemini"
            ? `https://www.google.com/search?udm=50&q=${q}`
            : c.dataset.search === "chatgpt"
            ? `https://chatgpt.com/?q=${q}`
            : `https://www.google.com/search?q=${q}`;
        window.open(url, "_blank", "noopener");
        removeBar();
      };
    });

    // "More" expander — reveals the secondary actions and re-positions since
    // the bar's height changed.
    const moreBtn = bar.querySelector('[data-more]');
    const moreSection = bar.querySelector(".af-sel-more");
    if (moreBtn && moreSection) {
      moreBtn.onclick = () => {
        const show = moreSection.hasAttribute("hidden");
        if (show) moreSection.removeAttribute("hidden");
        else moreSection.setAttribute("hidden", "");
        moreBtn.textContent = show ? "Less" : "More";
        positionBar(rect);
      };
    }

    const copyIc = bar.querySelector(".af-copy-ic");
    if (copyIc) {
      copyIc.onclick = async () => {
        const ok = await forceCopy(lastSelectionText);
        copyIc.innerHTML = ok ? SVG_CHECK : SVG_COPY;
        copyIc.classList.toggle("af-ok", ok);
        setTimeout(() => {
          if (copyIc) {
            copyIc.innerHTML = SVG_COPY;
            copyIc.classList.remove("af-ok");
          }
        }, 1400);
      };
    }
    const copyPageChip = bar.querySelector(".af-sel-chip[data-copypage]");
    if (copyPageChip) {
      copyPageChip.onclick = async () => {
        const text = pageText();
        const ok = text ? await forceCopy(text) : false;
        copyPageChip.textContent = ok ? `Copied ${text.length.toLocaleString()} chars` : "Copy failed";
        setTimeout(() => (copyPageChip.textContent = "Copy page text"), 1800);
      };
    }
    const openChip = bar.querySelector(".af-sel-chip[data-open]");
    if (openChip) {
      openChip.onclick = () => {
        try {
          chrome.storage.local.set({ af_pending_selection: lastSelectionText.slice(0, 6000) });
          chrome.runtime.sendMessage({ type: "AF_OPEN_PANEL" }).catch(() => {});
        } catch {
          /* extension context not ready — nothing to do */
        }
        removeBar();
      };
    }
    bar.addEventListener("mousedown", (e) => {
      // Clicking anywhere (Explain/Summarize/send) normally collapses the
      // page's native text-selection highlight, since the click target is
      // outside the original selected range — preventDefault stops that, so
      // the highlight stays visible the whole time the bar is open. The
      // input still needs its normal mousedown behavior so it can be clicked
      // into and typed in.
      if (e.target !== input) e.preventDefault();
      e.stopPropagation();
    });
  }

  // All three listen on `window` in the CAPTURE phase, not bubble-phase on
  // `document`. Capture flows outermost-inward, so these run before any
  // handler the page attached to a nested element — and app-like sites
  // (ChatGPT, Gmail, most React apps with their own selection or context-menu
  // logic) routinely call stopPropagation() on mouseup, which silently
  // prevented a bubble-phase document listener from ever firing. Plain
  // content pages don't intercept, which is why this only broke on the sites
  // people most want the feature on.
  window.addEventListener(
    "mouseup",
    (e) => {
      if ((bar || pill) && e.target === afHost) return;
      // Deferred a tick: in capture phase the browser may not have finalized
      // the Selection yet, and this also lets the page's own handlers run
      // first so we read the selection they leave behind, not an interim one.
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        if (text.length > 2 && text.length < 6000 && sel.rangeCount > 0) {
          lastSelectionText = text;
          anchorRange = sel.getRangeAt(0);
          drawHighlightOverlay(anchorRange); // survives page clearing its selection
          showPill(anchorRange.getBoundingClientRect()); // tiny trigger, not the full bar
        } else if (!text) {
          if (Date.now() - lastAltGrabAt < 600) return; // Alt+click just opened the bar
          closeSelUI();
        }
      }, 0);
    },
    true
  );
  window.addEventListener(
    "mousedown",
    (e) => {
      if ((bar || pill) && e.target !== afHost) closeSelUI();
    },
    true
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        closeSelUI();
        closeCapture();
      }
    },
    true
  );
  // On scroll, FOLLOW the selection instead of dismissing — so you can scroll
  // and read while the pill/bar stays glued to the text it refers to. Only
  // when the selection scrolls fully out of view do we close. rAF-throttled so
  // fast scrolling stays smooth. Capture phase catches nested scroll
  // containers (how most app-like sites scroll).
  let scrollRaf = 0;
  window.addEventListener(
    "scroll",
    () => {
      if (!pill && !bar) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        const r = anchorRect();
        if (!r || r.bottom < 0 || r.top > window.innerHeight) {
          closeSelUI();
          return;
        }
        drawHighlightOverlay(anchorRange); // keep the highlight glued to the text
        if (pill) {
          const m = 8, w = pill.offsetWidth || 72, h = pill.offsetHeight || 30;
          let left = Math.max(m, Math.min(r.left, window.innerWidth - w - m));
          let top = r.bottom + m;
          if (top + h > window.innerHeight - m) {
            const a = r.top - h - m;
            top = a >= m ? a : r.bottom + m;
          }
          pill.style.left = `${left}px`;
          pill.style.top = `${top}px`;
        }
        if (bar) positionBar(r);
      });
    },
    true
  );

  // Right-click → "Ask AgentFury about…" (background.js relays the selection here).
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "AF_OPEN_SELECTION") {
        lastSelectionText = msg.text || lastSelectionText;
        let rect = { top: window.innerHeight / 2, bottom: window.innerHeight / 2, left: window.innerWidth / 2 };
        anchorRange = null;
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          try {
            anchorRange = sel.getRangeAt(0);
            rect = anchorRange.getBoundingClientRect();
            drawHighlightOverlay(anchorRange);
          } catch {
            /* keep fallback */
          }
        }
        // Right-click is explicit intent → open the full bar directly (not the
        // pill), focused, so they can type straight away.
        showBar(rect, "", true);
      }
      // Copy, from the shortcut or the right-click menu — the route that still
      // works when the page has taken the normal ones away.
      if (msg.type === "AF_FORCE_COPY") forceCopyContext(msg.text || "");
      if (msg.type === "AF_COPY_PAGE") {
        const text = pageText();
        forceCopy(text).then((ok) =>
          toast(ok ? `Copied ${text.length.toLocaleString()} characters` : "Copy was blocked", !ok)
        );
      }
      // Snip & read: the background captured the tab and handed us the shot.
      if (msg.type === "AF_SNIP" && msg.shot) startSnip(msg.shot);
      // Right-click → "Read text in this image": the reliable route when the
      // hover badge is awkward to reach (tiny grid cells, overlays, a picture
      // that scrolls under the cursor).
      if (msg.type === "AF_IMAGE_OCR" && msg.src) {
        const src = String(msg.src);
        // Prefer the real element if it's on this page — its pixels are
        // readable even when the URL needs a login the server doesn't have.
        let el = null;
        try {
          el = document.querySelector(`img[src="${CSS.escape(src)}"]`);
        } catch {}
        openImageCard(
          el ||
            (src.startsWith("data:")
              ? { dataUrl: src, label: "Image", rect: null }
              : { url: src, label: "Image", rect: null })
        );
        imgAction("ocr", "");
      }
    });
  } catch {
    /* extension context not ready — WARM_UP above will have already no-op'd */
  }

  // ============================ Document assistant =========================
  // When a PDF/doc is open directly in the tab, a small card offers to parse,
  // read, search, summarize or explain it — using the SAME backend extractor as
  // the popup's file upload (PDF/Word/Excel/CSV/text). Files opened in the
  // browser can't be highlighted the normal way, so the selection bar can't help
  // there; this fills that gap. Dismissible, remembered per-URL for the session.
  let docCard = null;
  let docText = null; // cached extracted text for this doc
  let docMeta = null; // { name, isPdf }

  function detectDoc() {
    try {
      const path = (location.pathname || "").toLowerCase();
      const ct = (document.contentType || "").toLowerCase();
      const isPdf =
        ct.includes("application/pdf") ||
        path.endsWith(".pdf") ||
        !!document.querySelector('embed[type="application/pdf"]');
      const isDoc = /\.(docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods)$/i.test(path);
      if (!isPdf && !isDoc) return null;
      let name = "document";
      try {
        name = decodeURIComponent((location.pathname.split("/").pop() || "").split("?")[0]) || "document";
      } catch {}
      if (!/\.\w{2,5}$/.test(name)) name += isPdf ? ".pdf" : "";
      return { name, isPdf };
    } catch {
      return null;
    }
  }

  function removeDocCard() {
    if (docCard) {
      docCard.remove();
      docCard = null;
    }
  }

  function setDocStatus(el, text, isErr, busy) {
    if (!el) return;
    el.className = "af-doc-status" + (isErr ? " err" : "");
    el.innerHTML = busy ? `<span class="af-doc-spin"></span>${escapeHtml(text)}` : escapeHtml(text || "");
  }

  function downloadText(name, text) {
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 1000);
    } catch {}
  }

  // Fetch the document's own bytes and run them through the backend extractor.
  async function ensureDocText(statusEl) {
    if (docText != null) return docText;
    setDocStatus(statusEl, "Reading the document…", false, true);
    let buf;
    try {
      const res = await fetch(location.href, { credentials: "include" });
      if (!res.ok) throw new Error("http " + res.status);
      buf = await res.arrayBuffer();
    } catch {
      setDocStatus(statusEl, "Couldn't read this file from the page.", true);
      return null;
    }
    if (buf.byteLength > 15 * 1024 * 1024) {
      setDocStatus(statusEl, "This file is over 15 MB — too large to parse.", true);
      return null;
    }
    const r = await send({ type: "UPLOAD_EXTRACT", name: docMeta.name, bytes: buf }, 60000);
    if (!r || !r.ok) {
      setDocStatus(
        statusEl,
        r && r.status === 401 ? "Sign in via the AgentFury icon first." : "Couldn't parse this document.",
        true
      );
      return null;
    }
    docText = (r.data && r.data.text) || "";
    setDocStatus(statusEl, "", false);
    return docText;
  }

  // Render the extracted text, highlighting matches of `query` and scrolling to
  // the first one — this is the in-document search.
  function renderDocText(body, text, query) {
    body.innerHTML = "";
    const div = document.createElement("div");
    div.className = "af-doc-text";
    const q = (query || "").trim().toLowerCase();
    if (q.length >= 2) {
      const parts = [];
      const lower = text.toLowerCase();
      let i = 0, idx;
      while ((idx = lower.indexOf(q, i)) !== -1) {
        parts.push(escapeHtml(text.slice(i, idx)));
        parts.push('<mark class="af-doc-hit">' + escapeHtml(text.slice(idx, idx + q.length)) + "</mark>");
        i = idx + q.length;
      }
      parts.push(escapeHtml(text.slice(i)));
      div.innerHTML = parts.join("");
    } else {
      div.textContent = text;
    }
    body.appendChild(div);
    const first = body.querySelector(".af-doc-hit");
    if (first) first.scrollIntoView({ block: "center" });
  }

  function ensureDocTools(card, text) {
    const old = card.querySelector(".af-doc-tools");
    if (old) old.remove();
    const tools = document.createElement("div");
    tools.className = "af-doc-tools";

    const copy = document.createElement("button");
    copy.className = "af-doc-tool";
    copy.textContent = "Copy all";
    copy.onclick = async () => {
      const ok = await forceCopy(text);
      copy.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => (copy.textContent = "Copy all"), 1400);
    };

    const dl = document.createElement("button");
    dl.className = "af-doc-tool";
    dl.textContent = "Download .txt";
    dl.onclick = () =>
      downloadText(((docMeta && docMeta.name) || "document").replace(/\.\w+$/, "") + ".txt", text);

    const open = document.createElement("button");
    open.className = "af-doc-tool";
    open.textContent = "Open in AgentFury ↗";
    open.onclick = () => {
      try {
        chrome.storage.local.set({ af_pending_selection: text.slice(0, 6000) });
        chrome.runtime.sendMessage({ type: "AF_OPEN_PANEL" }).catch(() => {});
      } catch {}
    };

    tools.appendChild(copy);
    tools.appendChild(dl);
    tools.appendChild(open);
    card.appendChild(tools);
  }

  async function docAction(kind, card) {
    const status = card.querySelector(".af-doc-status");
    const body = card.querySelector(".af-doc-body");
    const search = card.querySelector(".af-doc-search");
    const text = await ensureDocText(status);
    if (text == null) return;
    if (!text.trim()) {
      setDocStatus(status, "No readable text found — it may be a scanned image.", true);
      return;
    }

    if (kind === "parse") {
      search.hidden = false;
      renderDocText(body, text, search.value);
      ensureDocTools(card, text);
      setDocStatus(status, `${text.length.toLocaleString()} characters · type above to search`, false);
      return;
    }

    search.hidden = true;
    const questions = {
      summarize: "Summarize this document with the key points as a short bulleted list.",
      explain: "Explain what this document is about in simple, clear terms.",
    };
    body.innerHTML = `<div class="af-doc-status"><span class="af-doc-spin"></span>Thinking…</div>`;
    const r = await send(
      {
        type: "API_CALL",
        path: "/write/answer",
        method: "POST",
        body: { text: text.slice(0, 6000), question: questions[kind] || "Summarize this." },
      },
      45000
    );
    if (!r || !r.ok) {
      body.innerHTML = "";
      setDocStatus(status, "Couldn't generate — try again.", true);
      return;
    }
    setDocStatus(status, "", false);
    const answer = (r.data && r.data.answer) || "No answer.";
    renderRich(body, answer);
    ensureDocTools(card, answer);
  }

  function showDocCard(meta) {
    if (docCard || privacyMode) return;
    docMeta = meta;
    docText = null;
    docCard = document.createElement("div");
    docCard.className = "af-doc-card";
    docCard.innerHTML = `
      <div class="af-doc-head">
        <span class="af-doc-ic">📄</span>
        <div class="af-doc-titles">
          <div class="af-doc-title">Ask AgentFury about this</div>
          <div class="af-doc-name">${escapeHtml(meta.name)}</div>
        </div>
        <button type="button" class="af-doc-x" title="Dismiss">✕</button>
      </div>
      <div class="af-doc-actions">
        <button type="button" class="af-doc-btn primary" data-doc="parse">Parse &amp; read</button>
        <button type="button" class="af-doc-btn" data-doc="summarize">Summarize</button>
        <button type="button" class="af-doc-btn" data-doc="explain">Explain</button>
      </div>
      <input type="text" class="af-doc-search" placeholder="Search in document…" hidden />
      <div class="af-doc-status"></div>
      <div class="af-doc-body"></div>
    `;
    getAfRoot().appendChild(docCard);
    requestAnimationFrame(() => docCard.classList.add("af-in"));

    docCard.querySelector(".af-doc-x").onclick = () => {
      try { sessionStorage.setItem("af_doc_dismissed_" + location.href, "1"); } catch {}
      removeDocCard();
    };
    docCard.querySelectorAll("[data-doc]").forEach((b) => {
      b.onclick = () => docAction(b.dataset.doc, docCard);
    });
    const search = docCard.querySelector(".af-doc-search");
    enablePasteBypass(search);
    search.addEventListener("input", () => {
      if (docText != null) renderDocText(docCard.querySelector(".af-doc-body"), docText, search.value);
    });
    docCard.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  function initDocAssistant() {
    if (privacyMode || docCard || !IS_TOP) return;
    const meta = detectDoc();
    if (!meta) return;
    try {
      if (sessionStorage.getItem("af_doc_dismissed_" + location.href)) return;
    } catch {}
    // Small delay so the browser's PDF viewer settles first.
    setTimeout(() => {
      if (!docCard && !privacyMode) showDocCard(meta);
    }, 900);
  }

  // ======================================================================
  //  Shared bits for the panels below (image card, edit menu)
  // ======================================================================

  function panelClass(extra) {
    return "af-panel " + extra + (pageIsLight() ? " af-light" : "");
  }

  function setPanelStatus(el, text, isErr, busy) {
    if (!el) return;
    el.className = "af-status" + (isErr ? " err" : "");
    el.innerHTML = busy
      ? `<span class="af-spin"></span>${escapeHtml(text)}`
      : escapeHtml(text || "");
  }

  // Place a fixed-position panel next to something on the page: below it when
  // there's room, flipped above when there isn't, always clamped inside the
  // viewport. Same rules as positionBar(), minus the drag state.
  function placePanel(panel, rect) {
    if (!panel) return;
    const m = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = panel.offsetWidth || 320;
    const h = panel.offsetHeight || 200;
    const left = Math.max(m, Math.min(rect.left, vw - w - m));
    let top = rect.bottom + m;
    if (top + h > vh - m) {
      const above = rect.top - h - m;
      // Below doesn't fit: flip above if there's room, else pin it to the
      // bottom edge — and if it is taller than the whole viewport (a long
      // OCR result), pin it to the TOP instead, so the head and the action
      // chips stay reachable and the panel scrolls internally (max-height in
      // CSS). Pinning a too-tall panel to the bottom is what pushed the
      // buttons off the screen.
      top = above >= m ? above : h > vh - 2 * m ? m : Math.max(m, vh - h - m);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(m, top)}px`;
  }

  // Panels are placed the instant they're created, but they keep GROWING
  // afterwards: the thumbnail finishes loading, an answer arrives, an error
  // line appears. Each of those can push the bottom of the panel past the
  // viewport it was measured against. Re-place it whenever its own box
  // changes size — placePanel only moves it, so this can't loop.
  function keepOnScreen(panel, anchorEl) {
    try {
      const ro = new ResizeObserver(() => {
        if (!panel.isConnected) {
          ro.disconnect();
          return;
        }
        const rect =
          anchorEl && anchorEl.isConnected
            ? anchorEl.getBoundingClientRect()
            : panel.getBoundingClientRect();
        placePanel(panel, rect);
      });
      ro.observe(panel);
    } catch {
      /* no ResizeObserver — the explicit placePanel calls still run */
    }
  }

  // Small confirmation for actions with no visible UI of their own (copying
  // from a keyboard shortcut or the right-click menu).
  let toastEl = null;
  let toastTimer = 0;
  function toast(message, isErr) {
    if (privacyMode) return;
    if (toastEl) toastEl.remove();
    toastEl = document.createElement("div");
    toastEl.className = "af-toast" + (isErr ? " af-err" : "");
    toastEl.textContent = message;
    getAfRoot().appendChild(toastEl);
    requestAnimationFrame(() => toastEl && toastEl.classList.add("af-in"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
    }, 1800);
  }

  // Everything readable on the page, cleaned up — for "copy the whole thing"
  // on sites that hand it to you a paragraph at a time.
  function pageText() {
    const main =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.body;
    const raw = (main && (main.innerText || main.textContent)) || "";
    return raw
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 100000);
  }

  // Copy whatever the user means right now: an explicit string, else the
  // selection, else the block under the pointer. That last fallback is what
  // makes the shortcut work on a page where nothing can be selected at all.
  async function forceCopyContext(explicit) {
    let text = (explicit || "").trim();
    if (!text) {
      try {
        text = String(window.getSelection() || "").trim();
      } catch {}
    }
    if (!text) text = lastSelectionText;
    if (!text && imgPointer.x >= 0) {
      try {
        const under = document.elementFromPoint(imgPointer.x, imgPointer.y);
        const grab = under && blockTextFrom(under);
        if (grab) text = grab.text;
      } catch {}
    }
    if (!text) {
      toast("Nothing to copy here", true);
      return;
    }
    const ok = await forceCopy(text);
    toast(ok ? `Copied ${text.length.toLocaleString()} characters` : "Copy was blocked — try again", !ok);
  }

  function mkTool(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "af-tool";
    b.textContent = label;
    b.onclick = () => onClick(b);
    return b;
  }

  // ======================================================================
  //  Image AI — OCR, explain, translate, solve, ask (the badge on images)
  // ======================================================================
  // Text ON a page can be selected (and where a site blocks that, un-blocked
  // above). Text baked INTO an image can't be, by anyone: a screenshot of a
  // slide, a scanned page, a chart, a photo of a homework question, a diagram.
  // Hover any image big enough to be content and a small AF badge appears on
  // its top-left corner; clicking it opens a card that reads the image with a
  // vision model — pull the text out (OCR), explain what it shows, translate
  // it, solve the question in it, or answer anything you type about it. The
  // extracted text then flows into everything else: copy it, save it as a
  // note, or hand it to the selection bar to ask follow-ups.
  //
  // Getting the PIXELS is the hard part, and it needs three paths because no
  // single one works everywhere:
  //   1. canvas readback — instant, and the only way to read a <canvas> or a
  //      blob: URL. A cross-origin image without CORS headers "taints" the
  //      canvas, so toDataURL throws; that's what the next path is for.
  //   2. fetch the bytes in the page's own context — works whenever the host
  //      sends Access-Control-Allow-Origin (most CDNs do) and carries the
  //      page's cookies, so login-gated images still work. What comes back is
  //      a same-origin blob, so it can then go through a canvas to be
  //      downscaled without tainting anything.
  //   3. hand the URL to the backend and let it fetch server-side — the last
  //      resort for a public image the page itself won't release.

  const MIN_IMG_SIZE = 110; // below this it's an icon/avatar/spacer, not content
  // 1000px is where the two curves cross: below it small text starts being
  // guessed at, above it the vision model's own time climbs steeply (measured
  // on the same picture: 0.6s at ~320px, 2.8s at 1000px, 10.9s at 1000px PNG).
  // Never upscale - enlarging a thumbnail adds no detail, just tokens.
  const MAX_IMG_EDGE = 1000;

  let imageAiInit = false;
  let imgBadge = null;
  let imgBadgeTarget = null;
  let imgCard = null;
  let imgCardTarget = null; // the <img>/<canvas> on the page, when there is one
  let imgCardData = null;   // or an ad-hoc image: a screen snip / a URL from the right-click menu
  let imgHideTimer = 0;
  let imgHoverThrottle = 0;
  let imgPayloadPromise = null; // pixels, fetched while the card is being read

  // Lazy-loading and responsive-image attributes, in the order sites tend to
  // put the biggest version in.
  const HI_RES_ATTRS = [
    "data-zoom-image", "data-large_image", "data-hi-res-src", "data-full-src",
    "data-original", "data-src-large", "data-src", "data-lazy-src", "data-image",
  ];

  // The single biggest accuracy lever in the whole image feature: what is
  // ON SCREEN is often a thumbnail. A search-results grid renders a ~250px
  // preview, and OCR of a 250px stylised quote is where the model starts
  // guessing (and then repeating itself). The full-size original is almost
  // always reachable without any extra request:
  //   * srcset carries every size the page has, with its width descriptor;
  //   * lazy-loaders park the real URL in a data- attribute;
  //   * an image search links to the original, with the URL sitting right
  //     there in the anchor's imgurl= parameter.
  function bestImageUrl(el) {
    if (!el || !el.tagName || el.tagName.toUpperCase() !== "IMG") return "";
    let best = "";
    let bestW = 0;

    try {
      const srcset = el.getAttribute("srcset") || el.getAttribute("data-srcset") || "";
      srcset.split(",").forEach((part) => {
        const bits = part.trim().split(/\s+/);
        if (!bits[0]) return;
        const w = /(\d+)w$/.test(bits[1] || "") ? parseInt(bits[1], 10) : 0;
        if (w >= bestW) {
          bestW = w;
          best = bits[0];
        }
      });
    } catch {}

    if (!best) {
      for (const attr of HI_RES_ATTRS) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v && /^(https?:|data:|\/\/|\/)/i.test(v)) {
          best = v;
          break;
        }
      }
    }

    // Image-search results: the anchor around the thumbnail carries the
    // original's URL.
    if (!best) {
      try {
        const a = el.closest("a[href*='imgurl=']");
        if (a) {
          const u = new URL(a.href, location.href).searchParams.get("imgurl");
          if (u && /^https?:/i.test(u)) best = u;
        }
      } catch {}
    }

    try {
      return best ? new URL(best, location.href).href : "";
    } catch {
      return "";
    }
  }

  function elImageSrc(el) {
    if (!el || !el.tagName) return "";
    const tag = el.tagName.toUpperCase();
    if (tag === "IMG") return el.currentSrc || el.src || "";
    if (tag === "CANVAS") return "canvas:"; // pixels come from the element itself
    try {
      const bg = getComputedStyle(el).backgroundImage || "";
      const m = bg.match(/url\((?:"|')?([^"')]+)(?:"|')?\)/);
      return m ? m[1] : "";
    } catch {
      return "";
    }
  }

  // Is this element an image worth offering AI on?
  function imageCandidate(el) {
    if (!el || el === afHost || !el.getBoundingClientRect) return null;
    const tag = (el.tagName || "").toUpperCase();
    let r;
    try {
      r = el.getBoundingClientRect();
    } catch {
      return null;
    }
    if (r.width < MIN_IMG_SIZE || r.height < MIN_IMG_SIZE) return null;
    if (tag === "IMG" || tag === "CANVAS") return el;
    // A CSS background-image — how a lot of sites ship "protected" pictures,
    // precisely so there's no <img> to right-click. Held to a larger minimum
    // so decorative hero/pattern backgrounds don't sprout badges.
    if (elImageSrc(el) && r.width >= 160 && r.height >= 160) return el;
    return null;
  }

  function removeImgBadge() {
    clearTimeout(imgHideTimer);
    if (imgBadge) {
      imgBadge.remove();
      imgBadge = null;
    }
    imgBadgeTarget = null;
  }

  function scheduleBadgeHide() {
    if (!imgBadge) return;
    clearTimeout(imgHideTimer);
    imgHideTimer = setTimeout(removeImgBadge, 320);
  }

  function positionImgBadge() {
    if (!imgBadge || !imgBadgeTarget) return;
    if (!imgBadgeTarget.isConnected) {
      removeImgBadge();
      return;
    }
    const r = imgBadgeTarget.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (r.bottom < 8 || r.top > vh - 8 || r.right < 8 || r.left > vw - 8 || r.width < MIN_IMG_SIZE) {
      removeImgBadge();
      return;
    }
    const w = imgBadge.offsetWidth || 58;
    const h = imgBadge.offsetHeight || 26;
    const left = Math.max(6, Math.min(r.left + 8, vw - w - 6));
    // Keep it inside the image even when only its bottom half is on screen.
    let top = Math.max(6, Math.min(r.top + 8, vh - h - 6));
    top = Math.min(top, Math.max(6, r.bottom - h - 4));
    imgBadge.style.left = `${left}px`;
    imgBadge.style.top = `${top}px`;
  }

  function showImgBadge(el) {
    if (imgBadge && imgBadgeTarget === el) {
      clearTimeout(imgHideTimer); // same image — just keep it alive
      return;
    }
    removeImgBadge();
    imgBadgeTarget = el;
    imgBadge = document.createElement("div");
    imgBadge.className = "af-img-badge";
    imgBadge.title = "Read this image with AgentFury — extract text, explain, or ask";
    imgBadge.innerHTML = `<span class="af-ib-logo af-logo"></span><span>AI</span>`;
    getAfRoot().appendChild(imgBadge);
    positionImgBadge();
    requestAnimationFrame(() => imgBadge && imgBadge.classList.add("af-in"));
    imgBadge.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    imgBadge.addEventListener("mouseenter", () => clearTimeout(imgHideTimer));
    imgBadge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openImageCard(imgBadgeTarget);
    });
  }

  // Draw whatever we can already read into a canvas, scaled down, and hand
  // back a JPEG data URL.
  function downscaleToDataUrl(source, natW, natH) {
    const scale = Math.min(1, MAX_IMG_EDGE / Math.max(natW, natH));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(natW * scale));
    c.height = Math.max(1, Math.round(natH * scale));
    const ctx = c.getContext("2d");
    // JPEG has no alpha channel, so paint white first — otherwise a
    // transparent PNG (very common for screenshots of text) comes out as
    // black-on-black and the model reads nothing.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    // q90 rather than q85: JPEG artefacts land hardest on thin glyph edges,
    // which is exactly what OCR reads.
    return c.toDataURL("image/jpeg", 0.9);
  }

  function readPixels(el) {
    try {
      const tag = (el.tagName || "").toUpperCase();
      if (tag === "CANVAS") return downscaleToDataUrl(el, el.width, el.height);
      if (tag === "IMG" && el.complete && el.naturalWidth) {
        return downscaleToDataUrl(el, el.naturalWidth, el.naturalHeight);
      }
    } catch {
      /* tainted canvas (cross-origin, no CORS) — the fetch path handles it */
    }
    return "";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => resolve("");
      fr.readAsDataURL(blob);
    });
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function imagePayload(el) {
    const shown = elImageSrc(el);
    const full = bestImageUrl(el);
    // Prefer the full-size original over the thumbnail on screen, but only
    // when it really is a different (bigger) file.
    const src = full && full !== shown ? full : shown;

    // 1. Straight from pixels the browser has already decoded - but not when
    //    a larger original exists, since those decoded pixels ARE the
    //    thumbnail.
    if (!full || full === shown) {
      const direct = readPixels(el);
      if (direct) return { image_b64: direct };
    }
    if (!src || src === "canvas:") return null;
    if (src.startsWith("data:")) return { image_b64: src };
    // 2. Fetch the bytes ourselves, cookies included.
    try {
      const res = await fetch(src, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size && blob.size < 20 * 1024 * 1024) {
          const raw = await blobToDataUrl(blob);
          const img = raw ? await loadImage(raw) : null;
          if (img && img.naturalWidth) {
            const shrunk = downscaleToDataUrl(img, img.naturalWidth, img.naturalHeight);
            if (shrunk) return { image_b64: shrunk };
          }
          // Couldn't decode it (an SVG or an odd format) — send it as-is if
          // it fits under the backend's 4 MB ceiling.
          if (raw && raw.length < 5_200_000) return { image_b64: raw };
        }
      }
    } catch {
      /* cross-origin with no CORS header — fall through to the server */
    }
    // 2b. The full-size fetch failed (hotlink protection, no CORS): the
    //     thumbnail's own pixels are still better than nothing.
    if (src !== shown) {
      const direct = readPixels(el);
      if (direct) return { image_b64: direct };
    }
    // 3. Let the backend fetch it (public http(s) URLs only).
    if (/^https?:/i.test(src)) return { image_url: src.slice(0, 2000) };
    if (/^https?:/i.test(shown)) return { image_url: shown.slice(0, 2000) };
    return null;
  }

  function imgLabel(el, src) {
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "CANVAS") return "Canvas element";
    const alt = (el.getAttribute && el.getAttribute("alt")) || "";
    if (alt.trim()) return alt.trim().slice(0, 80);
    try {
      const u = new URL(src, location.href);
      const name = decodeURIComponent(u.pathname.split("/").pop() || "");
      return name || u.hostname;
    } catch {
      return "Image on this page";
    }
  }

  function removeImgCard() {
    if (imgCard) {
      imgCard.remove();
      imgCard = null;
    }
    imgCardTarget = null;
    imgCardData = null;
    imgPayloadPromise = null;
  }

  // Where to anchor the card: the image itself when it's a real element,
  // otherwise wherever the snip was taken (or a sane spot near the top).
  function imgAnchorRect() {
    if (imgCardTarget && imgCardTarget.isConnected) return imgCardTarget.getBoundingClientRect();
    if (imgCardData && imgCardData.rect) return imgCardData.rect;
    return { top: 90, bottom: 90, left: 40, right: 40, width: 0, height: 0 };
  }

  function ensureImgTools(text) {
    if (!imgCard) return;
    const old = imgCard.querySelector(".af-tools");
    if (old) old.remove();
    const tools = document.createElement("div");
    tools.className = "af-tools";

    tools.appendChild(
      mkTool("Copy text", async (b) => {
        const ok = await forceCopy(text);
        b.textContent = ok ? "Copied" : "Copy failed";
        setTimeout(() => (b.textContent = "Copy text"), 1400);
      })
    );
    // The picture itself, for pasting into a doc or a chat — the other thing a
    // blocked right-click menu takes away.
    tools.appendChild(
      mkTool("Copy image", async (b) => {
        b.textContent = "Copying…";
        let ok = false;
        try {
          const payload = imgCardData
            ? imgCardData.dataUrl || imgCardData.url
            : imgCardTarget
            ? readPixels(imgCardTarget) || elImageSrc(imgCardTarget)
            : "";
          if (payload) {
            const blob = await (await fetch(payload)).blob();
            // The clipboard only accepts PNG, so anything else goes through a
            // canvas first.
            const png =
              blob.type === "image/png"
                ? blob
                : await new Promise((resolve) => {
                    const url = URL.createObjectURL(blob);
                    loadImage(url).then((im) => {
                      if (!im) return resolve(null);
                      const c = document.createElement("canvas");
                      c.width = im.naturalWidth;
                      c.height = im.naturalHeight;
                      c.getContext("2d").drawImage(im, 0, 0);
                      c.toBlob(resolve, "image/png");
                    });
                  });
            if (png) {
              await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
              ok = true;
            }
          }
        } catch {}
        b.textContent = ok ? "Copied ✓" : "Couldn't copy";
        setTimeout(() => (b.textContent = "Copy image"), 1600);
      })
    );
    tools.appendChild(
      mkTool("Save note", async (b) => {
        b.textContent = "Saving…";
        const r = await send({
          type: "API_CALL",
          path: "/notes",
          method: "POST",
          body: { title: (document.title || "Image").slice(0, 200), content: text.slice(0, 4000) },
        });
        b.textContent = r && r.ok ? "Saved ✓" : "Failed";
        setTimeout(() => (b.textContent = "Save note"), 1600);
      })
    );
    // The bridge back to the text tools: whatever the image said becomes the
    // selection, so Answer / Google / Summarize all work on it.
    tools.appendChild(
      mkTool("Ask AI about this ↗", () => {
        const el = imgCardTarget;
        const rect = imgAnchorRect();
        lastSelectionText = text.slice(0, 6000);
        // Anchor the bar to the IMAGE, so it follows it on scroll and the
        // highlight shows which picture the answer is about.
        anchorRange = null;
        try {
          if (el) {
            const r = document.createRange();
            r.selectNode(el);
            anchorRange = r;
          }
        } catch {}
        removeImgCard();
        showBar(rect, "", true);
      })
    );
    imgCard.appendChild(tools);
  }

  async function imgAction(mode, question) {
    if (!imgCard || (!imgCardTarget && !imgCardData)) return;
    const status = imgCard.querySelector(".af-status");
    const body = imgCard.querySelector(".af-body");
    const oldTools = imgCard.querySelector(".af-tools");
    if (oldTools) oldTools.remove();
    body.innerHTML = "";
    setPanelStatus(status, mode === "ocr" ? "Reading the text…" : "Looking at the image…", false, true);

    // An ad-hoc image already IS the pixels (or a plain URL the server can
    // fetch); only a real page element needs the three-way read.
    const payload = imgCardData
      ? imgCardData.dataUrl
        ? { image_b64: imgCardData.dataUrl }
        : { image_url: imgCardData.url }
      : await (imgPayloadPromise || imagePayload(imgCardTarget));
    if (!payload) {
      setPanelStatus(status, "Couldn't read this image — the page won't release it.", true);
      return;
    }
    const r = await send(
      {
        type: "API_CALL",
        path: "/write/image",
        method: "POST",
        body: { ...payload, mode, question: question || "" },
      },
      60000
    );
    if (!r || !r.ok) {
      setPanelStatus(status, friendlyError(r || {}), true);
      return;
    }
    const text = ((r.data && r.data.text) || "").trim() || "No result.";
    setPanelStatus(status, "", false);
    if (!imgCard) return; // closed while we were waiting
    renderRich(body, text);
    ensureImgTools(text);
    placePanel(imgCard, imgAnchorRect()); // it grew — keep it on screen
  }

  // `source` is either an element on the page, or an ad-hoc image:
  // { dataUrl | url, label, rect } — a screen snip, or the image behind a
  // right-click.
  function openImageCard(source) {
    if (!source || privacyMode || !imageAiEnabled) return;
    const el = source.nodeType === 1 ? source : null;
    const data = el ? null : source;
    removeImgBadge();
    removeImgCard();
    imgCardTarget = el;
    imgCardData = data;
    // Start reading the pixels NOW, while the user is still deciding which
    // button to press — fetching and re-encoding a full-size image takes
    // longer than the model call does, and none of it needs to be on the
    // clock once they click.
    imgPayloadPromise = el ? imagePayload(el).catch(() => null) : null;
    const src = el ? elImageSrc(el) : data.dataUrl || data.url || "";
    const httpSrc = /^https?:/i.test(src) ? src : "";

    imgCard = document.createElement("div");
    imgCard.className = panelClass("af-img-card");
    imgCard.innerHTML = `
      <div class="af-card-head">
        <span class="af-card-ic af-logo"></span>
        <div class="af-card-titles">
          <div class="af-card-title">Image AI</div>
          <div class="af-card-sub">${escapeHtml(el ? imgLabel(el, src) : data.label || "Image")}</div>
        </div>
        <button type="button" class="af-x" title="Close">✕</button>
      </div>
      <img class="af-img-thumb" alt="" hidden />
      <div class="af-row-wrap">
        <button type="button" class="af-chip primary" data-img="ocr" title="Pull every word out of the image">Extract text</button>
        <button type="button" class="af-chip" data-img="explain" title="What does this image show?">Explain</button>
        <button type="button" class="af-chip" data-img="solve" title="Answer the question in the image">Solve</button>
        <button type="button" class="af-chip" data-img="translate">Translate</button>
        <button type="button" class="af-chip" data-lens="1" title="Reverse image search on Google Lens"${httpSrc ? "" : " disabled"}>Search image ↗</button>
      </div>
      <div class="af-ask-row">
        <input type="text" class="af-ask-input" placeholder="Ask about this image…" />
        <button type="button" class="af-ask-go" title="Ask (Enter)">${SVG_SEND}</button>
      </div>
      <div class="af-status"></div>
      <div class="af-body"></div>
    `;
    getAfRoot().appendChild(imgCard);
    placePanel(imgCard, imgAnchorRect());
    keepOnScreen(imgCard, el);
    requestAnimationFrame(() => imgCard && imgCard.classList.add("af-in"));

    // A preview, so it's obvious WHICH image is being read on a busy page.
    const thumb = imgCard.querySelector(".af-img-thumb");
    const thumbSrc = el && src === "canvas:" ? readPixels(el) : src;
    if (thumbSrc) {
      thumb.src = thumbSrc;
      thumb.hidden = false;
      // The card was measured before the picture had loaded — once it has,
      // the card is ~110px taller, so place it again.
      thumb.onload = () => {
        if (imgCard) placePanel(imgCard, imgAnchorRect());
      };
      thumb.onerror = () => {
        thumb.hidden = true;
      };
    }

    imgCard.addEventListener("mousedown", (e) => e.stopPropagation());
    imgCard.querySelector(".af-x").onclick = () => removeImgCard();
    imgCard.querySelectorAll("[data-img]").forEach((b) => {
      b.onclick = () => imgAction(b.dataset.img, "");
    });

    const lens = imgCard.querySelector("[data-lens]");
    if (lens && httpSrc) {
      lens.onclick = () => {
        // Google Lens by URL — the same "search this image" the browser's own
        // context menu offers, which is exactly what a blocked right-click
        // takes away.
        const abs = new URL(httpSrc, location.href).href;
        window.open(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(abs)}`, "_blank", "noopener");
      };
    }

    const ask = imgCard.querySelector(".af-ask-input");
    const go = imgCard.querySelector(".af-ask-go");
    enablePasteBypass(ask);
    const runAsk = () => {
      const q = ask.value.trim();
      if (q) imgAction("ask", q);
    };
    go.onclick = runAsk;
    ask.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runAsk();
      }
    });
  }

  // Where the pointer is, in viewport coordinates. Kept fresh so a hit test
  // can run at ANY moment, not only when the browser happens to fire a
  // mouseover — see the trailing test below for why that matters.
  const imgPointer = { x: -1, y: -1 };
  let imgHitTimer = 0;

  // What image, if any, is under the cursor right now? Three sources, in
  // order of reliability:
  //  1. the event's composed path — which pierces open shadow DOM, where a
  //     plain e.target only ever reports the outer host element;
  //  2. a hit test through the whole stack at the cursor — this is what finds
  //     an image sitting UNDER a transparent overlay, the standard way
  //     galleries, stock sites and "protected" viewers hide theirs;
  //  3. the same hit test again inside any open shadow root at that point.
  function imageAt(x, y, path) {
    if (path) {
      for (let i = 0; i < Math.min(path.length, 4); i++) {
        const hit = imageCandidate(path[i]);
        if (hit) return hit;
      }
    }
    if (x < 0) return null;
    try {
      const stack = document.elementsFromPoint(x, y);
      for (let i = 0; i < Math.min(stack.length, 6); i++) {
        const hit = imageCandidate(stack[i]);
        if (hit) return hit;
        const sr = stack[i].shadowRoot;
        if (sr && sr.elementsFromPoint) {
          const inner = sr.elementsFromPoint(x, y);
          for (let j = 0; j < Math.min(inner.length, 4); j++) {
            const deep = imageCandidate(inner[j]);
            if (deep) return deep;
          }
        }
      }
    } catch {}
    return null;
  }

  function runImageHitTest(path) {
    if (!imageAiEnabled || privacyMode || isTinyFrame() || imgCard || snipLayer) return;
    const el = imageAt(imgPointer.x, imgPointer.y, path);
    if (el) {
      showImgBadge(el);
      return;
    }
    if (!imgBadge) return;
    // Only drop the badge once the pointer has really left its image. Moving
    // across an image's own child nodes fires a stream of mouseout events,
    // and hiding on those is what made the badge flicker and vanish while you
    // were still hovering it.
    let r = null;
    try {
      r = imgBadgeTarget && imgBadgeTarget.getBoundingClientRect();
    } catch {}
    const inside =
      r &&
      imgPointer.x >= r.left - 2 &&
      imgPointer.x <= r.right + 2 &&
      imgPointer.y >= r.top - 2 &&
      imgPointer.y <= r.bottom + 2;
    if (!inside) scheduleBadgeHide();
  }

  function onPointerActivity(e) {
    imgPointer.x = e.clientX;
    imgPointer.y = e.clientY;
    const now = Date.now();
    if (now - imgHoverThrottle >= 80) {
      imgHoverThrottle = now;
      if (imgHitTimer) {
        clearTimeout(imgHitTimer);
        imgHitTimer = 0;
      }
      // composedPath() allocates, so only build it on a test we actually run.
      runImageHitTest(e.composedPath ? e.composedPath() : null);
      return;
    }
    // Inside the throttle window. Schedule a TRAILING test instead of
    // dropping this one: if the pointer now STOPS — exactly what people do
    // when they want the badge — no further event ever arrives, and the badge
    // shows up "late" or never. That was the reported delay.
    if (!imgHitTimer) {
      imgHitTimer = setTimeout(() => {
        imgHitTimer = 0;
        imgHoverThrottle = Date.now();
        runImageHitTest(null); // re-derive from the pointer position alone
      }, 90);
    }
  }

  function initImageAI() {
    if (imageAiInit) return;
    imageAiInit = true;
    // mousemove is the primary driver, not mouseover: on grid layouts (Google
    // Images, stock sites) the pointer often enters a cell's overlay rather
    // than the image, so mouseover fires once for a wrapper and never again
    // while you sit on the picture itself.
    window.addEventListener("mousemove", onPointerActivity, true);
    window.addEventListener("mouseover", onPointerActivity, true);
  }

  // ======================================================================
  //  Auto-edit — AI inside any text box, no highlighting needed
  // ======================================================================
  // Fixing or rewriting what you already typed shouldn't require selecting it
  // first, and on most sites you can't invoke an assistant on a field at all.
  // Focus any text box — a comment field, a form, a support reply, a quiz
  // answer box, a rich-text editor — and a small AF badge appears in its
  // corner. One click gives Fix / Improve / Shorten / Formal / Friendly /
  // Answer plus a free-form "tell AI what to change", applied straight INTO
  // the field, with Undo. If there IS a selection inside the field only that
  // part is rewritten; otherwise the whole field is — which is the point: no
  // highlighting needed either way.

  // Only the input types people actually write prose in. email/url/tel/number
  // are deliberately absent: rewriting an address or a phone number is never
  // what anyone wants, and a badge on every login form is just noise.
  const EDIT_INPUT_TYPES = new Set(["text", "search", ""]);
  // Same idea, one level finer: a field that autofills a name, an address or a
  // one-time code is an identity field however it's typed.
  const NOT_PROSE = /user(name)?|email|phone|mobile|tel|otp|one-?time|code|zip|postal|address|card|cvv|search-?box/i;
  let autoEditInit = false;
  let editBadge = null;
  let editField = null;
  let editMenu = null;
  let editUndoText = null;
  // Live-suggestion state (see the proofing section below).
  const proofWatched = new WeakSet();
  let proofIssues = [];
  let proofField = null;
  let proofTimer = 0;
  let proofLastText = "";

  function editableTarget(node) {
    let el = node;
    if (!el || el === afHost || !el.tagName) return null;
    const tag = el.tagName.toUpperCase();
    if (tag === "TEXTAREA") {
      if (el.readOnly || el.disabled) return null;
    } else if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (!EDIT_INPUT_TYPES.has(type) || el.readOnly || el.disabled) return null;
    } else if (el.isContentEditable) {
      // Focus can land on an inner node; normalize to the editable root.
      el = el.closest('[contenteditable=""],[contenteditable="true"]') || el;
    } else {
      return null;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const hint = `${el.name || ""} ${el.id || ""} ${el.getAttribute("autocomplete") || ""}`;
      if (NOT_PROSE.test(hint)) return null;
    }
    let r;
    try {
      r = el.getBoundingClientRect();
    } catch {
      return null;
    }
    // Too small to be a place people write prose — a search box in a nav bar,
    // a spinner, a one-character cell.
    if (r.width < 140 || r.height < 22) return null;
    return el;
  }

  function fieldValue(el) {
    return (el.isContentEditable ? el.innerText : el.value) || "";
  }

  // The current selection INSIDE the field, if any — so "Fix" can touch just
  // the sentence you meant rather than the whole draft.
  function fieldSelection(el) {
    try {
      if (el.isContentEditable) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        // Only count it if the selection is actually INSIDE this field — the
        // user may have left something highlighted elsewhere on the page.
        const node = sel.anchorNode;
        const host = node && node.nodeType === 3 ? node.parentNode : node;
        if (!host || !el.contains(host)) return null;
        const t = sel.toString();
        return t.trim() ? { text: t } : null;
      }
      const s = el.selectionStart;
      const e = el.selectionEnd;
      if (s != null && e != null && e > s) return { text: el.value.slice(s, e), start: s, end: e };
    } catch {}
    return null;
  }

  function setFieldValue(el, text, range) {
    el.focus();
    if (el.isContentEditable) {
      if (!range) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      // insertText goes through the browser's editing pipeline, so the page's
      // own editor (React, Quill, ProseMirror, Gmail) sees a normal edit and
      // keeps it. Writing innerHTML/textContent directly is what makes those
      // editors silently revert the change on the next keystroke.
      if (!document.execCommand("insertText", false, text)) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
      return;
    }
    try {
      if (range) el.setSelectionRange(range.start, range.end);
      else el.setSelectionRange(0, el.value.length);
    } catch {}
    if (!document.execCommand("insertText", false, text)) {
      // Fallback: assigning el.value directly is invisible to React (it caches
      // the last value on the node), so go through the native setter and fire
      // the input event ourselves.
      const proto = el.tagName.toUpperCase() === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      const next = range ? el.value.slice(0, range.start) + text + el.value.slice(range.end) : text;
      setter.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function removeEditBadge() {
    if (editBadge) {
      editBadge.remove();
      editBadge = null;
    }
    if (!editMenu) editField = null;
  }

  function closeEditMenu() {
    if (editMenu) {
      editMenu.remove();
      editMenu = null;
    }
    editUndoText = null;
  }

  function positionEditBadge() {
    if (!editBadge || !editField) return;
    if (!editField.isConnected) {
      removeEditBadge();
      return;
    }
    const r = editField.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (r.bottom < 6 || r.top > vh - 6 || r.width < 100) {
      editBadge.style.opacity = "0";
      return;
    }
    editBadge.style.opacity = "";
    const w = editBadge.offsetWidth || 46;
    const h = editBadge.offsetHeight || 22;
    const left = Math.max(6, Math.min(r.right - w - 8, vw - w - 6));
    // In a tall box it sits in the bottom-right corner, out of the way of the
    // text; in a single-line input there is no "below", so centre it instead.
    const top = r.height < 46
      ? Math.max(6, Math.min(r.top + (r.height - h) / 2, vh - h - 6))
      : Math.max(6, Math.min(r.bottom - h - 7, vh - h - 6));
    editBadge.style.left = `${left}px`;
    editBadge.style.top = `${top}px`;
  }

  function showEditBadge(el) {
    if (editBadge && editField === el) {
      positionEditBadge();
      return;
    }
    closeEditMenu();
    removeEditBadge();
    editField = el;
    editBadge = document.createElement("div");
    editBadge.className = "af-edit-badge";
    editBadge.title = "Edit this text with AgentFury — fix, rewrite, or answer";
    editBadge.innerHTML = `<span class="af-ib-logo af-logo"></span><span class="af-badge-label">AI</span>`;
    getAfRoot().appendChild(editBadge);
    positionEditBadge();
    requestAnimationFrame(() => editBadge && editBadge.classList.add("af-in"));
    // Start watching what they type, and check what's already in the box.
    watchFieldTyping(el);
    proofIssues = [];
    proofLastText = "";
    paintProofCount();
    scheduleProof(el);
    // Never let the click steal focus from the field — losing the caret would
    // lose the selection we're about to rewrite.
    editBadge.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    editBadge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEditMenu();
    });
  }

  async function runEdit(kind, instruction) {
    if (!editMenu || !editField || !editField.isConnected) return;
    const status = editMenu.querySelector(".af-status");
    const tools = editMenu.querySelector(".af-tools");
    const el = editField;
    const range = fieldSelection(el);
    const whole = fieldValue(el);
    const target = (range ? range.text : whole).trim();

    if (!target && !instruction) {
      setPanelStatus(status, "Type something first, or tell AI what to write.", true);
      return;
    }

    setPanelStatus(status, kind === "answer" ? "Answering…" : "Rewriting…", false, true);

    let r;
    if (kind === "answer") {
      // The field holds a question (a quiz box, a form, a reply you're stuck
      // on) — answer it and put the answer where the caret is.
      r = await send(
        { type: "API_CALL", path: "/write/answer", method: "POST", body: { text: target.slice(0, 6000), question: instruction || "" } },
        45000
      );
    } else {
      // "fix" and a free-form instruction both ride /write/polish's improve
      // mode; an empty field plus an instruction means "write this for me".
      const MODES = { fix: "improve", instruct: "improve", improve: "improve", shorten: "shorten", formal: "formal", friendly: "friendly" };
      const mode = !target && instruction ? "write" : MODES[kind] || "improve";
      r = await send(
        {
          type: "API_CALL",
          path: "/write/polish",
          method: "POST",
          body: { text: target.slice(0, 6000), instruction: instruction || "", mode },
        },
        45000
      );
    }
    if (!r || !r.ok) {
      setPanelStatus(status, friendlyError(r || {}), true);
      return;
    }
    const out = ((r.data && (r.data.text || r.data.answer)) || "").trim();
    if (!out) {
      setPanelStatus(status, "The model returned nothing — try again.", true);
      return;
    }

    editUndoText = whole; // whole-field snapshot, so Undo is always exact
    setFieldValue(el, out, range || null);
    setPanelStatus(status, range ? "✓ Rewrote the selected text." : "✓ Applied to the field.", false);
    if (tools) tools.hidden = false;
    positionEditBadge();
  }

  function openEditMenu() {
    if (!editField || privacyMode) return;
    closeEditMenu();
    const hasSel = !!fieldSelection(editField);
    editMenu = document.createElement("div");
    editMenu.className = panelClass("af-edit-menu");
    editMenu.innerHTML = `
      <div class="af-card-head">
        <span class="af-card-ic af-logo"></span>
        <div class="af-card-titles">
          <div class="af-card-title">Edit with AI</div>
          <div class="af-card-sub">${hasSel ? "Selected text only" : "Whole field — no highlighting needed"}</div>
        </div>
        <button type="button" class="af-x" title="Close">✕</button>
      </div>
      <div class="af-row-wrap">
        <button type="button" class="af-chip primary" data-edit="fix" title="Fix spelling, grammar and wording">Fix</button>
        <button type="button" class="af-chip" data-edit="shorten">Shorten</button>
        <button type="button" class="af-chip" data-edit="formal">Formal</button>
        <button type="button" class="af-chip" data-edit="friendly">Friendly</button>
        <button type="button" class="af-chip" data-edit="answer" title="Treat what's in the box as a question and answer it">Answer</button>
      </div>
      <div class="af-ask-row">
        <input type="text" class="af-ask-input" placeholder="Tell AI what to change…" />
        <button type="button" class="af-ask-go" title="Apply (Enter)">${SVG_SEND}</button>
      </div>
      <div class="af-status"></div>
      <div class="af-tools" hidden></div>
    `;
    getAfRoot().appendChild(editMenu);
    placePanel(editMenu, editField.getBoundingClientRect());
    keepOnScreen(editMenu, editField);
    requestAnimationFrame(() => editMenu && editMenu.classList.add("af-in"));

    if (proofEnabled) renderSuggestions();

    const tools = editMenu.querySelector(".af-tools");
    tools.appendChild(
      mkTool("Undo", () => {
        if (editUndoText == null || !editField) return;
        setFieldValue(editField, editUndoText, null);
        editUndoText = null;
        tools.hidden = true;
        setPanelStatus(editMenu.querySelector(".af-status"), "Reverted.", false);
      })
    );

    editMenu.addEventListener("mousedown", (e) => {
      // Same reason as the badge: keep the page field focused and selected.
      if (!e.target.classList.contains("af-ask-input")) e.preventDefault();
      e.stopPropagation();
    });
    editMenu.querySelector(".af-x").onclick = () => closeEditMenu();
    editMenu.querySelectorAll("[data-edit]").forEach((b) => {
      b.onclick = () => runEdit(b.dataset.edit, "");
    });
    const ask = editMenu.querySelector(".af-ask-input");
    const go = editMenu.querySelector(".af-ask-go");
    enablePasteBypass(ask);
    const apply = () => {
      const v = ask.value.trim();
      if (v) runEdit("instruct", v);
    };
    go.onclick = apply;
    ask.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    });
  }

  function initAutoEdit() {
    if (autoEditInit) return;
    autoEditInit = true;
    window.addEventListener(
      "focusin",
      (e) => {
        if (!autoEditEnabled || privacyMode || isTinyFrame()) return;
        const el = editableTarget(e.target);
        if (el) showEditBadge(el);
      },
      true
    );
    window.addEventListener(
      "focusout",
      () => {
        // Clicking our own badge/menu blurs the page field (the shadow host
        // takes focus), so only drop the badge once focus has really left and
        // our menu isn't open.
        setTimeout(() => {
          if (editMenu) return;
          if (editField && document.activeElement === editField) return;
          removeEditBadge();
        }, 200);
      },
      true
    );
  }



  // ======================================================================
  //  Live suggestions while you type (the Grammarly-shaped part)
  // ======================================================================
  // Two passes, and the split is the whole design:
  //
  //   LOCAL, instantly, free — a small rule + misspelling table that runs on
  //   every keystroke pause with no network at all. It catches the things
  //   people notice themselves a second later (teh, recieve, "i" not
  //   capitalised, doubled words, a space before a comma), so the feature
  //   feels immediate instead of feeling like a request.
  //
  //   MODEL, debounced, cached — /write/proof, only once typing has actually
  //   paused, only when there is enough new text to be worth it, and never
  //   for text already checked. It returns exact { before → after } fragments
  //   rather than a rewrite, so accepting one suggestion leaves the rest of
  //   the sentence exactly as written.
  //
  // Nothing is ever changed without a click, and every accept goes through
  // the same undo-able path as the rest of auto-edit.

  const PROOF_MIN_CHARS = 25;   // below this there is nothing worth checking
  const PROOF_DEBOUNCE = 900;   // ms of quiet before the model pass
  const PROOF_MIN_DELTA = 10;   // don't re-ask the model over one typed word

  // Misspellings common enough to be worth fixing without a round trip.
  const TYPOS = {
    teh: "the", recieve: "receive", recieved: "received", seperate: "separate",
    definately: "definitely", occured: "occurred", untill: "until", wich: "which",
    thier: "their", becuase: "because", tommorow: "tomorrow", tomorow: "tomorrow",
    adress: "address", arguement: "argument", calender: "calendar",
    enviroment: "environment", goverment: "government", independant: "independent",
    neccessary: "necessary", occassion: "occasion", publically: "publicly",
    recomend: "recommend", refered: "referred", succesful: "successful",
    wierd: "weird", youre: "you're", dont: "don't", doesnt: "doesn't",
    didnt: "didn't", isnt: "isn't", cant: "can't", wont: "won't", ive: "I've",
    im: "I'm", thats: "that's", alot: "a lot", sucess: "success",
    priviledge: "privilege", maintainance: "maintenance", greatful: "grateful",
    beleive: "believe", acheive: "achieve", wierdly: "weirdly", agressive: "aggressive",
  };

  const LOCAL_RULES = [
    { re: /\bi\b/g, to: () => "I", type: "grammar", note: "capitalise I" },
    { re: /[ \t]{2,}/g, to: () => " ", type: "punctuation", note: "double space" },
    { re: /\s+([,.;:!?])/g, to: (m, p1) => p1, type: "punctuation", note: "space before punctuation" },
    { re: /([,;:])(?=[A-Za-z])/g, to: (m, p1) => p1 + " ", type: "punctuation", note: "missing space" },
    { re: /\b(\w+)\s+\1\b/gi, to: (m, p1) => p1, type: "grammar", note: "repeated word" },
  ];

  // Every issue carries the INDEX it was found at, not just the text: "i" as a
  // word appears inside a dozen other words, so applying by naive string
  // replace would corrupt the sentence.
  function localIssues(text) {
    const out = [];
    const seen = new Set();
    const push = (index, before, after, type, note) => {
      if (!before || before === after || seen.has(index)) return;
      seen.add(index);
      out.push({ index, before, after, type, note, local: true });
    };

    const words = /[A-Za-z']+/g;
    let m;
    while ((m = words.exec(text)) && out.length < 8) {
      const lower = m[0].toLowerCase();
      const fix = TYPOS[lower];
      if (!fix) continue;
      // Keep the writer's capitalisation of the first letter.
      const cased = m[0][0] === m[0][0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
      push(m.index, m[0], cased, "spelling", "common misspelling");
    }
    for (const rule of LOCAL_RULES) {
      rule.re.lastIndex = 0;
      let r;
      while ((r = rule.re.exec(text)) && out.length < 10) {
        const after = rule.to(r[0], r[1]);
        push(r.index, r[0], after, rule.type, rule.note);
      }
    }
    return out.sort((a, b) => a.index - b.index).slice(0, 10);
  }

  function mergeIssues(local, remote, text) {
    const all = local.slice();
    const taken = new Set(local.map((i) => i.index));
    for (const r of remote) {
      const index = text.indexOf(r.before);
      if (index < 0) continue; // the fragment isn't there any more — user typed on
      if (taken.has(index)) continue;
      taken.add(index);
      all.push({ ...r, index });
    }
    return all.sort((a, b) => a.index - b.index).slice(0, 10);
  }

  function paintProofCount() {
    if (!editBadge) return;
    const n = proofIssues.length;
    const label = editBadge.querySelector(".af-badge-label");
    if (label) label.textContent = n ? String(n) : "AI";
    editBadge.classList.toggle("af-has-issues", n > 0);
    editBadge.title = n
      ? `${n} suggestion${n === 1 ? "" : "s"} — click to review`
      : "Edit this text with AgentFury — fix, rewrite, or answer";
  }

  async function runProof(el) {
    if (!proofEnabled || !el || !el.isConnected) return;
    const text = fieldValue(el);
    proofField = el;
    proofIssues = localIssues(text); // instant, free
    paintProofCount();
    if (proofMenuOpen()) renderSuggestions();

    if (text.length < PROOF_MIN_CHARS) return;
    if (Math.abs(text.length - proofLastText.length) < PROOF_MIN_DELTA && text === proofLastText) return;
    proofLastText = text;

    const r = await send(
      { type: "API_CALL", path: "/write/proof", method: "POST", body: { text: text.slice(0, 3000) } },
      20000
    );
    // Typing-time failures are silent by design — the local pass already
    // showed whatever it found, and a red error under a text box while
    // someone is mid-sentence is worse than no suggestion.
    if (!r || !r.ok || !r.data || proofField !== el) return;
    const live = fieldValue(el);
    proofIssues = mergeIssues(localIssues(live), r.data.issues || [], live);
    paintProofCount();
    if (proofMenuOpen()) renderSuggestions();
  }

  function scheduleProof(el) {
    if (!proofEnabled) return;
    clearTimeout(proofTimer);
    proofTimer = setTimeout(() => runProof(el), PROOF_DEBOUNCE);
  }

  function watchFieldTyping(el) {
    if (proofWatched.has(el)) return;
    proofWatched.add(el);
    el.addEventListener("input", () => {
      if (editField !== el) return;
      // The local pass is cheap enough to run on the keystroke itself, so the
      // count updates as you type; only the model pass waits for a pause.
      proofIssues = localIssues(fieldValue(el));
      paintProofCount();
      scheduleProof(el);
    });
  }

  function proofMenuOpen() {
    return !!(editMenu && editMenu.querySelector(".af-suggests"));
  }

  // Apply one suggestion by INDEX, then re-check. The caret is put back where
  // it was (shifted by the length delta) so accepting a fix mid-sentence
  // doesn't throw the writer to the end of the box.
  function applyIssue(issue) {
    const el = editField;
    if (!el || !el.isConnected) return;
    const text = fieldValue(el);
    let idx = issue.index;
    if (text.slice(idx, idx + issue.before.length) !== issue.before) {
      idx = text.indexOf(issue.before); // the text moved while it sat there
      if (idx < 0) return;
    }
    let caret = null;
    try {
      caret = el.isContentEditable ? null : el.selectionStart;
    } catch {}
    const next = text.slice(0, idx) + issue.after + text.slice(idx + issue.before.length);
    editUndoText = text;
    setFieldValue(el, next, null);
    if (caret != null) {
      const delta = issue.after.length - issue.before.length;
      const at = caret > idx ? Math.max(idx, caret + delta) : caret;
      try {
        el.setSelectionRange(at, at);
      } catch {}
    }
    proofIssues = localIssues(next);
    paintProofCount();
    renderSuggestions();
    scheduleProof(el);
  }

  function applyAllIssues() {
    const el = editField;
    if (!el || !proofIssues.length) return;
    const before = fieldValue(el);
    let text = before;
    // Right to left, so each replacement can't shift the index of the next.
    [...proofIssues]
      .sort((a, b) => b.index - a.index)
      .forEach((i) => {
        if (text.slice(i.index, i.index + i.before.length) === i.before) {
          text = text.slice(0, i.index) + i.after + text.slice(i.index + i.before.length);
        }
      });
    if (text === before) return;
    editUndoText = before;
    setFieldValue(el, text, null);
    proofIssues = localIssues(text);
    paintProofCount();
    renderSuggestions();
    scheduleProof(el);
  }

  const ISSUE_DOT = { spelling: "#e5484d", grammar: "#f5a524", punctuation: "#8b8b93", clarity: "#5b6cf0" };

  function renderSuggestions() {
    if (!editMenu) return;
    let box = editMenu.querySelector(".af-suggests");
    if (!box) {
      box = document.createElement("div");
      box.className = "af-suggests";
      editMenu.insertBefore(box, editMenu.querySelector(".af-row-wrap"));
    }
    if (!proofIssues.length) {
      box.innerHTML = `<div class="af-suggest-empty">No issues found — looks clean.</div>`;
      return;
    }
    box.innerHTML =
      `<div class="af-suggest-head"><span>${proofIssues.length} suggestion${proofIssues.length === 1 ? "" : "s"}</span>` +
      `<button type="button" class="af-tool" data-fixall>Fix all</button></div>` +
      proofIssues
        .map(
          (i, n) => `
        <button type="button" class="af-suggest" data-fix="${n}" title="${escapeHtml(i.note || "")}">
          <span class="af-dot" style="background:${ISSUE_DOT[i.type] || ISSUE_DOT.grammar}"></span>
          <span class="af-suggest-text"><s>${escapeHtml(i.before)}</s> → <b>${escapeHtml(i.after)}</b></span>
        </button>`
        )
        .join("");
    box.querySelectorAll("[data-fix]").forEach((b) => {
      b.onclick = () => applyIssue(proofIssues[Number(b.dataset.fix)]);
    });
    const all = box.querySelector("[data-fixall]");
    if (all) all.onclick = () => applyAllIssues();
  }

  // ======================================================================
  //  Snip & read — OCR any region of the screen
  // ======================================================================
  // The final answer to "this text can't be copied". Everything above works
  // on the DOM: restore selection, grab a block, read an <img>. None of it
  // helps when the words aren't in the DOM or in an image element at all —
  // text painted on a <canvas> (Google Docs, map labels, chart annotations,
  // some readers), a frame of a video, a PDF plugin's own viewport, or a
  // component that resists every other route.
  //
  // So: capture what's actually on the screen and read THAT. The background
  // takes the screenshot (chrome.tabs.captureVisibleTab, on the activeTab
  // permission the keyboard shortcut / right-click grants for that one tab),
  // hands it here, and the user drags a box over the words. We crop those
  // pixels and send them to the same OCR the image badge uses.
  //
  // Deliberately gesture-gated: no capture ever happens unless the user
  // invokes the shortcut or the menu item, and the screenshot never leaves
  // the tab except as the region they drew.

  let snipLayer = null;
  let snipShot = null;

  function closeSnip() {
    if (snipLayer) {
      snipLayer.remove();
      snipLayer = null;
    }
    snipShot = null;
  }

  async function cropAndRead(rect) {
    let img = null;
    try {
      img = await loadImage(snipShot);
    } catch {}
    closeSnip();
    if (!img || !img.naturalWidth) return;
    try {
      // captureVisibleTab returns the viewport at DEVICE pixels, so a CSS-pixel
      // rect has to be scaled by the ratio the shot actually came back at (not
      // by devicePixelRatio, which lies when the page is zoomed).
      const scale = img.naturalWidth / window.innerWidth;
      const sx = Math.max(0, Math.round(rect.left * scale));
      const sy = Math.max(0, Math.round(rect.top * scale));
      const sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * scale));
      const sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * scale));
      if (sw < 4 || sh < 4) return;

      // Only ever scale DOWN, and only when the crop is genuinely huge: small
      // UI text is exactly what people snip, and shrinking it further is the
      // fastest way to make OCR guess.
      const k = Math.min(1, MAX_IMG_EDGE / Math.max(sw, sh));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(sw * k));
      c.height = Math.max(1, Math.round(sh * k));
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);

      openImageCard({
        dataUrl: c.toDataURL("image/jpeg", 0.92),
        label: `Screen selection · ${Math.round(rect.width)}×${Math.round(rect.height)}`,
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
      });
      // A snip only ever means one thing — read it. Don't make them click again.
      imgAction("ocr", "");
    } catch {
      /* canvas unavailable (rare: blocked or out of memory) — nothing to read */
    }
  }

  function startSnip(shot) {
    if (privacyMode || !imageAiEnabled || !IS_TOP) return;
    closeSnip();
    removeImgBadge();
    removeImgCard();
    snipShot = shot;

    snipLayer = document.createElement("div");
    snipLayer.className = "af-snip";
    snipLayer.innerHTML = `
      <div class="af-snip-hint">Drag over anything to read its text — Esc to cancel</div>
      <div class="af-snip-box" hidden></div>
    `;
    getAfRoot().appendChild(snipLayer);

    const box = snipLayer.querySelector(".af-snip-box");
    let sx = 0;
    let sy = 0;
    let dragging = false;

    const rectOf = (x, y) => ({
      left: Math.min(sx, x),
      top: Math.min(sy, y),
      right: Math.max(sx, x),
      bottom: Math.max(sy, y),
      width: Math.abs(x - sx),
      height: Math.abs(y - sy),
    });

    snipLayer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      box.hidden = false;
      box.style.cssText = `left:${sx}px;top:${sy}px;width:0;height:0`;
    });
    snipLayer.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const r = rectOf(e.clientX, e.clientY);
      box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    });
    snipLayer.addEventListener("mouseup", (e) => {
      if (!dragging) return;
      dragging = false;
      const r = rectOf(e.clientX, e.clientY);
      // A stray click (or a tiny drag) means "never mind", not "read 3 pixels".
      if (r.width < 12 || r.height < 8) {
        closeSnip();
        return;
      }
      cropAndRead(r);
    });
  }


  // ======================================================================
  //  Question spotter — answer what's on the page without highlighting it
  // ======================================================================
  // Selecting a question, then clicking Answer, is two actions too many when
  // the page is literally a list of questions: a quiz, a worksheet, a practice
  // paper, a form with a "why do you want this role?" box. So find them.
  //
  // Everything here is regex and layout maths — no model call is made to
  // decide whether something is a question, because that would cost more than
  // answering it. The badge only appears for the ONE question nearest the
  // middle of the screen: a badge on every question at once is wallpaper, and
  // wallpaper gets switched off.

  const Q_ENDS = /\?["'”’)\]]?\s*$/;
  const Q_STARTS = /^\s*(?:\d{1,2}[.)]\s*)?(who|what|when|where|why|how|which|whose|is|are|was|were|do|does|did|can|could|should|would|will|name|state|define|explain|calculate|find|solve|choose|select|identify)\b/i;
  const Q_OPTION = /(?:^|\n)\s*\(?[A-Da-d1-4][.):]\s+\S/g;
  const Q_TAGS = "p,h1,h2,h3,h4,h5,h6,li,dt,dd,td,label,legend,figcaption,blockquote,div,span";
  const Q_MIN = 14;    // shorter than this isn't a question, it's a label
  const Q_MAX = 600;   // longer than this is a paragraph that happens to ask something

  let qSpotterInit = false;
  let qBadge = null;
  let qTarget = null;
  let qText = "";
  let qScanTimer = 0;

  function countOptions(text) {
    Q_OPTION.lastIndex = 0;
    return (text.match(Q_OPTION) || []).length;
  }

  function looksLikeQuestion(text) {
    const t = (text || "").trim();
    if (t.length < Q_MIN || t.length > Q_MAX) return false;
    if (!Q_ENDS.test(t) && !Q_STARTS.test(t)) return false;
    // "Search?" and other one-word UI chrome aren't questions worth answering.
    return t.split(/\s+/).length >= 4;
  }

  // A question and its options are usually siblings, not one node. Walk up
  // until the container holds the options too (or a radio group), so the
  // answer is given the choices rather than guessing without them.
  function questionScope(el) {
    let node = el;
    let best = { el, text: (el.innerText || el.textContent || "").trim() };
    for (let i = 0; i < 4 && node && node.parentElement; i++) {
      node = node.parentElement;
      const text = (node.innerText || node.textContent || "").trim();
      if (!text || text.length > 2500) break;
      const hasOptions =
        countOptions(text) >= 2 ||
        (node.querySelectorAll && node.querySelectorAll('input[type="radio"], [role="radio"]').length >= 2);
      if (hasOptions) return { el: node, text };
      best = { el: node, text };
    }
    return best;
  }

  function visibleEnough(el) {
    let r;
    try {
      r = el.getBoundingClientRect();
    } catch {
      return null;
    }
    if (r.width < 120 || r.height < 14) return null;
    if (r.bottom < 60 || r.top > window.innerHeight - 40) return null;
    return r;
  }

  // The question closest to the middle of the screen — that's the one being
  // read right now.
  function findQuestion() {
    const middle = window.innerHeight / 2;
    let winner = null;
    let winnerDist = Infinity;
    let scanned = 0;
    let nodes;
    try {
      nodes = document.querySelectorAll(Q_TAGS);
    } catch {
      return null;
    }
    for (let i = 0; i < nodes.length && scanned < 900; i++) {
      const el = nodes[i];
      const r = visibleEnough(el);
      if (!r) continue;
      scanned++;
      // Only leaf-ish blocks: a wrapper repeats its children's text and would
      // always win on "contains a question mark".
      if (el.children.length > 3) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (!looksLikeQuestion(text)) continue;
      const dist = Math.abs(r.top + r.height / 2 - middle);
      if (dist < winnerDist) {
        winnerDist = dist;
        winner = el;
      }
    }
    return winner;
  }

  function removeQBadge() {
    if (qBadge) {
      qBadge.remove();
      qBadge = null;
    }
    qTarget = null;
    qText = "";
  }

  function positionQBadge() {
    if (!qBadge || !qTarget) return;
    const r = visibleEnough(qTarget);
    if (!r) {
      removeQBadge();
      return;
    }
    const w = qBadge.offsetWidth || 92;
    const h = qBadge.offsetHeight || 26;
    // Just outside the question's top-right, tucked back inside when there
    // isn't room to the right of it.
    let left = r.right + 8;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.right - w - 8);
    const top = Math.max(8, Math.min(r.top - 2, window.innerHeight - h - 8));
    qBadge.style.left = `${left}px`;
    qBadge.style.top = `${top}px`;
  }

  function showQBadge(el) {
    const scope = questionScope(el);
    if (qBadge && qTarget === el) {
      qText = scope.text;
      positionQBadge();
      return;
    }
    removeQBadge();
    qTarget = el;
    qText = scope.text;
    qBadge = document.createElement("div");
    qBadge.className = "af-q-badge";
    qBadge.title = "Answer this question with AgentFury";
    qBadge.innerHTML = `<span class="af-ib-logo af-logo"></span><span>Answer</span>`;
    getAfRoot().appendChild(qBadge);
    positionQBadge();
    requestAnimationFrame(() => qBadge && qBadge.classList.add("af-in"));
    qBadge.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    qBadge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      answerSpotted(scope);
    });
  }

  // One click, one answer — the bar opens already thinking, because the badge
  // said "Answer" and anything else would be a bait-and-switch.
  function answerSpotted(scope) {
    const el = (scope && scope.el) || qTarget;
    const text = ((scope && scope.text) || qText || "").slice(0, 6000);
    if (!text) return;
    lastSelectionText = text;
    lastAltGrabAt = Date.now(); // same reason as Alt+click: there's no selection
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      anchorRange = r;
    } catch {
      anchorRange = null;
    }
    const rect = el.getBoundingClientRect();
    removeQBadge();
    showBar(rect, "", false);
    ask(ANSWER_PROMPT);
  }

  function scanForQuestions() {
    if (!questionSpotEnabled || privacyMode || isTinyFrame()) return;
    if (bar || imgCard || editMenu || snipLayer) return; // something is already open
    const found = findQuestion();
    if (found) showQBadge(found);
    else removeQBadge();
  }

  function scheduleQuestionScan(delay) {
    clearTimeout(qScanTimer);
    qScanTimer = setTimeout(scanForQuestions, delay || 350);
  }

  function initQuestionSpotter() {
    if (qSpotterInit) return;
    qSpotterInit = true;
    scheduleQuestionScan(900); // let the page settle first
    window.addEventListener("scroll", () => scheduleQuestionScan(250), true);
    window.addEventListener("resize", () => scheduleQuestionScan(400), true);
    // Quizzes are single-page apps: the next question replaces the current one
    // without a navigation. Watch for that, cheaply — childList only, and
    // debounced hard, so a chatty page can't turn this into a scan loop.
    try {
      const mo = new MutationObserver(() => scheduleQuestionScan(600));
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch {}
  }

  // ======================================================================
  //  Ask without highlighting — Alt+click any block or image
  // ======================================================================
  // The last-resort path for text that simply cannot be selected: a canvas- or
  // overlay-based reader, a site whose blocker survives everything above, or
  // just a long paragraph you don't want to drag across. Alt+click reads the
  // text straight out of the DOM and opens the bar with it, no selection
  // involved. Alt+click an image and you get the image card instead.

  function blockTextFrom(el) {
    let node = el && el.nodeType === 3 ? el.parentElement : el;
    for (let i = 0; i < 12 && node && node !== document.body; i++) {
      const t = ((node.innerText || node.textContent) || "").trim();
      if (t.length >= 40) return { el: node, text: t.slice(0, 6000) };
      // parentElement is null at the top of a shadow tree — step out through
      // the host instead of giving up, or a component's text is unreachable.
      const parent = node.parentElement;
      if (parent) node = parent;
      else if (node.parentNode && node.parentNode.nodeType === 11) node = node.parentNode.host;
      else break;
    }
    return null;
  }

  // Set by the Alt+click grab below and read by the mouseup handler further
  // up: that handler closes the selection UI when the page has no selection,
  // and its deferred tick lands AFTER this click — which would shut the bar we
  // just opened. There is no selection to find, by design.
  let lastAltGrabAt = 0;
  let altClickInit = false;
  function initAltClick() {
    if (altClickInit) return;
    altClickInit = true;
    window.addEventListener(
      "click",
      (e) => {
        if (!e.altKey || privacyMode || isTinyFrame()) return;
        if (e.target === afHost) return;
        // composedPath()[0] is the real element, even inside an open shadow
        // root, where e.target is only ever the host.
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        if (imageAiEnabled) {
          const img = imageCandidate(target) || imageAt(e.clientX, e.clientY, e.composedPath && e.composedPath());
          if (img) {
            e.preventDefault();
            e.stopPropagation();
            openImageCard(img);
            return;
          }
        }
        if (!selectEnabled) return;
        unblockAlongPath(e); // make the component selectable for next time, too
        const grab = blockTextFrom(target);
        if (!grab) return;
        e.preventDefault();
        e.stopPropagation();
        lastAltGrabAt = Date.now();
        lastSelectionText = grab.text;
        try {
          // A range over the block gives the bar the same anchor a real
          // selection would: the highlight overlay draws on it, and it follows
          // the text on scroll instead of dying at the first wheel tick.
          const r = document.createRange();
          r.selectNodeContents(grab.el);
          anchorRange = r;
        } catch {
          anchorRange = null;
        }
        showBar(grab.el.getBoundingClientRect(), "", true);
      },
      true
    );
  }

  // ---------- Shared lifecycle for the three surfaces above ----------

  function teardownExtras() {
    closeSnip();
    removeQBadge();
    removeImgBadge();
    removeImgCard();
    closeEditMenu();
    removeEditBadge();
  }

  let extrasWired = false;
  function initExtras() {
    if (isTinyFrame()) return; // ad/tracking frames get copy-restore only
    initImageAI();
    initAutoEdit();
    initAltClick();
    initQuestionSpotter();
    if (!extrasWired) {
      extrasWired = true;
      const follow = () => {
        positionImgBadge();
        positionEditBadge();
        positionQBadge();
      };
      let raf = 0;
      const onMove = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          follow();
        });
      };
      window.addEventListener("scroll", onMove, true);
      window.addEventListener("resize", onMove, true);
      window.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Escape") {
            closeSnip();
            removeImgCard();
            closeEditMenu();
          }
        },
        true
      );
      // A click anywhere on the page dismisses the image card (the edit menu
      // stays — it belongs to the field you're still typing in).
      window.addEventListener(
        "mousedown",
        (e) => {
          if (imgCard && e.target !== afHost) removeImgCard();
          if (editMenu && e.target !== afHost && e.target !== editField) closeEditMenu();
        },
        true
      );
    }
  }

})();
