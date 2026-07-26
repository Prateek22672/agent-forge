// AgentFury extension popup — login, a one-shot Quick Ask, pending drafts,
// priority inbox, and a quick reminder — all through the background worker.
//
// DESIGN NOTE: Chrome extension popups fully unload every time they close
// (no state survives), so a "persistent chat" here would be an illusion —
// history would silently vanish the moment the user clicks away. Instead this
// popup does one-shot Q&A for quick asks, and links out to the full web app
// (agentfury.foliofyx.in) for real multi-turn conversations, Autopilot, and
// the Planner — where state actually persists.

const app = document.getElementById("app");
const WEB_URL = "https://agentfury.foliofyx.in";

let state = { user: null, tab: "ask" };

// Theme: dark by default, light optional. Applied to <html data-af-theme="…">
// before anything renders, and kept live so toggling in Settings updates
// immediately without a reopen.
function applyTheme(theme) {
  document.documentElement.setAttribute("data-af-theme", theme === "light" ? "light" : "dark");
}
chrome.storage.local.get("af_theme", (r) => applyTheme(r.af_theme));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "af_theme" in changes) applyTheme(changes.af_theme.newValue);
});

function send(msg, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    chrome.runtime.sendMessage(msg, (r) => {
      if (chrome.runtime.lastError) {
        finish({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      finish(r);
    });
    setTimeout(() => finish({ ok: false, error: "timeout", timedOut: true }), timeoutMs);
  });
}
const api = (path, method = "GET", body) => send({ type: "API_CALL", path, method, body });

async function init() {
  send({ type: "WARM_UP" }); // wake a sleeping backend early
  const status = await send({ type: "GET_TOKEN_STATUS" });
  if (status.ok) {
    state.user = status.user;
    renderApp();
  } else {
    renderLogin();
  }
}

// Live refresh: when the highlight bar saves a reminder/note/brain fact on
// some other tab, that broadcasts here — if we're currently looking at the
// affected tab, re-render it so the new item shows up without the user
// having to switch tabs and back.
const KIND_TO_TAB = { remind: "remind", note: "notes" }; // brain has no dedicated tab yet
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "AF_DATA_CHANGED") return;
    const affected = KIND_TO_TAB[msg.kind];
    if (affected && state.tab === affected) renderApp();
  });
} catch {
  /* not running in an extension context somehow — ignore */
}

// ---------- Login screen ----------
function renderLogin() {
  app.innerHTML = `
    <div class="header">
      <span class="brand">
        <span class="brand-mark">AF</span>
        <span class="brand-name">AgentFury</span>
      </span>
    </div>
    <div class="panel">
      <button id="googleBtn" class="google-btn">
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.1 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.8 1.1 8 3l6-6C34.1 5.1 29.3 3 24 3 16.1 3 9.2 7.5 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 36.4 26.7 37 24 37c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.1 40.5 16 45 24 45z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C40.7 36.1 44 30.6 44 24c0-1.2-.1-2.4-.4-3.5z"/>
        </svg>
        Continue with Google
      </button>
      <div class="or-divider"><span>or</span></div>
      <input id="email" type="email" placeholder="Email" />
      <input id="password" type="password" placeholder="Password" />
      <button id="loginBtn">Sign in</button>
      <div class="msg" id="loginMsg"></div>
      <div class="footer-link" id="openWeb">New here? Open AgentFury to sign up →</div>
    </div>`;
  document.getElementById("openWeb").onclick = () => chrome.tabs.create({ url: WEB_URL });

  const msgEl = document.getElementById("loginMsg");

  document.getElementById("googleBtn").onclick = async () => {
    msgEl.textContent = "Opening Google sign-in…";
    msgEl.className = "msg";
    const r = await send({ type: "GOOGLE_LOGIN" }, 90000); // Google flow needs longer
    if (r.ok) init();
    else {
      msgEl.textContent = typeof r.error === "string" ? r.error : "Google sign-in failed.";
      msgEl.className = "msg error";
    }
  };

  document.getElementById("loginBtn").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    msgEl.textContent = "Signing in…";
    msgEl.className = "msg";
    const r = await send({ type: "LOGIN", email, password });
    if (r.ok) init();
    else {
      msgEl.textContent = r.timedOut
        ? "The server was waking up — try again, it'll be quick now."
        : typeof r.error === "string" ? r.error : "Login failed — check your credentials.";
      msgEl.className = "msg error";
    }
  };
}

// ---------- Main app ----------
function initials(user) {
  const src = (user?.name || user?.email || "?").trim();
  const parts = src.split(/\s+/);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return s.toUpperCase();
}

