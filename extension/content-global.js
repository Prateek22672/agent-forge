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
    return "Failed: " + (r.error || "unknown error") + " — try again.";
  }

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
  const AF_CSS_TEXT = `
.af-sel-highlight { position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147482999; }
.af-sel-highlight-box { position: fixed; background: rgba(124, 92, 255, .38); border-radius: 2px; }
.af-sel-bar { position: fixed; z-index: 2147483000; display: flex; flex-direction: column; gap: 6px; padding: 7px 8px; background: #0b0b0b; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; box-shadow: 0 10px 28px rgba(0,0,0,.4); font-family: -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif; max-width: 380px; min-width: 300px; opacity: 0; transform: translateY(6px) scale(.97); transition: opacity .16s ease, transform .16s cubic-bezier(.2,.8,.3,1); box-sizing: border-box; }
.af-sel-bar * { box-sizing: border-box; }
.af-sel-bar.af-in { opacity: 1; transform: translateY(0) scale(1); }
.af-sel-row { display: flex; align-items: center; gap: 6px; }
.af-sel-chips { display: flex; flex-wrap: wrap; gap: 5px; padding-left: 28px; }
.af-sel-icon { flex-shrink: 0; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: #fff; color: #000; border-radius: 50%; font-size: 9px; font-weight: 800; letter-spacing: -.02em; }
.af-sel-input { flex: 1; min-width: 120px; background: transparent; border: none; color: #fff; font-size: 12.5px; outline: none; font-family: inherit; padding: 0; margin: 0; }
.af-sel-input::placeholder { color: rgba(255,255,255,.4); }
.af-sel-chip { flex-shrink: 0; background: rgba(255,255,255,.07); color: #fff; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.af-sel-chip:hover { background: #fff; color: #000; border-color: #fff; }
.af-sel-action { background: rgba(124, 92, 255, .18); border-color: rgba(124, 92, 255, .4); }
.af-sel-action:hover { background: #7c5cff; color: #fff; border-color: #7c5cff; }
.af-sel-send { flex-shrink: 0; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; background: #fff; color: #000; border: none; border-radius: 50%; font-size: 14px; font-weight: 700; cursor: pointer; padding: 0; }
.af-sel-send:hover { opacity: .85; }
.af-sel-answer { position: absolute; top: 100%; left: 0; margin-top: 8px; width: 340px; max-height: 220px; overflow-y: auto; background: #0b0b0b; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; box-shadow: 0 10px 28px rgba(0,0,0,.4); padding: 11px 13px; font-size: 12.5px; line-height: 1.55; color: #f2f2f2; opacity: 0; transform: translateY(4px); transition: opacity .14s ease, transform .14s ease; box-sizing: border-box; }
.af-sel-answer.af-in { opacity: 1; transform: translateY(0); }
.af-sel-answer.af-err { color: #ff8a8a; }
.af-sel-answer-text { margin-bottom: 8px; }
.af-sel-spin { display: inline-block; width: 11px; height: 11px; border: 2px solid rgba(255,255,255,.25); border-top-color: #fff; border-radius: 50%; margin-right: 7px; vertical-align: -1px; animation: af-spin .7s linear infinite; }
@keyframes af-spin { to { transform: rotate(360deg); } }
.af-copy { background: transparent; color: rgba(255,255,255,.65); border: 1px solid rgba(255,255,255,.22); border-radius: 999px; padding: 4px 11px; font-size: 11px; cursor: pointer; }
.af-copy:hover { color: #fff; border-color: rgba(255,255,255,.55); }
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
    style.textContent = AF_CSS_TEXT;
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
    removeBar();
    closeCapture();
    unmountBubble();
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
    // A page loaded while privacy mode was on skipped this during init, so
    // apply it now — otherwise copy-restore stays dead on that tab until it
    // is reloaded. It self-guards against running twice.
    restoreCopyPaste();
  }

  // Some sites block text SELECTION itself (not just the clipboard) — either
  // via CSS (user-select: none) or by cancelling selectstart/copy/contextmenu
  // in JS. If nothing can be selected, our bar never gets a chance to appear
  // and the Copy chip has nothing to copy. Undo both, site-wide:
  //  1. CSS override forces selection back on everywhere.
  //  2. A capture-phase listener on `window` — the outermost point an event
  //     passes through — runs before any listener the page attached on
  //     document/body, in capture OR bubble phase, regardless of when the
  //     page's script ran. stopImmediatePropagation() there stops the page's
  //     own blocking handler from ever firing, without needing to know
  //     anything about how the site implemented the block.
  // Best-effort signal for admin review (see docs on BypassEvent in the
  // backend): does this page look like it's DELIBERATELY blocking copying,
  // as opposed to an ordinary page a user happened to copy something on?
  // Sites almost never set user-select: none on their whole body/root
  // unless copy-blocking is intentional — cheap, one-time-per-page check,
  // computed before we apply our own override so it reflects the page's
  // original intent. This is a reporting signal only, never an automatic
  // judgment — see app/models.py BypassEvent for the full rationale.
  function reportIfLooksBlocked() {
    try {
      const cs = getComputedStyle(document.body || document.documentElement);
      const blocked = cs.userSelect === "none" || cs.webkitUserSelect === "none";
      if (!blocked) return;
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

  let copyPasteRestored = false;
  function restoreCopyPaste() {
    if (!selectEnabled || copyPasteRestored) return;
    copyPasteRestored = true;
    reportIfLooksBlocked();

    const style = document.createElement("style");
    style.id = "af-restore-select";
    style.textContent = `
      * { -webkit-user-select: text !important; user-select: text !important; }
      * { -webkit-touch-callout: default !important; }
    `;
    (document.head || document.documentElement).appendChild(style);

    ["selectstart", "copy", "cut", "contextmenu"].forEach((type) => {
      window.addEventListener(type, (e) => e.stopImmediatePropagation(), true);
    });

    // Some anti-copy scripts don't hook the copy/selectstart events at all —
    // they listen for the Ctrl/Cmd+C keystroke directly (keydown) and react
    // to that instead (block it, show a warning, snapshot their own DOM to
    // "catch" the attempt, etc.). Neutralize that the same way: intercept it
    // at the window in the capture phase, before the page's own keydown
    // handler ever runs, so whatever it does on Ctrl+C simply doesn't fire.
    // This does NOT call preventDefault, so the browser's normal copy still
    // happens afterward — we're only silencing the page's own reaction to it.
    window.addEventListener(
      "keydown",
      (e) => {
        const key = (e.key || "").toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (key === "c" || key === "x")) {
          e.stopImmediatePropagation();
        }
      },
      true
    );
  }
  // Some sites disable copy/paste (block the native "copy"/"paste" events,
  // or preventDefault on Ctrl+C/Ctrl+V) to stop people lifting content off
  // the page. That blocking targets the page's own DOM events — it can't
  // reach the OS clipboard directly. So for anything of ours (the selection
  // bar's input, the quick-capture note box) we bypass the page entirely and
  // talk to the Clipboard API ourselves.
  function forceCopy(text) {
    if (!text) return Promise.resolve(false);
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false);
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

  // Select-to-ask and the floating bubble can both be turned off from the
  // popup (Settings). Cached locally and kept live via storage.onChanged, so
  // toggling takes effect on every open tab immediately — no refresh needed.
  let selectEnabled = true;
  let bubbleEnabled = true;
  try {
    chrome.storage.local.get(
      ["af_select_enabled", "af_bubble_enabled", "af_privacy_mode"],
      (r) => {
        if (typeof r.af_select_enabled === "boolean") selectEnabled = r.af_select_enabled;
        if (typeof r.af_bubble_enabled === "boolean") bubbleEnabled = r.af_bubble_enabled;
        privacyMode = r.af_privacy_mode === true;
        if (privacyMode) return; // stay fully off — don't mount anything
        if (bubbleEnabled) mountBubble();
        restoreCopyPaste();
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
        if (!selectEnabled) removeBar();
        else restoreCopyPaste();
      }
      if ("af_bubble_enabled" in changes) {
        bubbleEnabled = changes.af_bubble_enabled.newValue !== false;
        if (bubbleEnabled) mountBubble();
        else unmountBubble();
      }
    });
  } catch {
    /* extension context not ready yet — defaults to enabled */
    restoreCopyPaste();
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
  }

  // Viewport coordinates, paired with position: fixed. Deliberately NOT
  // absolute + scroll offsets: an absolutely-positioned element resolves
  // against its nearest *positioned* ancestor, and on app-like sites (ChatGPT,
  // Gmail, most React layouts) some ancestor almost always has `transform` or
  // `position: relative`, which silently moves the containing block and puts
  // the bar off-screen — present in the DOM, invisible to the user. `fixed`
  // always resolves against the viewport, so getBoundingClientRect() values
  // can be used directly and the result is identical on every site.
  function clampPosition(rect) {
    const top = rect.bottom + 8;
    const maxLeft = window.innerWidth - 380;
    const left = Math.max(8, Math.min(rect.left, Math.max(8, maxLeft)));
    return { top, left };
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  function showAnswer(text, isError, busy) {
    if (!bar) return;
    let box = bar.querySelector(".af-sel-answer");
    if (!box) {
      box = document.createElement("div");
      box.className = "af-sel-answer";
      bar.appendChild(box);
      requestAnimationFrame(() => box.classList.add("af-in"));
    }
    box.classList.toggle("af-err", !!isError);
    if (busy) {
      box.innerHTML = `<span class="af-sel-spin"></span><span>${escapeHtml(text)}</span>`;
      return;
    }
    box.innerHTML = `<div class="af-sel-answer-text">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
    if (!isError) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "af-copy";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = () => navigator.clipboard.writeText(text).catch(() => {});
      box.appendChild(copyBtn);
    }
  }

  async function ask(question) {
    const q = (question || "").trim();
    if (!q) return;
    showAnswer("Thinking… (can take a bit if the server was asleep)", false, true);

    if (!assistantAgentId) {
      const r = await send({ type: "API_CALL", path: "/agents", method: "GET" });
      if (r.ok) {
        const a = r.data.find((x) => x.name === "Assistant") || r.data[0];
        assistantAgentId = a?.id || null;
      }
    }
    if (!assistantAgentId) {
      showAnswer("Couldn't reach AgentFury — sign in via the extension icon.", true);
      return;
    }
    const message = lastSelectionText
      ? `Regarding this text: "${lastSelectionText.slice(0, 1500)}"\n\n${q}`
      : q;
    const r2 = await send(
      { type: "API_CALL", path: `/agents/${assistantAgentId}/chat`, method: "POST", body: { message } },
      45000
    );
    if (!r2.ok) {
      showAnswer(friendlyError(r2), true);
      return;
    }
    showAnswer(r2.data.reply, false);
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

  function showBar(rect, prefill, autoFocus) {
    if (!selectEnabled || privacyMode) return; // single choke point for both switches
    removeBar();
    bar = document.createElement("div");
    bar.className = "af-sel-bar";
    const pos = clampPosition(rect);
    bar.style.top = `${pos.top}px`;
    bar.style.left = `${pos.left}px`;
    bar.innerHTML = `
      <div class="af-sel-row">
        <span class="af-sel-icon">AF</span>
        <input type="text" class="af-sel-input" placeholder="Ask AgentFury about this…" />
        <button type="button" class="af-sel-send" title="Ask">→</button>
      </div>
      <div class="af-sel-chips">
        <button type="button" class="af-sel-chip" data-q="Explain this simply.">Explain</button>
        <button type="button" class="af-sel-chip" data-q="Summarize this concisely.">Summarize</button>
        <button type="button" class="af-sel-chip" data-copy="1" title="Copy this text — works even on sites that block copying">Copy</button>
        <button type="button" class="af-sel-chip af-sel-action" data-action="remind" title="Add this as a reminder">Remind</button>
        <button type="button" class="af-sel-chip af-sel-action" data-action="note" title="Save this to your Notes — great for study highlights">Note</button>
        <button type="button" class="af-sel-chip af-sel-action" data-action="brain" title="Save this to your Brain (personalizes the AI)">Brain</button>
      </div>
    `;
    getAfRoot().appendChild(bar);
    requestAnimationFrame(() => bar.classList.add("af-in"));

    const input = bar.querySelector(".af-sel-input");
    enablePasteBypass(input);
    if (prefill) input.value = prefill;
    // Only steal keyboard focus when explicitly opened to ask (right-click
    // menu). On a plain text selection, focusing our input would hijack
    // Ctrl+C — the browser copies from whatever has focus, so the page's
    // highlighted text would silently fail to copy. Leave focus on the page.
    if (autoFocus) input.focus();

    bar.querySelector(".af-sel-send").onclick = () => ask(input.value.trim());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ask(input.value.trim());
      }
    });
    bar.querySelectorAll(".af-sel-chip[data-q]").forEach((c) => {
      c.onclick = () => ask(c.dataset.q);
    });
    bar.querySelectorAll(".af-sel-action[data-action]").forEach((c) => {
      c.onclick = () => quickAction(c.dataset.action);
    });
    const copyChip = bar.querySelector(".af-sel-chip[data-copy]");
    if (copyChip) {
      copyChip.onclick = async () => {
        const ok = await forceCopy(lastSelectionText);
        copyChip.textContent = ok ? "Copied" : "Couldn't copy";
        setTimeout(() => {
          if (copyChip) copyChip.textContent = "Copy";
        }, 1400);
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
      if (bar && e.target === afHost) return;
      // Deferred a tick: in capture phase the browser may not have finalized
      // the Selection yet, and this also lets the page's own handlers run
      // first so we read the selection they leave behind, not an interim one.
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        if (text.length > 2 && text.length < 6000 && sel.rangeCount > 0) {
          lastSelectionText = text;
          const range = sel.getRangeAt(0);
          showBar(range.getBoundingClientRect());
          drawHighlightOverlay(range); // survives even if the page later clears its own selection
        } else if (!text) {
          removeBar();
        }
      }, 0);
    },
    true
  );
  window.addEventListener(
    "mousedown",
    (e) => {
      if (bar && e.target !== afHost) removeBar();
    },
    true
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        removeBar();
        closeCapture();
      }
    },
    true
  );
  // The bar and highlight are viewport-positioned, so once the page scrolls
  // they no longer line up with the text they refer to — dismiss instead of
  // letting them drift. Capture phase so it also catches scrolling inside a
  // nested scroll container, which is how most app-like sites scroll.
  window.addEventListener("scroll", () => { if (bar) removeBar(); }, true);

  // Right-click → "Ask AgentFury about…" (background.js relays the selection here).
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "AF_OPEN_SELECTION") {
        lastSelectionText = msg.text || lastSelectionText;
        let rect = { top: window.innerHeight / 2, bottom: window.innerHeight / 2, left: window.innerWidth / 2 };
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          try {
            const range = sel.getRangeAt(0);
            rect = range.getBoundingClientRect();
            drawHighlightOverlay(range);
          } catch {
            /* keep fallback */
          }
        }
        showBar(rect, "", true);
      }
    });
  } catch {
    /* extension context not ready — WARM_UP above will have already no-op'd */
  }
})();
