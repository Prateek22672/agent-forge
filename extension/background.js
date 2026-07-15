// AgentFury extension — background service worker.
// Owns the auth token (chrome.storage) and proxies every API call, so the
// popup and content scripts never touch fetch/CORS/token logic directly.

const API_BASE = "https://agentfury.foliofyx.in/api";

async function getToken() {
  const { af_token } = await chrome.storage.local.get("af_token");
  return af_token || null;
}

async function setToken(token) {
  await chrome.storage.local.set({ af_token: token });
}

async function clearToken() {
  await chrome.storage.local.remove("af_token");
}

async function apiCall(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (!token) return { ok: false, status: 401, error: "not_logged_in" };
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      if (res.status === 401) await clearToken();
      return { ok: false, status: res.status, error: data?.detail || data || res.statusText };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  }
}

// Single message hub — popup.js and content-gmail.js both talk through this.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "LOGIN": {
        const r = await apiCall("/auth/login", {
          method: "POST",
          body: { email: msg.email, password: msg.password },
          auth: false,
        });
        if (r.ok) await setToken(r.data.access_token);
        sendResponse(r);
        return;
      }
      case "GET_TOKEN_STATUS": {
        const token = await getToken();
        if (!token) return sendResponse({ ok: false });
        const me = await apiCall("/auth/me");
        sendResponse(me.ok ? { ok: true, user: me.data } : { ok: false });
        return;
      }
      case "LOGOUT": {
        await clearToken();
        sendResponse({ ok: true });
        return;
      }
      case "API_CALL": {
        const r = await apiCall(msg.path, { method: msg.method, body: msg.body });
        sendResponse(r);
        return;
      }
      default:
        sendResponse({ ok: false, error: "unknown_message" });
    }
  })();
  return true; // async response
});
