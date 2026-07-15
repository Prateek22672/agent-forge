// AgentFury extension popup — login, quick chat (Assistant), pending drafts,
// priority inbox, and a quick reminder — all through the background worker.

const app = document.getElementById("app");
const WEB_URL = "https://agentfury.foliofyx.in";

let state = {
  user: null,
  tab: "chat",
  assistantAgentId: null,
  chatLog: [],
  conversationId: null,
};

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}
const api = (path, method = "GET", body) =>
  send({ type: "API_CALL", path, method, body });

async function init() {
  const status = await send({ type: "GET_TOKEN_STATUS" });
  if (status.ok) {
    state.user = status.user;
    renderApp();
  } else {
    renderLogin();
  }
}

// ---------- Login screen ----------
function renderLogin() {
  app.innerHTML = `
    <div class="header"><span class="brand">AGENTFURY</span></div>
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
  document.getElementById("openWeb").onclick = () =>
    chrome.tabs.create({ url: WEB_URL });

  const msgEl = document.getElementById("loginMsg");

  document.getElementById("googleBtn").onclick = async () => {
    msgEl.textContent = "Opening Google sign-in…";
    msgEl.className = "msg";
    const r = await send({ type: "GOOGLE_LOGIN" });
    if (r.ok) {
      init();
    } else {
      msgEl.textContent =
        typeof r.error === "string" ? r.error : "Google sign-in failed.";
      msgEl.className = "msg error";
    }
  };

  document.getElementById("loginBtn").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    msgEl.textContent = "Signing in…";
    msgEl.className = "msg";
    const r = await send({ type: "LOGIN", email, password });
    if (r.ok) {
      init();
    } else {
      msgEl.textContent =
        typeof r.error === "string" ? r.error : "Login failed — check your credentials.";
      msgEl.className = "msg error";
    }
  };
}

// ---------- Main app ----------
function renderApp() {
  app.innerHTML = `
    <div class="header">
      <span class="brand">AGENTFURY</span>
      <span class="footer-link" id="logout" style="padding:0">Logout</span>
    </div>
    <div class="tabs">
      <div class="tab" data-tab="chat">Chat</div>
      <div class="tab" data-tab="priority">Priority</div>
      <div class="tab" data-tab="drafts">Drafts</div>
      <div class="tab" data-tab="remind">Remind</div>
    </div>
    <div class="panel" id="panel"></div>`;
  document.getElementById("logout").onclick = async () => {
    await send({ type: "LOGOUT" });
    init();
  };
  document.querySelectorAll(".tab").forEach((el) => {
    el.onclick = () => {
      state.tab = el.dataset.tab;
      renderApp();
    };
  });
  document.querySelector(`.tab[data-tab="${state.tab}"]`).classList.add("active");

  if (state.tab === "chat") renderChat();
  else if (state.tab === "priority") renderPriority();
  else if (state.tab === "drafts") renderDrafts();
  else if (state.tab === "remind") renderRemind();
}

// ---------- Chat tab ----------
async function renderChat() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `<div class="chat-log" id="log"></div>
    <textarea id="input" placeholder="Ask AgentFury…"></textarea>
    <button id="sendBtn">Send</button>`;
  paintChatLog();

  if (!state.assistantAgentId) {
    const r = await api("/agents");
    if (r.ok) {
      const assistant = r.data.find((a) => a.name === "Assistant") || r.data[0];
      state.assistantAgentId = assistant?.id || null;
    }
  }

  const send_ = async () => {
    const input = document.getElementById("input");
    const text = input.value.trim();
    if (!text || !state.assistantAgentId) return;
    input.value = "";
    state.chatLog.push({ role: "user", content: text });
    paintChatLog();
    const btn = document.getElementById("sendBtn");
    btn.disabled = true;
    btn.textContent = "…";
    const r = await api(`/agents/${state.assistantAgentId}/chat`, "POST", {
      message: text,
      conversation_id: state.conversationId,
    });
    btn.disabled = false;
    btn.textContent = "Send";
    if (r.ok) {
      state.conversationId = r.data.conversation_id;
      state.chatLog.push({ role: "ai", content: r.data.reply });
    } else {
      state.chatLog.push({ role: "ai", content: "⚠ " + (r.error || "Something went wrong.") });
    }
    paintChatLog();
  };
  document.getElementById("sendBtn").onclick = send_;
  document.getElementById("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send_();
    }
  });
}
function paintChatLog() {
  const log = document.getElementById("log");
  if (!log) return;
  log.innerHTML = state.chatLog.length
    ? state.chatLog
        .map((m) => `<div class="bubble ${m.role}">${escapeHtml(m.content)}</div>`)
        .join("")
    : `<div class="empty">Ask anything — research, email, reminders…</div>`;
  log.scrollTop = log.scrollHeight;
}

// ---------- Priority tab ----------
async function renderPriority() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `<div class="empty">Loading…</div>`;
  const r = await api("/priority");
  if (!r.ok) {
    panel.innerHTML = `<div class="empty">Couldn't load. Open the app to check your connection.</div>`;
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

// ---------- Remind tab (quick add) ----------
function renderRemind() {
  const panel = document.getElementById("panel");
  panel.innerHTML = `
    <input id="title" placeholder="Remind me to…" />
    <input id="when" placeholder="when (e.g. today 9 PM)" />
    <button id="addBtn">Add reminder</button>
    <div class="msg" id="remMsg"></div>`;
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
    }
  };
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

init();
