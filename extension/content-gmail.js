// AgentFury — injects an AI toolbar into every Gmail compose box:
// Improve / Shorten / Formal / Friendly (rewrite what's there) and
// Write for me (generate a full draft from a one-line instruction).
//
// Gmail is a SPA that recreates compose DOM constantly, so we watch for new
// compose bodies via MutationObserver and attach a toolbar to each one once.

const COMPOSE_SELECTOR = 'div[aria-label="Message Body"][contenteditable="true"]';
const ATTACHED = new WeakSet();

// After the extension is reloaded/updated, content scripts already injected
// into open tabs (Gmail is a long-lived SPA — the tab was never reloaded)
// lose their connection to it: chrome.runtime becomes undefined and a raw
// call throws. Guard every access so that's a friendly message, not a crash.
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
    setTimeout(
      () => finish({ ok: false, error: "timeout", timedOut: true }),
      timeoutMs
    );
  });
}

// Wake a sleeping backend the moment Gmail loads, so it's likely already warm
// by the time the user clicks a toolbar button. (No-op if the context is
// already stale — extensionAlive() guards it.)
send({ type: "WARM_UP" });

// Best-effort read of the recipient(s) and subject around this compose box,
// so generation isn't blind to who the email is for — this is the fix for
// generic "Dear Project Manager" filler with no real context. Gmail renders
// recipient chips as <span email="..." name="...">, which is the one stable
// hook across Gmail's frequently-changing DOM; degrades to nothing if not
// found (never breaks the core rewrite feature).
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

function buildToolbar(composeBody) {
  const bar = document.createElement("div");
  bar.className = "af-toolbar";
  // type="button" on every button is load-bearing: Gmail's compose body sits
  // inside a <form>, and a button with no explicit type defaults to
  // type="submit" — clicking it would trigger Gmail's own submit handling
  // instead of ours, which is exactly why clicks looked like they "did
  // nothing." Never omit type="button" here.
  bar.innerHTML = `
    <span class="af-label">AGENTFURY</span>
    <button type="button" data-mode="improve">Improve</button>
    <button type="button" data-mode="shorten">Shorten</button>
    <button type="button" data-mode="formal">Formal</button>
    <button type="button" data-mode="friendly">Friendly</button>
    <button type="button" data-mode="write-toggle">Write for me…</button>
    <span class="af-status"></span>
    <div class="af-write-box">
      <input type="text" placeholder="e.g. politely decline the meeting and ask to reschedule" />
      <button type="button" data-mode="write">Generate</button>
    </div>
  `;

  const status = bar.querySelector(".af-status");
  const writeBox = bar.querySelector(".af-write-box");
  const writeInput = writeBox.querySelector("input");

  const setStatus = (text, isError) => {
    status.textContent = text;
    status.classList.toggle("af-err", !!isError);
  };

  const setBusy = (busy) => {
    bar.querySelectorAll("button").forEach((b) => (b.disabled = busy));
  };

  async function runPolish(mode, instruction) {
    const text = composeBody.innerText.trim();
    if (mode !== "write" && !text) {
      setStatus("Nothing to work with yet — type something first.", true);
      return;
    }
    setBusy(true);
    setStatus("Thinking… (first request can take up to a minute if the server was asleep)");
    const { subject, recipients } = extractContext(composeBody);
    const r = await send({
      type: "API_CALL",
      path: "/write/polish",
      method: "POST",
      body: { text, instruction: instruction || "", mode, subject, recipients },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.contextInvalid) {
        setStatus("AgentFury was updated — refresh this Gmail tab (F5) to keep using it.", true);
      } else if (r.timedOut) {
        setStatus("Still waking up — click the button again, it'll be quick now.", true);
      } else if (r.status === 401) {
        setStatus("Sign in via the AgentFury extension icon first.", true);
      } else {
        setStatus("Failed: " + (r.error || "unknown error") + " — try again.", true);
      }
      return;
    }
    // Replace the compose body content with the result, preserving line breaks.
    composeBody.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, r.data.text);
    setStatus("Done.");
    setTimeout(() => setStatus(""), 2500);
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === "write-toggle") {
      writeBox.classList.toggle("open");
      if (writeBox.classList.contains("open")) writeInput.focus();
      return;
    }
    if (mode === "write") {
      const instruction = writeInput.value.trim();
      if (!instruction) {
        setStatus("Type what the email should say first.", true);
        return;
      }
      runPolish("write", instruction);
      return;
    }
    runPolish(mode, "");
  });

  writeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      bar.querySelector('button[data-mode="write"]').click();
    }
  });

  return bar;
}

function attach(composeBody) {
  if (ATTACHED.has(composeBody)) return;
  ATTACHED.add(composeBody);
  const bar = buildToolbar(composeBody);
  composeBody.parentElement.insertBefore(bar, composeBody);
}

function scan() {
  document.querySelectorAll(COMPOSE_SELECTOR).forEach(attach);
}

const observer = new MutationObserver(() => scan());
observer.observe(document.body, { childList: true, subtree: true });
scan();