function renderApp() {
  app.innerHTML = `
    <div class="header">
      <span class="brand">
        <span class="brand-mark">AF</span>
        <span class="brand-name">AgentFury</span>
      </span>
      <div class="header-right">
        <button id="themeToggle" class="iconBtn" title="Switch theme">…</button>
        <span class="avatar" title="${escapeHtml(state.user?.email || "")}">${initials(state.user)}</span>
      </div>
    </div>
    <div class="tabs">
      <div class="tab" data-tab="ask">Ask</div>
      <div class="tab" data-tab="priority">Priority</div>
      <div class="tab" data-tab="drafts">Drafts</div>
      <div class="tab" data-tab="remind">Remind</div>
      <div class="tab" data-tab="notes">Notes</div>
      <div class="tab" data-tab="settings" title="Settings">Settings</div>
    </div>
    <div class="panel" id="panel"></div>`;

  const themeBtn = document.getElementById("themeToggle");
  chrome.storage.local.get("af_theme", (r) => {
    const current = r.af_theme === "light" ? "light" : "dark";
    themeBtn.textContent = current === "dark" ? "Light" : "Dark";
  });
  themeBtn.onclick = () => {
    chrome.storage.local.get("af_theme", (r) => {
      const next = r.af_theme === "light" ? "dark" : "light";
      chrome.storage.local.set({ af_theme: next }, () => {
        themeBtn.textContent = next === "dark" ? "Light" : "Dark";
      });
    });
  };

  document.querySelectorAll(".tab").forEach((el) => {
    el.onclick = () => {
      state.tab = el.dataset.tab;
      renderApp();
    };
  });
  document.querySelector(`.tab[data-tab="${state.tab}"]`).classList.add("active");

  if (state.tab === "ask") renderAsk();
  else if (state.tab === "priority") renderPriority();
  else if (state.tab === "drafts") renderDrafts();
  else if (state.tab === "remind") renderRemind();
  else if (state.tab === "notes") renderNotes();
  else if (state.tab === "settings") renderExtSettings();
}

// ---------- Ask tab: one-shot Q&A (no fake persistence) ----------
let assistantAgentId = null;

const ICONS = {
  priority:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6z"/></svg>',
  drafts:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  remind:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  settings:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.9 7.9 0 000-2l2-1.5-2-3.4-2.4.7a8 8 0 00-1.7-1L15 3h-4l-.3 2.4a8 8 0 00-1.7 1l-2.4-.7-2 3.4L6.6 11a7.9 7.9 0 000 2l-2 1.5 2 3.4 2.4-.7a8 8 0 001.7 1L11 21h4l.3-2.4a8 8 0 001.7-1l2.4.7 2-3.4z"/></svg>',
  notes:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h6M9 16h6"/></svg>',
  send:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
};

async function renderAsk() {
  const panel = document.getElementById("panel");
  const first = (state.user?.name || state.user?.email || "").split(/[\s@]/)[0];
  panel.innerHTML = `
    <div class="af-welcome">
      <div class="af-welcome-title">Welcome${first ? ", " + escapeHtml(first) : ""}</div>
      <div class="af-welcome-sub">Your AI agent for email, reminders, and more.</div>
    </div>
    <div class="af-section-label">Tools</div>
    <div class="tools-grid">
      <button type="button" class="tool-tile" data-tab="priority">${ICONS.priority}<span>Priority</span></button>
      <button type="button" class="tool-tile" data-tab="drafts">${ICONS.drafts}<span>Drafts</span></button>
      <button type="button" class="tool-tile" data-tab="remind">${ICONS.remind}<span>Remind</span></button>
      <button type="button" class="tool-tile" data-tab="notes">${ICONS.notes}<span>Notes</span></button>
      <button type="button" class="tool-tile" data-tab="settings">${ICONS.settings}<span>Settings</span></button>
    </div>
    <div class="af-section-label">Quick ask</div>
    <div id="answerWrap"></div>
    <div class="af-ask-row">
      <textarea id="input" placeholder="Ask AgentFury anything…" rows="1"></textarea>
      <button id="askBtn" class="af-ask-send" title="Ask" aria-label="Ask">${ICONS.send}</button>
    </div>
    <div class="msg" id="askMsg">For back-and-forth conversations, memory, and Autopilot, use the full app.</div>`;

  panel.querySelectorAll(".tool-tile").forEach((t) => {
    t.onclick = () => {
      state.tab = t.dataset.tab;
      renderApp();
    };
  });

  const ask = async () => {
    const input = document.getElementById("input");
    const text = input.value.trim();
    if (!text) return;
    const btn = document.getElementById("askBtn");
    const msgEl = document.getElementById("askMsg");
    const answerWrap = document.getElementById("answerWrap");
    btn.disabled = true;
    btn.classList.add("af-loading");
    msgEl.textContent = "First request can take a bit if the server was asleep.";
    msgEl.className = "msg";

    if (!assistantAgentId) {
      const r = await api("/agents");
      if (r.ok) {
        const assistant = r.data.find((a) => a.name === "Assistant") || r.data[0];
        assistantAgentId = assistant?.id || null;
      }
    }
    if (!assistantAgentId) {
      btn.disabled = false;
      btn.classList.remove("af-loading");
      msgEl.textContent = "Couldn't load your assistant — try Open full app.";
      msgEl.className = "msg error";
      return;
    }

    const r = await api(`/agents/${assistantAgentId}/chat`, "POST", { message: text });
    btn.disabled = false;
    btn.classList.remove("af-loading");
    if (r.ok) {
      answerWrap.innerHTML = `<div class="answer-box">${escapeHtml(r.data.reply)}</div>`;
      msgEl.textContent = "";
      input.value = "";
    } else {
      msgEl.textContent = r.timedOut
        ? "Still waking up — click Ask again, it'll be quick now."
        : "⚠ " + (r.error || "Something went wrong.");
      msgEl.className = "msg error";
    }
  };
  document.getElementById("askBtn").onclick = ask;
  const inputEl = document.getElementById("input");
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  });
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  });
}

