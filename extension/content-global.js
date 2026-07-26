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
  let copyPasteRestored = false;
  function restoreCopyPaste() {
    if (!selectEnabled || copyPasteRestored) return;
    copyPasteRestored = true;

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
    chrome.storage.local.get(["af_select_enabled", "af_bubble_enabled"], (r) => {
      if (typeof r.af_select_enabled === "boolean") selectEnabled = r.af_select_enabled;
      if (typeof r.af_bubble_enabled === "boolean") bubbleEnabled = r.af_bubble_enabled;
      if (bubbleEnabled) mountBubble();
      restoreCopyPaste();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
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
      box.style.top = `${window.scrollY + r.top}px`;
      box.style.left = `${window.scrollX + r.left}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      container.appendChild(box);
    }
    document.body.appendChild(container);
    highlightOverlay = container;
  }

  function removeBar() {
    if (bar) {
      bar.remove();
      bar = null;
    }
    clearHighlightOverlay();
  }

  function clampPosition(rect) {
    const top = window.scrollY + rect.bottom + 8;
    const maxLeft = window.scrollX + window.innerWidth - 380;
    const left = window.scrollX + Math.max(8, Math.min(rect.left, Math.max(8, maxLeft)));
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
    document.body.appendChild(captureCard);
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
    if (bubble || !bubbleEnabled) return;
    bubble = document.createElement("button");
    bubble.type = "button";
    bubble.className = "af-bubble";
    bubble.title = "AgentFury — note a difficulty, or click the toolbar icon for the full assistant";
    bubble.textContent = "AF";
    bubble.onclick = openCapture;
    document.body.appendChild(bubble);
    requestAnimationFrame(() => bubble.classList.add("af-in"));
  }

  function unmountBubble() {
    closeCapture();
    if (bubble) {
      bubble.remove();
      bubble = null;
    }
  }

  document.addEventListener("mousedown", (e) => {
    if (captureCard && !captureCard.contains(e.target) && e.target !== bubble) closeCapture();
  });

  function showBar(rect, prefill, autoFocus) {
    if (!selectEnabled) return; // turned off in the popup — single choke point
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
    document.body.appendChild(bar);
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

  document.addEventListener("mouseup", (e) => {
    if (bar && bar.contains(e.target)) return;
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
  });
  document.addEventListener("mousedown", (e) => {
    if (bar && !bar.contains(e.target)) removeBar();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      removeBar();
      closeCapture();
    }
  });

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
