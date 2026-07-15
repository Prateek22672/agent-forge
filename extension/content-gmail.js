// AgentFury — injects an AI toolbar into every Gmail compose box:
// Improve / Shorten / Formal / Friendly (rewrite what's there) and
// Write for me (generate a full draft from a one-line instruction).
//
// Gmail is a SPA that recreates compose DOM constantly, so we watch for new
// compose bodies via MutationObserver and attach a toolbar to each one once.

const COMPOSE_SELECTOR = 'div[aria-label="Message Body"][contenteditable="true"]';
const ATTACHED = new WeakSet();

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function buildToolbar(composeBody) {
  const bar = document.createElement("div");
  bar.className = "af-toolbar";
  bar.innerHTML = `
    <span class="af-label">✨ AGENTFURY</span>
    <button data-mode="improve">Improve</button>
    <button data-mode="shorten">Shorten</button>
    <button data-mode="formal">Formal</button>
    <button data-mode="friendly">Friendly</button>
    <button data-mode="write-toggle">Write for me…</button>
    <span class="af-status"></span>
    <div class="af-write-box">
      <input type="text" placeholder="e.g. politely decline the meeting and ask to reschedule" />
      <button data-mode="write">Generate</button>
    </div>
  `;

  const status = bar.querySelector(".af-status");
  const writeBox = bar.querySelector(".af-write-box");
  const writeInput = writeBox.querySelector("input");

  const setStatus = (text, isError) => {
    status.textContent = text;
    status.style.color = isError ? "#f87171" : "";
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
    setStatus("Thinking…");
    const r = await send({
      type: "API_CALL",
      path: "/write/polish",
      method: "POST",
      body: { text, instruction: instruction || "", mode },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) {
        setStatus("Sign in via the AgentFury extension icon first.", true);
      } else {
        setStatus("Failed: " + (r.error || "unknown error"), true);
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