// ---------- Priority tab ----------
async function renderPriority() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `<div class="empty">Loading…</div>`;
  const r = await api("/priority");
  if (!r.ok) {
    panel.innerHTML = `<div class="empty">${
      r.timedOut ? "Server was asleep — reopen this tab in a moment." : "Couldn't load. Open the app to check your connection."
    }</div>`;
    return;
  }
  if (!r.data.length) {
    panel.innerHTML = `<div class="empty">No priority mail right now.</div>`;
    return;
  }
  panel.innerHTML = r.data
    .slice(0, 8)
    .map(
      (p) => `<div class="item">
        <div class="title">${escapeHtml(p.subject || "(no subject)")}</div>
        <div class="sub">${escapeHtml(p.sender || "")} · ${escapeHtml(p.category || "")}</div>
      </div>`
    )
    .join("");
}

// ---------- Drafts tab (pending email confirmations) ----------
async function renderDrafts() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `<div class="empty">Loading…</div>`;
  const r = await api("/emails/pending");
  if (!r.ok) {
    panel.innerHTML = `<div class="empty">Couldn't load drafts.</div>`;
    return;
  }
  if (!r.data.length) {
    panel.innerHTML = `<div class="empty">No pending drafts.</div>`;
    return;
  }
  panel.innerHTML = r.data
    .map(
      (d) => `<div class="item" data-id="${d.id}">
        <div class="title">To: ${escapeHtml(d.to_addr)}</div>
        <div class="sub">${escapeHtml(d.subject || "(no subject)")}</div>
        <div class="row">
          <button class="sendD" data-id="${d.id}">Send</button>
          <button class="secondary cancelD" data-id="${d.id}">Cancel</button>
        </div>
      </div>`
    )
    .join("");
  panel.querySelectorAll(".sendD").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      await api(`/emails/${b.dataset.id}/send`, "POST");
      renderDrafts();
    };
  });
  panel.querySelectorAll(".cancelD").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      await api(`/emails/${b.dataset.id}`, "DELETE");
      renderDrafts();
    };
  });
}

