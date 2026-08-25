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

let state = { user: null, tab: "chat" };

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
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "AF_DATA_CHANGED") return;
    // Reminders/notes/brain now all live in the unified Activity feed — if it's
    // open, refresh it so items saved from the bar appear immediately.
    if (state.tab === "activity") renderApp();
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
    <div id="privacyBanner"></div>
    <div class="body-row" id="bodyRow">
      <div class="panel" id="panel"></div>
      <div class="rail">
        <button type="button" class="rail-icon" id="railCollapse" title="Hide menu">${ICONS.collapse}</button>
        <button type="button" class="rail-btn" data-tab="chat" title="Chat">${ICONS.chat}<span>Chat</span></button>
        <button type="button" class="rail-btn" data-tab="activity" title="Activity">${ICONS.activity}<span>Activity</span></button>
        <button type="button" class="rail-btn" data-tab="settings" title="Settings">${ICONS.settings}<span>Settings</span></button>
        <div class="rail-spacer"></div>
        <button type="button" class="rail-profile" id="railProfile" title="Account">${initials(state.user)}</button>
      </div>
      <button type="button" class="rail-reopen" id="railReopen" title="Show menu">${ICONS.expand}</button>
      <div class="profile-pop" id="profilePop" hidden>
        <div class="pp-name">${escapeHtml(state.user?.name || "Signed in")}</div>
        <div class="pp-email">${escapeHtml(state.user?.email || "")}</div>
        <button type="button" class="pp-btn" id="ppOpenApp">Open full app ↗</button>
        <button type="button" class="pp-btn pp-logout" id="ppLogout">Log out</button>
      </div>
    </div>`;

  // Privacy mode silently removes the on-page UI everywhere, which looks
  // exactly like "the extension broke" if you forgot it was on. Always show a
  // dismissible-by-fixing banner while it's active, and keep it live so it
  // appears/disappears the moment the mode is toggled from anywhere.
  const banner = document.getElementById("privacyBanner");
  const paintBanner = (on) => {
    banner.innerHTML = on
      ? `<div class="af-banner">
           Privacy mode is ON — the on-page bar and bubble are hidden on every site.
           <button type="button" id="bannerOff">Turn off</button>
         </div>`
      : "";
    const off = document.getElementById("bannerOff");
    if (off) off.onclick = () => chrome.storage.local.set({ af_privacy_mode: false });
  };
  chrome.storage.local.get("af_privacy_mode", (r) => paintBanner(r.af_privacy_mode === true));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "af_privacy_mode" in changes) {
      paintBanner(changes.af_privacy_mode.newValue === true);
    }
  });

  document.querySelectorAll(".rail-btn").forEach((el) => {
    el.onclick = () => {
      state.tab = el.dataset.tab;
      renderApp();
    };
  });
  const activeEl = document.querySelector(`.rail-btn[data-tab="${state.tab}"]`);
  if (activeEl) activeEl.classList.add("active");
  else document.querySelector('.rail-btn[data-tab="chat"]').classList.add("active");

  // Collapse / reopen the right rail (gives the chat the full width).
  const bodyRow = document.getElementById("bodyRow");
  const applyRail = (open) => bodyRow.setAttribute("data-rail", open ? "open" : "closed");
  chrome.storage.local.get("af_rail_open", (r) => applyRail(r.af_rail_open !== false));
  document.getElementById("railCollapse").onclick = () =>
    chrome.storage.local.set({ af_rail_open: false }, () => applyRail(false));
  document.getElementById("railReopen").onclick = () =>
    chrome.storage.local.set({ af_rail_open: true }, () => applyRail(true));

  // Profile popup — account details + logout, opened from the avatar.
  const pop = document.getElementById("profilePop");
  const profBtn = document.getElementById("railProfile");
  profBtn.onclick = (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  };
  document.addEventListener("click", (e) => {
    if (!pop.hidden && e.target !== profBtn && !pop.contains(e.target)) pop.hidden = true;
  });
  document.getElementById("ppOpenApp").onclick = () => chrome.tabs.create({ url: WEB_URL });
  document.getElementById("ppLogout").onclick = async () => {
    await send({ type: "LOGOUT" });
    state.user = null;
    renderLogin();
  };

  if (state.tab === "activity") renderActivity();
  else if (state.tab === "settings") renderExtSettings();
  else renderChat();
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
  chat:
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.9 8.9 0 0 1-4-.9L3 20l1-4.5A8.4 8.4 0 0 1 3 11.5 8.4 8.4 0 0 1 11.5 3 8.4 8.4 0 0 1 21 11.5z"/></svg>',
  activity:
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  collapse:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  expand:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
};

// ---------- Chat: a real multi-turn conversation with your agent ----------
// This is the panel's reason to exist — the on-page bar gives quick one-shot
// answers; here you have a back-and-forth that remembers context (threaded via
// conversation_id) and can use tools: "remind me to…", "search for…", "draft a
// reply to…". Depth over speed; that's the split.
let chatHistory = []; // {role, content} for this panel session
let chatConvoId = null; // server conversation id → real memory across turns

async function renderChat() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `
    <div id="chatMsgs" class="chat-msgs"></div>
    <div class="af-ask-row">
      <textarea id="input" placeholder="Message your assistant…" rows="1"></textarea>
      <button id="askBtn" class="af-ask-send" title="Send" aria-label="Send">${ICONS.send}</button>
    </div>
    <div class="chat-hint">It can search, remind, and draft — just ask. <a href="#" id="openFullChat">Open full app ↗</a></div>`;

  const msgsEl = document.getElementById("chatMsgs");
  const inputEl = document.getElementById("input");
  const btn = document.getElementById("askBtn");

  const first = (state.user?.name || state.user?.email || "").split(/[\s@]/)[0];
  const paintMsgs = () => {
    if (!chatHistory.length) {
      msgsEl.innerHTML = `<div class="chat-welcome">
        <div class="cw-hi">Hi${first ? ", " + escapeHtml(first) : ""}</div>
        <div class="cw-sub">How can I help you study today?</div>
        <div class="cw-tiles">
          <button type="button" class="cw-tile" data-tpl="Make flashcards (question on the front, answer on the back) from this:\n\n">Flashcards</button>
          <button type="button" class="cw-tile" data-tpl="Explain this simply, as if I'm new to it:\n\n">Explain simply</button>
          <button type="button" class="cw-tile" data-tpl="Turn this into concise study notes with clear headings and bullet points:\n\n">Study notes</button>
          <button type="button" class="cw-tile" data-tpl="Quiz me with 5 questions on this, one at a time, and wait for my answer:\n\n">Quiz me</button>
        </div>
        <div class="cw-tip">Tip: paste your material after picking one, or just type anything.</div>
      </div>`;
      msgsEl.querySelectorAll(".cw-tile").forEach((t) => {
        t.onclick = () => {
          inputEl.value = t.dataset.tpl;
          inputEl.style.height = "auto";
          inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
          inputEl.focus();
          inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
        };
      });
      return;
    }
    msgsEl.innerHTML = chatHistory
      .map((m) => {
        const body =
          m.content === "…"
            ? '<span class="chat-typing"><i></i><i></i><i></i></span>'
            : m.role === "user"
            ? escapeHtml(m.content).replace(/\n/g, "<br>")
            : mdToHtml(m.content); // render the assistant's markdown (tables, bold, lists)
        return `<div class="chat-bubble ${m.role === "user" ? "me" : "ai"}">${body}</div>`;
      })
      .join("");
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };
  paintMsgs();

  document.getElementById("openFullChat").onclick = (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: WEB_URL });
  };

  const autoSize = () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  };
  inputEl.addEventListener("input", autoSize);

  // A selection handed over via the on-page "Open ↗" chip prefills the box.
  try {
    chrome.storage.local.get("af_pending_selection", (r) => {
      if (r.af_pending_selection) {
        inputEl.value = r.af_pending_selection;
        autoSize();
        inputEl.focus();
        chrome.storage.local.remove("af_pending_selection");
      }
    });
  } catch {
    /* none */
  }

  const sendMsg = async () => {
    const text = inputEl.value.trim();
    if (!text) return;
    chatHistory.push({ role: "user", content: text });
    chatHistory.push({ role: "assistant", content: "…" });
    inputEl.value = "";
    autoSize();
    btn.disabled = true;
    paintMsgs();

    if (!assistantAgentId) {
      const r = await api("/agents");
      if (r.ok) {
        const a = r.data.find((x) => x.name === "Assistant") || r.data[0];
        assistantAgentId = a?.id || null;
      }
    }
    let reply;
    if (!assistantAgentId) {
      reply = "Couldn't load your assistant — try Open full app.";
    } else {
      const r = await api(`/agents/${assistantAgentId}/chat`, "POST", {
        message: text,
        conversation_id: chatConvoId, // thread it → the agent remembers the chat
      });
      if (r.ok) {
        reply = r.data.reply;
        chatConvoId = r.data.conversation_id || chatConvoId;
      } else {
        reply = r.timedOut
          ? "Still waking up — send again, it'll be quick now."
          : "⚠ " + (r.error || "Something went wrong.");
      }
    }
    chatHistory[chatHistory.length - 1] = { role: "assistant", content: reply };
    btn.disabled = false;
    paintMsgs();
  };

  btn.onclick = sendMsg;
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });
}

// ---------- Activity: one glanceable feed instead of four half-empty tabs ----
// Priority mail, pending drafts, reminders, and notes in a single scroll — the
// panel's job is a quick glance + quick action, not full management (that's the
// web app). Creation happens from chat or the on-page bar.
async function renderActivity() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `<div class="empty">Loading…</div>`;
  const [prio, drafts, rem, notes] = await Promise.all([
    api("/priority"),
    api("/emails/pending"),
    api("/reminders"),
    api("/notes"),
  ]);

  const sections = [];

  if (prio.ok && prio.data.length) {
    sections.push(
      `<div class="af-section-label">Priority mail</div>` +
        prio.data
          .slice(0, 6)
          .map(
            (p) => `<div class="item"><div class="title">${escapeHtml(p.subject || "(no subject)")}</div>
            <div class="sub">${escapeHtml(p.sender || "")}${p.category ? " · " + escapeHtml(p.category) : ""}</div></div>`
          )
          .join("")
    );
  }

  if (drafts.ok && drafts.data.length) {
    sections.push(
      `<div class="af-section-label">Drafts to review</div>` +
        drafts.data
          .map(
            (d) => `<div class="item" data-id="${d.id}"><div class="title">To: ${escapeHtml(d.to_addr)}</div>
            <div class="sub">${escapeHtml(d.subject || "(no subject)")}</div>
            <div class="row"><button class="sendD" data-id="${d.id}">Send</button>
            <button class="secondary cancelD" data-id="${d.id}">Cancel</button></div></div>`
          )
          .join("")
    );
  }

  if (rem.ok && rem.data.length) {
    const items = rem.data
      .filter((it) => it.status !== "done")
      .concat(rem.data.filter((it) => it.status === "done"))
      .slice(0, 8);
    sections.push(
      `<div class="af-section-label">Reminders</div>` +
        items
          .map(
            (it) => `<div class="item"><div class="title"${it.status === "done" ? ' style="text-decoration:line-through;opacity:.5"' : ""}>${escapeHtml(it.title)}</div>
            ${it.remind_at ? `<div class="sub">${escapeHtml(it.remind_at)}</div>` : ""}
            <div class="row"><button type="button" class="secondary remToggle" data-id="${it.id}">${it.status === "done" ? "Undo" : "Done"}</button>
            <button type="button" class="secondary remDel" data-id="${it.id}">Delete</button></div></div>`
          )
          .join("")
    );
  }

  if (notes.ok && notes.data.length) {
    sections.push(
      `<div class="af-section-label">Notes</div>` +
        notes.data
          .slice(0, 8)
          .map(
            (n) => `<div class="item"><div class="title">${escapeHtml(n.title || "Note")}</div>
            <div class="sub">${escapeHtml((n.content || "").slice(0, 120))}</div>
            <div class="row"><button type="button" class="secondary noteDel" data-id="${n.id}">Delete</button></div></div>`
          )
          .join("")
    );
  }

  panel.innerHTML = sections.length
    ? sections.join("")
    : `<div class="empty">Nothing here yet.<br>Highlight text on any page and choose Save, or ask your assistant to remind you about something.</div>`;

  // Wire quick actions
  panel.querySelectorAll(".sendD").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      await api(`/emails/${b.dataset.id}/send`, "POST");
      renderActivity();
    };
  });
  panel.querySelectorAll(".cancelD").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      await api(`/emails/${b.dataset.id}`, "DELETE");
      renderActivity();
    };
  });
  panel.querySelectorAll(".remToggle").forEach((b) => {
    b.onclick = async () => {
      await api(`/reminders/${b.dataset.id}`, "PATCH");
      renderActivity();
    };
  });
  panel.querySelectorAll(".remDel").forEach((b) => {
    b.onclick = async () => {
      await api(`/reminders/${b.dataset.id}`, "DELETE");
      renderActivity();
    };
  });
  panel.querySelectorAll(".noteDel").forEach((b) => {
    b.onclick = async () => {
      await api(`/notes/${b.dataset.id}`, "DELETE");
      renderActivity();
    };
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
      <div class="title">Appearance</div>
      <div class="sub">Switch between dark and light theme.</div>
      <div class="row">
        <button id="themeToggle" class="secondary">…</button>
      </div>
    </div>
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
    <div class="item">
      <div class="title">Keyboard shortcuts</div>
      <div class="sub" style="line-height:1.7">
        <b>Alt+Shift+F</b> — show the AgentFury bar on the page<br>
        <b>Alt+Shift+A</b> — open this side panel<br>
        <b>Alt+Shift+H</b> — privacy mode (hide on-page UI)
      </div>
      <div class="row">
        <button type="button" id="customizeKeys" class="secondary">Customize shortcuts</button>
      </div>
    </div>
    <div class="msg">Toggles take effect immediately on open tabs — no refresh needed.</div>`;

  const ck = document.getElementById("customizeKeys");
  if (ck) ck.onclick = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" });

  const themeBtn = document.getElementById("themeToggle");
  const paintTheme = (t) =>
    (themeBtn.textContent = t === "light" ? "Switch to dark" : "Switch to light");
  chrome.storage.local.get("af_theme", (r) => paintTheme(r.af_theme === "light" ? "light" : "dark"));
  themeBtn.onclick = () => {
    chrome.storage.local.get("af_theme", (r) => {
      const next = r.af_theme === "light" ? "dark" : "light";
      chrome.storage.local.set({ af_theme: next }, () => paintTheme(next));
    });
  };

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
  const lab = document.getElementById("captureLab");
  if (lab) {
    lab.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL("experiment.html") });
    };
  }

  const bBtn = document.getElementById("bubbleToggle");
  const paintBubble = (enabled) => {
    bBtn.textContent = enabled ? "On — tap to turn off" : "Off — tap to turn on";
  };
  chrome.storage.local.get("af_bubble_enabled", (r) => {
    paintBubble(r.af_bubble_enabled === true); // default: OFF (opt-in)
  });
  bBtn.onclick = () => {
    chrome.storage.local.get("af_bubble_enabled", (r) => {
      const next = !(r.af_bubble_enabled === true);
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

// Lightweight, XSS-safe markdown → HTML for chat bubbles. Escapes first, then
// adds tags — so the AI's tables/bold/lists render cleanly instead of showing
// raw "| From | Subject |" and "**text**". Handles the cases the assistant
// actually produces: tables, headers, bold/italic/code, links, and lists.
function mdToHtml(src) {
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(?!\s)([^*]+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const lines = String(src).replace(/\r/g, "").split("\n");
  const isSep = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");
  const cells = (l) => {
    const c = l.split("|").map((s) => s.trim());
    if (c[0] === "") c.shift();
    if (c.length && c[c.length - 1] === "") c.pop();
    return c;
  };
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|")) rows.push(cells(lines[i++]));
      html +=
        '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
        header.map((h) => `<th>${inline(h)}</th>`).join("") +
        "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table></div>";
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      html += `<div class="md-h">${inline(h[2])}</div>`;
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*[-*]\s+/, "")));
      html += "<ul>" + items.map((x) => `<li>${x}</li>`).join("") + "</ul>";
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*\d+\.\s+/, "")));
      html += "<ol>" + items.map((x) => `<li>${x}</li>`).join("") + "</ol>";
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isSep(lines[i + 1]))
    ) {
      para.push(lines[i++]);
    }
    html += `<p>${para.map(inline).join("<br>")}</p>`;
  }
  return html;
}

init();
