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

  let bar = null;
  let assistantAgentId = null;
  let lastSelectionText = "";

  // Select-to-ask can be turned off from the popup (Settings). Cached locally
  // and kept live via storage.onChanged, so toggling it takes effect on every
  // open tab immediately — no page refresh needed for this particular setting.
  let selectEnabled = true;
  try {
    chrome.storage.local.get("af_select_enabled", (r) => {
      if (typeof r.af_select_enabled === "boolean") selectEnabled = r.af_select_enabled;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && "af_select_enabled" in changes) {
        selectEnabled = changes.af_select_enabled.newValue !== false;
        if (!selectEnabled) removeBar();
      }
    });
  } catch {
    /* extension context not ready yet — defaults to enabled */
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
  // backend as your Planner and Brain, so it actually DOES something for you
  // instead of only answering a question.
  async function quickAction(kind) {
    if (!lastSelectionText) return;
    const title = lastSelectionText.slice(0, 300);
    showAnswer(kind === "remind" ? "Adding to your reminders…" : "Saving to your Brain…", false, true);
    const r =
      kind === "remind"
        ? await send({ type: "API_CALL", path: "/reminders", method: "POST", body: { title, remind_at: "" } })
        : await send({ type: "API_CALL", path: "/brain", method: "POST", body: { text: title } });
    if (!r.ok) {
      showAnswer(friendlyError(r), true);
      return;
    }
    showAnswer(kind === "remind" ? "✓ Added to your Reminders." : "✓ Saved to your Brain.", false);
  }

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
        <button type="button" class="af-sel-chip af-sel-action" data-action="remind" title="Add this as a reminder">⏰ Remind</button>
        <button type="button" class="af-sel-chip af-sel-action" data-action="brain" title="Save this to your Brain">🧠 Save</button>
      </div>
    `;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add("af-in"));

    const input = bar.querySelector(".af-sel-input");
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
      if (text.length > 2 && text.length < 6000) {
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
    if (e.key === "Escape") removeBar();
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