// ---------- Remind tab (add form + the actual list — this was missing
// entirely before, which is why saved reminders never "showed up") ----------
async function renderRemind() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `
    <input id="title" placeholder="Remind me to…" />
    <input id="when" placeholder="when (e.g. today 9 PM)" />
    <button id="addBtn">Add reminder</button>
    <div class="msg" id="remMsg"></div>
    <div class="af-section-label">Your reminders</div>
    <div id="remList"><div class="empty">Loading…</div></div>`;

  const loadList = async () => {
    const list = document.getElementById("remList");
    const r = await api("/reminders");
    if (!r.ok) {
      list.innerHTML = `<div class="empty">Couldn't load — try Open full app.</div>`;
      return;
    }
    const items = (r.data || []).filter((it) => it.status !== "done").concat(
      (r.data || []).filter((it) => it.status === "done")
    );
    if (!items.length) {
      list.innerHTML = `<div class="empty">No reminders yet.</div>`;
      return;
    }
    list.innerHTML = items
      .map(
        (it) => `
      <div class="item">
        <div class="title"${it.status === "done" ? ' style="text-decoration:line-through;opacity:.5"' : ""}>${escapeHtml(it.title)}</div>
        ${it.remind_at ? `<div class="sub">${escapeHtml(it.remind_at)}</div>` : ""}
        <div class="row">
          <button type="button" class="secondary toggleBtn" data-id="${it.id}">${it.status === "done" ? "Undo" : "Done"}</button>
          <button type="button" class="secondary delBtn" data-id="${it.id}">Delete</button>
        </div>
      </div>`
      )
      .join("");
    list.querySelectorAll(".toggleBtn").forEach((b) => {
      b.onclick = async () => {
        await api(`/reminders/${b.dataset.id}`, "PATCH");
        loadList();
      };
    });
    list.querySelectorAll(".delBtn").forEach((b) => {
      b.onclick = async () => {
        await api(`/reminders/${b.dataset.id}`, "DELETE");
        loadList();
      };
    });
  };
  loadList();

  document.getElementById("addBtn").onclick = async () => {
    const title = document.getElementById("title").value.trim();
    const when = document.getElementById("when").value.trim();
    const msgEl = document.getElementById("remMsg");
    if (!title) return;
    const r = await api("/reminders", "POST", { title, remind_at: when });
    msgEl.textContent = r.ok ? "Saved." : "Couldn't save — " + (r.error || "");
    msgEl.className = r.ok ? "msg" : "msg error";
    if (r.ok) {
      document.getElementById("title").value = "";
      document.getElementById("when").value = "";
      loadList();
    }
  };
}

// ---------- Notes tab — was completely invisible before: the highlight bar
// could SAVE a note, but there was nowhere in the extension to ever see it. ----------
async function renderNotes() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `
    <input id="noteTitle" placeholder="Note title (optional)" />
    <textarea id="noteContent" placeholder="Write a note…" style="min-height:70px"></textarea>
    <button id="addNoteBtn">Add note</button>
    <div class="msg" id="noteMsg"></div>
    <div class="af-section-label">Your notes</div>
    <div id="noteList"><div class="empty">Loading…</div></div>`;

  const loadList = async () => {
    const list = document.getElementById("noteList");
    const r = await api("/notes");
    if (!r.ok) {
      list.innerHTML = `<div class="empty">Couldn't load — try Open full app.</div>`;
      return;
    }
    const items = r.data || [];
    if (!items.length) {
      list.innerHTML = `<div class="empty">No notes yet — highlight text on any page and tap "Note".</div>`;
      return;
    }
    list.innerHTML = items
      .map(
        (n) => `
      <div class="item">
        <div class="title">${escapeHtml(n.title || "Note")}</div>
        <div class="sub">${escapeHtml((n.content || "").slice(0, 140))}</div>
        <div class="row">
          <button type="button" class="secondary delNote" data-id="${n.id}">Delete</button>
        </div>
      </div>`
      )
      .join("");
    list.querySelectorAll(".delNote").forEach((b) => {
      b.onclick = async () => {
        await api(`/notes/${b.dataset.id}`, "DELETE");
        loadList();
      };
    });
  };
  loadList();

  document.getElementById("addNoteBtn").onclick = async () => {
    const title = document.getElementById("noteTitle").value.trim();
    const content = document.getElementById("noteContent").value.trim();
    const msgEl = document.getElementById("noteMsg");
    if (!title && !content) return;
    const r = await api("/notes", "POST", { title, content });
    msgEl.textContent = r.ok ? "Saved." : "Couldn't save — " + (r.error || "");
    msgEl.className = r.ok ? "msg" : "msg error";
    if (r.ok) {
      document.getElementById("noteTitle").value = "";
      document.getElementById("noteContent").value = "";
      loadList();
    }
  };
}

