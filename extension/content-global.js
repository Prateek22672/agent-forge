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

  function removeBar() {
    if (bar) {
      bar.remove();
      bar = null;
    }
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

  function showBar(rect, prefill) {
    removeBar();
    bar = document.createElement("div");
    bar.className = "af-sel-bar";
    const pos = clampPosition(rect);
    bar.style.top = `${pos.top}px`;
    bar.style.left = `${pos.left}px`;
    bar.innerHTML = `
      <span class="af-sel-icon">AF</span>
      <input type="text" class="af-sel-input" placeholder="Ask AgentFury about this…" />
      <button type="button" class="af-sel-chip" data-q="Explain this simply.">Explain</button>
      <button type="button" class="af-sel-chip" data-q="Summarize this concisely.">Summarize</button>
      <button type="button" class="af-sel-send" title="Ask">→</button>
    `;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add("af-in"));

    const input = bar.querySelector(".af-sel-input");
    if (prefill) input.value = prefill;
    input.focus();

    bar.querySelector(".af-sel-send").onclick = () => ask(input.value.trim());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ask(input.value.trim());
      }
    });
    bar.querySelectorAll(".af-sel-chip").forEach((c) => {
      c.onclick = () => ask(c.dataset.q);
    });
    bar.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  document.addEventListener("mouseup", (e) => {
    if (bar && bar.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text.length > 2 && text.length < 6000) {
        lastSelectionText = text;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        showBar(rect);
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
            rect = sel.getRangeAt(0).getBoundingClientRect();
          } catch {
            /* keep fallback */
          }
        }
        showBar(rect, "");
      }
    });
  } catch {
    /* extension context not ready — WARM_UP above will have already no-op'd */
  }
})();
