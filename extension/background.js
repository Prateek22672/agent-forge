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

// ---------- Google sign-in via chrome.identity.launchWebAuthFlow ----------
// Extensions can't use the website's redirect-to-a-page flow, so Chrome gives
// this extension its own https://<ext-id>.chromiumapp.org/ redirect URI, and
// hands the final redirect URL straight back to us in JS — no page needed.
// Login-first, same as the website: only requests non-sensitive scopes, so
// there's no "unverified app" warning on this button.
async function googleLogin() {
  const idRes = await apiCall("/auth/google/client-id", { auth: false });
  if (!idRes.ok || !idRes.data?.configured) {
    return { ok: false, error: "Google sign-in isn't configured on the server." };
  }
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: idRes.data.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
    }).toString();

  let responseUrl;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });
  } catch (e) {
    return { ok: false, error: "Google sign-in was cancelled or blocked." };
  }
  if (!responseUrl) return { ok: false, error: "Google sign-in was cancelled." };

  const code = new URL(responseUrl).searchParams.get("code");
  if (!code) return { ok: false, error: "Google didn't return an auth code." };

  const r = await apiCall("/auth/google/extension-token", {
    method: "POST",
    body: { code, redirect_uri: redirectUri },
    auth: false,
  });
  if (r.ok) await setToken(r.data.access_token);
  return r;
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
      case "GOOGLE_LOGIN": {
        sendResponse(await googleLogin());
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
      case "WARM_UP": {
        // Fire-and-forget ping so a cold Render free-tier instance is already
        // waking up by the time the user actually clicks a button.
        fetch(`${API_BASE}/health`).catch(() => {});
        sendResponse({ ok: true });
        return;
      }
      default:
        sendResponse({ ok: false, error: "unknown_message" });
    }
  })();
  return true; // async response
});
