// AgentFury — injects a small AI launcher into every Gmail compose box. Click
// it to open a floating panel: quick rewrites (Improve/Shorten/Formal/
// Friendly), "Write for me", a preview of the result, and a refine box to
// iterate on wording before inserting — nothing touches the email until you
// hit Insert.
//
// The panel is attached to document.body (not nested inside Gmail's compose
// <form>), so it can never be intercepted by Gmail's own click/submit
// handling — that's what caused clicks to "pass through to Gmail" before.
//
// Gmail is a SPA that recreates compose DOM constantly, so we watch for new
// compose bodies via MutationObserver and attach a launcher to each one once.

const COMPOSE_SELECTOR = 'div[aria-label="Message Body"][contenteditable="true"]';
const ATTACHED = new WeakSet();

// After the extension is reloaded/updated, content scripts already injected
// into open tabs (Gmail is long-lived — the tab was never reloaded) lose
// their connection to it: chrome.runtime becomes undefined and a raw call
// throws. Guard every access so that's a friendly message, not a crash.
function extensionAlive() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function send(msg, timeoutMs = 45000) {
  // Timeboxed so a cold backend (Render free tier can take ~50s to wake up)
  // never leaves the UI stuck on "Thinking…" forever — it always resolves.
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

// Wake a sleeping backend the moment Gmail loads, so it's likely already warm
// by the time the user opens the panel.
send({ type: "WARM_UP" });

function friendlyError(r) {
  if (r.contextInvalid) return "AgentFury was updated — refresh this Gmail tab (F5).";
  if (r.timedOut) return "Still waking up — try again, it'll be quick now.";
  if (r.status === 401) return "Sign in via the AgentFury extension icon first.";
  return "Failed: " + (r.error || "unknown error") + " — try again.";
}

// Best-effort read of the recipient(s) and subject around a compose box, so
// generation isn't blind to who the email is for. Gmail renders recipient
// chips as <span email="..." name="...">, the one stable hook across Gmail's
// frequently-changing DOM; degrades to nothing if not found.
function extractContext(composeBody) {
  let container = composeBody;
  for (let i = 0; i < 8 && container; i++) {
    if (container.querySelector && container.querySelector('input[name="subjectbox"]')) break;
    container = container.parentElement;
  }
  container = container || composeBody.closest('[role="dialog"]') || composeBody.parentElement;
  if (!container) return { subject: "", recipients: [] };

  const subjEl = container.querySelector('input[name="subjectbox"]');
  const subject = subjEl ? subjEl.value || "" : "";

  const recipients = [];
  container.querySelectorAll("span[email]").forEach((s) => {
    const email = s.getAttribute("email");
    const name = s.getAttribute("name") || "";
    if (email) recipients.push(name ? `${name} <${email}>` : email);
  });
  return { subject, recipients: recipients.slice(0, 5) };
}

async function callPolish(composeBody, mode, text, instruction) {
  const { subject, recipients } = extractContext(composeBody);
  return send({
    type: "API_CALL",
    path: "/write/polish",
    method: "POST",
    body: { text, instruction: instruction || "", mode, subject, recipients },
  });
}

let openPanel = null; // only one panel at a time

function closePanel() {
  if (openPanel) {
    openPanel.remove();
    openPanel = null;
    document.removeEventListener("mousedown", onOutsideClick, true);
    document.removeEventListener("keydown", onEscape, true);
  }
}
function onOutsideClick(e) {
  if (openPanel && !openPanel.contains(e.target)) closePanel();
}
function onEscape(e) {
  if (e.key === "Escape") closePanel();
}

function openPanelFor(launcher, composeBody) {
  if (openPanel) {
    closePanel();
    return;
  }
  const panel = document.createElement("div");
  panel.className = "af-panel";
  panel.innerHTML = `
    <div class="af-panel-head">
      <span class="af-label">AGENTFURY</span>
      <button type="button" class="af-close" title="Close">×</button>
    </div>
    <div class="af-chips">
      <button type="button" data-mode="improve">Improve</button>
      <button type="button" data-mode="shorten">Shorten</button>
      <button type="button" data-mode="formal">Formal</button>
      <button type="button" data-mode="friendly">Friendly</button>
    </div>
    <div class="af-row">
      <input type="text" class="af-write-input" placeholder="Write for me: e.g. politely decline and ask to reschedule" />
      <button type="button" class="af-write-btn">Generate</button>
    </div>
    <div class="af-status"></div>
    <div class="af-preview-wrap" hidden>
      <div class="af-preview"></div>
      <div class="af-row">
        <input type="text" class="af-refine-input" placeholder="Refine: e.g. make it shorter, more formal…" />
        <button type="button" class="af-refine-btn">Refine</button>
      </div>
      <div class="af-actions">
        <button type="button" class="af-insert-btn">Insert into email</button>
        <button type="button" class="af-discard-btn secondary">Discard</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  openPanel = panel;

  // Position below the launcher, clamped to the viewport.
  const r = launcher.getBoundingClientRect();
  const top = Math.min(r.bottom + 6, window.innerHeight - 60);
  const left = Math.min(r.left, window.innerWidth - 340);
  panel.style.top = `${Math.max(8, top)}px`;
  panel.style.left = `${Math.max(8, left)}px`;

  document.addEventListener("mousedown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);

  const status = panel.querySelector(".af-status");
  const previewWrap = panel.querySelector(".af-preview-wrap");
  const previewEl = panel.querySelector(".af-preview");
  const writeInput = panel.querySelector(".af-write-input");
  const refineInput = panel.querySelector(".af-refine-input");

  let previewText = "";

  const setStatus = (text, isError) => {
    status.textContent = text;
    status.classList.toggle("af-err", !!isError);
  };
  const setBusy = (busy) => {
    panel.querySelectorAll("button").forEach((b) => (b.disabled = busy));
  };
  const showPreview = (text) => {
    previewText = text;
    previewEl.textContent = text;
    previewWrap.hidden = false;
  };

  panel.querySelector(".af-close").onclick = closePanel;
  panel.querySelector(".af-discard-btn").onclick = () => {
    previewWrap.hidden = true;
    previewText = "";
    setStatus("");
  };
  panel.querySelector(".af-insert-btn").onclick = () => {
    composeBody.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, previewText);
    closePanel();
  };

  panel.querySelectorAll(".af-chips button").forEach((btn) => {
    btn.onclick = async () => {
      const base = previewText || composeBody.innerText.trim();
      if (!base) {
        setStatus("Nothing to work with yet — type something first.", true);
        return;
      }
      setBusy(true);
      setStatus("Thinking… (can take up to a minute if the server was asleep)");
      const r = await callPolish(composeBody, btn.dataset.mode, base, "");
      setBusy(false);
      if (!r.ok) {
        setStatus(friendlyError(r), true);
        return;
      }
      showPreview(r.data.text);
      setStatus("");
    };
  });

  const generate = async () => {
    const instruction = writeInput.value.trim();
    if (!instruction) {
      setStatus("Type what the email should say first.", true);
      return;
    }
    setBusy(true);
    setStatus("Thinking… (can take up to a minute if the server was asleep)");
    const r = await callPolish(composeBody, "write", "", instruction);
    setBusy(false);
    if (!r.ok) {
      setStatus(friendlyError(r), true);
      return;
    }
    showPreview(r.data.text);
    setStatus("");
  };
  panel.querySelector(".af-write-btn").onclick = generate;
  writeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });

  const refine = async () => {
    const instruction = refineInput.value.trim();
    if (!instruction || !previewText) return;
    setBusy(true);
    setStatus("Refining…");
    const r = await callPolish(composeBody, "improve", previewText, instruction);
    setBusy(false);
    if (!r.ok) {
      setStatus(friendlyError(r), true);
      return;
    }
    showPreview(r.data.text);
    refineInput.value = "";
    setStatus("");
  };
  panel.querySelector(".af-refine-btn").onclick = refine;
  refineInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      refine();
    }
  });
}

function attach(composeBody) {
  if (ATTACHED.has(composeBody)) return;
  ATTACHED.add(composeBody);

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "af-launcher";
  launcher.title = "AgentFury — AI writing assistant";
  launcher.textContent = "AF";
  launcher.onclick = () => openPanelFor(launcher, composeBody);

  composeBody.parentElement.insertBefore(launcher, composeBody);
}

function scan() {
  document.querySelectorAll(COMPOSE_SELECTOR).forEach(attach);
}

const observer = new MutationObserver(() => scan());
observer.observe(document.body, { childList: true, subtree: true });
scan();
