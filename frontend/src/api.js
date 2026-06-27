// Thin wrapper around the backend REST API. Every call goes through /api,
// which Vite proxies to the FastAPI server (see vite.config.js).

const TOKEN_KEY = "agentforge_token";
const ADMIN_TOKEN_KEY = "agentforge_admin_token";

export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// Separate session for the /admin console (its own dj/dj login).
export const adminAuth = {
  get: () => localStorage.getItem(ADMIN_TOKEN_KEY),
  set: (t) => localStorage.setItem(ADMIN_TOKEN_KEY, t),
  clear: () => localStorage.removeItem(ADMIN_TOKEN_KEY),
};

// Admin HTTP — sends the ADMIN token (not the user token).
async function ahttp(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = adminAuth.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    adminAuth.clear();
    window.dispatchEvent(new Event("agentforge:admin-unauthorized"));
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function http(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = auth.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    auth.clear();
    window.dispatchEvent(new Event("agentforge:unauthorized"));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: () => http("GET", "/health"),
  listTools: () => http("GET", "/tools"),
  listModels: () => http("GET", "/models"),

  // Auth
  signup: (data) => http("POST", "/auth/signup", data),
  login: (data) => http("POST", "/auth/login", data),
  me: () => http("GET", "/auth/me"),
  updateProfile: (data) => http("PATCH", "/auth/me", data),
  googleAuthConfigured: () => http("GET", "/auth/google/configured"),
  googleAuthStart: (desktop) =>
    http("GET", `/auth/google/start${desktop ? "?desktop=true" : ""}`),

  listAgents: () => http("GET", "/agents"),
  createAgent: (data) => http("POST", "/agents", data),
  updateAgent: (id, data) => http("PATCH", `/agents/${id}`, data),
  deleteAgent: (id) => http("DELETE", `/agents/${id}`),

  chat: (agentId, message, conversationId) =>
    http("POST", `/agents/${agentId}/chat`, {
      message,
      conversation_id: conversationId,
    }),
  listConversations: (agentId) =>
    http("GET", `/agents/${agentId}/conversations`),
  listAllConversations: () => http("GET", "/conversations"),
  getMessages: (conversationId) =>
    http("GET", `/conversations/${conversationId}/messages`),
  deleteConversation: (id) => http("DELETE", `/conversations/${id}`),

  // Trackers
  listReminders: () => http("GET", "/reminders"),
  createReminder: (data) => http("POST", "/reminders", data),
  toggleReminder: (id) => http("PATCH", `/reminders/${id}`),
  deleteReminder: (id) => http("DELETE", `/reminders/${id}`),
  listNotes: () => http("GET", "/notes"),
  createNote: (data) => http("POST", "/notes", data),
  deleteNote: (id) => http("DELETE", `/notes/${id}`),
  markReminderNotified: (id) => http("POST", `/reminders/${id}/notified`),

  // Brain (personal knowledge)
  listBrain: () => http("GET", "/brain"),
  addBrain: (text) => http("POST", "/brain", { text }),
  deleteBrain: (id) => http("DELETE", `/brain/${id}`),

  // Outgoing email (secure, user-confirmed)
  pendingEmails: () => http("GET", "/emails/pending"),
  sendEmail: (id) => http("POST", `/emails/${id}/send`),
  cancelEmail: (id) => http("DELETE", `/emails/${id}`),

  // Admin console (separate /admin login; keys returned masked, never in full)
  adminLogin: (username, password) =>
    http("POST", "/admin/login", { username, password }),
  adminInsights: () => ahttp("GET", "/admin/insights"),
  adminAddKey: (provider, key) => ahttp("POST", "/admin/keys", { provider, key }),
  adminRemoveKey: (provider, suffix) =>
    ahttp("DELETE", `/admin/keys/${provider}/${suffix}`),
  adminUsers: () => ahttp("GET", "/admin/users"),
  adminSetAdmin: (id, is_admin) => ahttp("PATCH", `/admin/users/${id}`, { is_admin }),
  adminDeleteUser: (id) => ahttp("DELETE", `/admin/users/${id}`),

  // Settings (model provider toggle)
  getSettings: () => http("GET", "/settings"),
  updateSettings: (data) => http("PUT", "/settings", data),

  // Connections (Google)
  getConnections: () => http("GET", "/connections"),
  googleStart: (desktop) =>
    http("GET", `/connections/google/start${desktop ? "?desktop=true" : ""}`),
  googleDisconnect: () => http("DELETE", "/connections/google"),
};