// ---------- Settings tab ----------
async function renderExtSettings() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `
    <div class="item">
      <div class="title">Account</div>
      <div class="sub">${escapeHtml(state.user?.name || state.user?.email || "")}</div>
      <div class="row">
        <button id="openFull" class="secondary">Open full app ↗</button>
        <button id="logout" class="secondary">Logout</button>
      </div>
    </div>
    <div class="item" id="googleItem">
      <div class="title">Google account</div>
      <div class="sub" id="googleSub">Checking…</div>
      <div class="row">
        <button id="googleBtn" disabled>…</button>
      </div>
      <div class="msg" id="googleMsg"></div>
    </div>
    <div class="item">
      <div class="title">Floating helper bubble</div>
      <div class="sub">A small AF button in the corner of every page — click it to quickly save a note (great for jotting down what you're stuck on while studying).</div>
      <div class="row">
        <button id="bubbleToggle" class="secondary">…</button>
      </div>
    </div>
    <div class="item">
      <div class="title">Select-to-ask</div>
      <div class="sub">Show a small AI bar when you highlight text on any page (including Gmail).</div>
      <div class="row">
        <button id="selectToggle" class="secondary">…</button>
      </div>
    </div>
    <div class="item">
      <div class="title">Privacy mode</div>
      <div class="sub">Removes AgentFury's on-page UI everywhere — for screen-sharing, demos, or recording. Shortcut: Alt+Shift+H. Note this turns the on-page features off while active; nothing can hide a visible element from a screen recorder.</div>
      <div class="row">
        <button id="privacyToggle" class="secondary">…</button>
      </div>
    </div>
    <div class="msg">Toggles take effect immediately on open tabs — no refresh needed.</div>`;

  const pBtn = document.getElementById("privacyToggle");
  const paintPrivacy = (on) => {
    pBtn.textContent = on ? "Hidden — tap to show" : "Visible — tap to hide";
  };
  chrome.storage.local.get("af_privacy_mode", (r) => {
    paintPrivacy(r.af_privacy_mode === true); // default: off (UI visible)
  });
  pBtn.onclick = () => {
    chrome.storage.local.get("af_privacy_mode", (r) => {
      const next = !(r.af_privacy_mode === true);
      chrome.storage.local.set({ af_privacy_mode: next }, () => paintPrivacy(next));
    });
  };

  const bBtn = document.getElementById("bubbleToggle");
  const paintBubble = (enabled) => {
    bBtn.textContent = enabled ? "On — tap to turn off" : "Off — tap to turn on";
  };
  chrome.storage.local.get("af_bubble_enabled", (r) => {
    paintBubble(r.af_bubble_enabled !== false); // default: on
  });
  bBtn.onclick = () => {
    chrome.storage.local.get("af_bubble_enabled", (r) => {
      const next = !(r.af_bubble_enabled !== false);
      chrome.storage.local.set({ af_bubble_enabled: next }, () => paintBubble(next));
    });
  };

  const btn = document.getElementById("selectToggle");
  const paint = (enabled) => {
    btn.textContent = enabled ? "On — tap to turn off" : "Off — tap to turn on";
  };
  chrome.storage.local.get("af_select_enabled", (r) => {
    paint(r.af_select_enabled !== false); // default: on
  });
  btn.onclick = () => {
    chrome.storage.local.get("af_select_enabled", (r) => {
      const next = !(r.af_select_enabled !== false);
      chrome.storage.local.set({ af_select_enabled: next }, () => paint(next));
    });
  };

  document.getElementById("openFull").onclick = () => chrome.tabs.create({ url: WEB_URL });
  document.getElementById("logout").onclick = async () => {
    await send({ type: "LOGOUT" });
    init();
  };

  // Google connection status + the button that actually grants Gmail/Calendar
  // (sign-in alone never does — that's intentional, to keep sign-in warning-free).
  const gSub = document.getElementById("googleSub");
  const gBtn = document.getElementById("googleBtn");
  const gMsg = document.getElementById("googleMsg");

  const r = await api("/connections");
  const services = r.ok ? r.data?.google?.services : null;
  const connected = !!services?.gmail_read;
  gSub.textContent = connected
    ? "Gmail & Calendar connected — Priority and Drafts will work."
    : "Not connected yet — Priority and Drafts need this to read your inbox.";
  gBtn.disabled = false;
  gBtn.textContent = connected ? "Reconnect Google" : "Connect Google (Gmail & Calendar)";

  gBtn.onclick = async () => {
    gBtn.disabled = true;
    gMsg.textContent = "Opening Google…";
    gMsg.className = "msg";
    const cr = await send({ type: "GOOGLE_CONNECT" }, 90000);
    gBtn.disabled = false;
    if (cr.ok) {
      gMsg.textContent = "Connected! Google may have shown an “unverified app” warning — that's expected for a new app; choosing Advanced → Continue is safe.";
      gMsg.className = "msg";
      renderExtSettings();
    } else {
      gMsg.textContent = typeof cr.error === "string" ? cr.error : "Couldn't connect Google.";
      gMsg.className = "msg error";
    }
  };
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

init();
