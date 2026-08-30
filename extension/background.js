// AgentFury extension — background service worker.
// Owns the auth token (chrome.storage) and proxies every API call, so the
// popup and content scripts never touch fetch/CORS/token logic directly.

const API_BASE = "https://agentfury.foliofyx.in/api";

// The toolbar icon opens the SIDE PANEL (chrome.sidePanel) — a native browser
// surface, like DevTools or the bookmarks bar, rendered entirely outside the
// webpage's DOM. Unlike a content-script-injected overlay, no website's JS
// can see, detect, cover, or remove it — it was never part of the page's DOM
// tree to begin with. It also persists while you browse, unlike a popup that
// fully unloads the instant it loses focus.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

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
  const headers = { "Content-Type": "application/json", "X-AF-Client": "extension" };
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

// Multipart file upload → /api/files/extract. Kept separate from apiCall
// because that one JSON-encodes the body; here we send FormData. The popup
// hands us the file bytes (an ArrayBuffer, which passes cleanly through
// chrome messaging) plus the name, and we do the authenticated upload.
async function uploadExtract(name, bytes) {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, error: "not_logged_in" };
  try {
    const fd = new FormData();
    fd.append("file", new Blob([bytes]), name || "file");
    const res = await fetch(`${API_BASE}/files/extract`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "X-AF-Client": "extension" },
      body: fd,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) return { ok: false, status: res.status, error: data?.detail || data || res.statusText };
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

// ---------- Connect Google (Gmail/Calendar) — same mechanism as sign-in, but
// requests the sensitive data scopes and forces the consent screen. This is
// what makes Priority/Drafts actually work from the extension — sign-in alone
// only grants login scopes, on purpose (no "unverified app" warning for the
// common case). Opens in a real browser window (Chrome's own account picker),
// same as the sign-in flow — not an embedded/hidden webview.
async function googleConnect() {
  const idRes = await apiCall("/auth/google/client-id", { auth: false });
  if (!idRes.ok || !idRes.data?.configured) {
    return { ok: false, error: "Google isn't configured on the server." };
  }
  const redirectUri = chrome.identity.getRedirectURL();
  const dataScopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
  ].join(" ");
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: idRes.data.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: dataScopes,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent", // Google's "unverified app" screen appears here — expected
    }).toString();

  let responseUrl;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch (e) {
    return { ok: false, error: "Connection was cancelled or blocked." };
  }
  if (!responseUrl) return { ok: false, error: "Connection was cancelled." };

  const code = new URL(responseUrl).searchParams.get("code");
  if (!code) return { ok: false, error: "Google didn't return an auth code." };

  // Reuses the same exchange endpoint as sign-in — it finds your existing
  // account by email and upgrades its stored Google credentials, then hands
  // back a fresh session token for the same account.
  const r = await apiCall("/auth/google/extension-token", {
    method: "POST",
    body: { code, redirect_uri: redirectUri },
    auth: false,
  });
  if (r.ok) await setToken(r.data.access_token);
  return r;
}

// Single message hub — popup.js and content-gmail.js both talk through this.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "AF_OPEN_PANEL": {
        // Best-effort: opening the side panel programmatically needs a fresh
        // user gesture in some Chrome versions. This is called right from a
        // click handler in the page, so it usually works; if Chrome refuses,
        // we just fail quietly — the toolbar icon always works as a fallback.
        try {
          if (sender?.tab?.id) await chrome.sidePanel.open({ tabId: sender.tab.id });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        return;
      }
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
      case "GOOGLE_CONNECT": {
        sendResponse(await googleConnect());
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
      case "UPLOAD_EXTRACT": {
        const r = await uploadExtract(msg.name, msg.bytes);
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

// ---------- Ambient notifications + badge (daily-use companion) ----------
// While Chrome is open, this extension is a always-on notifier: every minute
// it checks for new priority mail and pending AI drafts, shows a native OS
// notification for anything NEW (deduped via a seen-ids list), and keeps a
// live count badge on the toolbar icon — so the user doesn't have to open
// anything to know something needs attention. This complements (doesn't
// replace) the PWA web push the main app already sends.
const POLL_ALARM = "af-poll";

// Screenshot the visible tab and hand it to the content script, which lets
// the user drag a box over anything on screen and OCRs that region ("snip &
// read"). This is the escape hatch for text that isn't in the DOM at all —
// painted on a canvas, inside a video frame, or in a plugin's own viewport.
//
// captureVisibleTab needs activeTab, which Chrome grants for one tab when the
// user runs a keyboard shortcut or clicks a context-menu item — both of the
// entry points below. That's the whole point: no page can be captured unless
// the user just asked for it, and nothing is captured in the background.
async function runSnip(tabArg) {
  let tab = tabArg;
  if (!tab) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
  }
  if (!tab || tab.id == null) return;
  try {
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    // frameId 0: the screenshot is of the whole viewport, so only the top
    // frame can map a drag back onto it.
    chrome.tabs.sendMessage(tab.id, { type: "AF_SNIP", shot }, { frameId: 0 }).catch(() => {});
  } catch (e) {
    /* restricted page (chrome://, the Web Store) or activeTab not granted */
  }
}

function setupContextMenu() {
  // removeAll first — re-creating with the same id on an extension reload
  // during development otherwise throws "duplicate id".
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError; // clear any pending error, nothing to act on
    const add = (opts) =>
      chrome.contextMenus.create(
        opts,
        () => void chrome.runtime.lastError // e.g. duplicate id on a fast reload — non-fatal, avoids console spam
      );
    add({ id: "af-ask-selection", title: 'Ask AgentFury about "%s"', contexts: ["selection"] });
    // The dependable route to image OCR when the hover badge is awkward to
    // reach — a tiny grid cell, an overlay that eats the pointer, a carousel
    // that moves under the cursor.
    add({ id: "af-image-ocr", title: "Read text in this image (AgentFury)", contexts: ["image"] });
    add({ id: "af-snip", title: "AgentFury: read text on screen…", contexts: ["page", "frame"] });
    // The copy entries are the product's whole promise in a menu item: even
    // where a site has stripped the page's own copy path, the BROWSER's menu
    // is ours to add to, and the clipboard write happens outside the page's
    // reach.
    add({ id: "af-copy", title: "Copy with AgentFury", contexts: ["selection"] });
    add({ id: "af-copy-page", title: "AgentFury: copy all text on this page", contexts: ["page", "frame"] });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  setupContextMenu();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});

async function getSeenIds() {
  const { af_seen_ids } = await chrome.storage.local.get("af_seen_ids");
  return new Set(af_seen_ids || []);
}
async function saveSeenIds(set) {
  // Cap so storage never grows unbounded.
  const arr = Array.from(set).slice(-300);
  await chrome.storage.local.set({ af_seen_ids: arr });
}

async function pollAndNotify() {
  const token = await getToken();
  if (!token) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  const [prio, drafts] = await Promise.all([
    apiCall("/priority"),
    apiCall("/emails/pending"),
  ]);
  if (!prio.ok && !drafts.ok) return; // offline / server asleep — try again next tick

  const priorityItems = prio.ok ? prio.data : [];
  const draftItems = drafts.ok ? drafts.data : [];

  // Badge: total open items needing attention (Gmail-style unread count).
  // Skipped while privacy mode is on — that badge slot is showing "off", and
  // overwriting it here would erase the only toolbar-level clue that the
  // on-page UI is intentionally hidden.
  const { af_privacy_mode } = await chrome.storage.local.get("af_privacy_mode");
  const total = priorityItems.length + draftItems.length;
  if (af_privacy_mode !== true) {
    chrome.action.setBadgeText({ text: total > 0 ? String(total) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  }

  // Notify only for items we haven't already notified about.
  const seen = await getSeenIds();
  const freshPriority = priorityItems.filter((p) => !seen.has("p:" + p.id));
  const freshDrafts = draftItems.filter((d) => !seen.has("d:" + d.id));

  if (freshPriority.length) {
    const first = freshPriority[0];
    chrome.notifications.create(`af-prio-${first.id}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: freshPriority.length === 1 ? "Priority email" : `${freshPriority.length} priority emails`,
      message: freshPriority.length === 1
        ? `${first.subject || "(no subject)"} — ${first.sender || ""}`
        : `Newest: ${first.subject || "(no subject)"}`,
      priority: 2,
    });
  }
  if (freshDrafts.length) {
    const first = freshDrafts[0];
    chrome.notifications.create(`af-draft-${first.id}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: freshDrafts.length === 1 ? "AI drafted a reply" : `${freshDrafts.length} drafts ready`,
      message: `To ${first.to_addr} — review and send from the AgentFury icon.`,
      priority: 1,
    });
  }

  freshPriority.forEach((p) => seen.add("p:" + p.id));
  freshDrafts.forEach((d) => seen.add("d:" + d.id));
  if (freshPriority.length || freshDrafts.length) await saveSeenIds(seen);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollAndNotify().catch(() => {});
});

// Privacy mode shortcut (Alt+Shift+H). Flipping the stored flag is all we do —
// every content script already listens on chrome.storage.onChanged, so this
// takes effect in every open tab at once, no messaging fan-out needed.
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-privacy") {
    const { af_privacy_mode } = await chrome.storage.local.get("af_privacy_mode");
    await chrome.storage.local.set({ af_privacy_mode: !af_privacy_mode });
    return;
  }
  // Alt+Shift+A — open the side panel from anywhere and quietly wake the
  // backend at the same moment, so by the time the panel finishes loading the
  // server (Render free tier) is already spinning up instead of cold. A
  // command counts as a user gesture, which sidePanel.open() requires.
  if (command === "open-assistant") {
    fetch(`${API_BASE}/health`).catch(() => {}); // fire-and-forget wake-up
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id != null) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch (e) {
      /* some pages (chrome://, the store) can't host a panel — nothing to do */
    }
    return;
  }
  // Alt+Shift+F — make the AgentFury bar appear on the current page, asking
  // about whatever is selected (empty & focused if nothing is). Reuses the
  // same content-script entry point as the right-click "Ask AgentFury" menu.
  // "force-copy" ships without a suggested key (Chrome allows only four) —
  // bind it at chrome://extensions/shortcuts. It copies the selection, or the
  // block under the pointer when the page won't allow a selection at all.
  if (command === "force-copy") {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: "AF_FORCE_COPY", text: "" }).catch(() => {});
      }
    } catch (e) {
      /* no content script on this page — nothing to copy from */
    }
    return;
  }
  // Alt+Shift+S — snip any region of the screen and read the text in it.
  if (command === "snip-ocr") {
    await runSnip();
    return;
  }
  if (command === "trigger-ask") {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id != null) {
        chrome.tabs
          .sendMessage(tab.id, { type: "AF_OPEN_SELECTION", text: "" })
          .catch(() => {});
      }
    } catch (e) {
      /* content script not present on this page (chrome://, store) — ignore */
    }
  }
});

// Badge the toolbar icon whenever privacy mode changes, from ANY source (the
// shortcut above, the Settings toggle, the panel banner). Driven off the
// storage change rather than each call site, so no path can flip the mode
// without the indicator following — the failure mode otherwise is a user who
// forgot it's on and thinks the extension is broken.
function paintPrivacyBadge(on) {
  chrome.action.setBadgeText({ text: on ? "off" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
  chrome.action.setTitle({
    title: on
      ? "AgentFury — privacy mode ON (on-page UI hidden). Alt+Shift+H to turn off."
      : "AgentFury — click to open the side panel",
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "af_privacy_mode" in changes) {
    paintPrivacyBadge(changes.af_privacy_mode.newValue === true);
  }
});
chrome.storage.local.get("af_privacy_mode", (r) => paintPrivacyBadge(r.af_privacy_mode === true));

// Clicking a notification opens the app to act on it.
chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://agentfury.foliofyx.in" });
});

// Right-click "Ask AgentFury about…" — relay the selection to the page's
// content-global.js, which opens the ask bar right there.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "af-ask-selection" && tab?.id) {
    chrome.tabs
      .sendMessage(tab.id, { type: "AF_OPEN_SELECTION", text: info.selectionText || "" })
      .catch(() => {});
  }
  if (info.menuItemId === "af-image-ocr" && tab?.id) {
    // Deliver to the frame the image actually lives in, so a picture inside
    // an iframe opens the card in that same frame.
    const opts = info.frameId != null ? { frameId: info.frameId } : undefined;
    chrome.tabs
      .sendMessage(tab.id, { type: "AF_IMAGE_OCR", src: info.srcUrl || "" }, opts)
      .catch(() => {});
  }
  if (info.menuItemId === "af-snip" && tab?.id) runSnip(tab);
  if (info.menuItemId === "af-copy" && tab?.id) {
    const opts = info.frameId != null ? { frameId: info.frameId } : undefined;
    chrome.tabs
      .sendMessage(tab.id, { type: "AF_FORCE_COPY", text: info.selectionText || "" }, opts)
      .catch(() => {});
  }
  if (info.menuItemId === "af-copy-page" && tab?.id) {
    const opts = info.frameId != null ? { frameId: info.frameId } : undefined;
    chrome.tabs.sendMessage(tab.id, { type: "AF_COPY_PAGE" }, opts).catch(() => {});
  }
});

// Run once shortly after the service worker wakes, so the badge is fresh
// even before the first 1-minute alarm fires. MV3 service workers are killed
// after ~30s idle and re-woken by ANY event (a message, an alarm, opening the
// panel), which re-runs this top-level script every time — without a
// throttle this call alone could hit the API many times a minute during
// active browsing, not once. Skip it if we already polled recently.
const MIN_POLL_GAP_MS = 20000;
(async () => {
  const { af_last_poll } = await chrome.storage.local.get("af_last_poll");
  if (af_last_poll && Date.now() - af_last_poll < MIN_POLL_GAP_MS) return;
  await chrome.storage.local.set({ af_last_poll: Date.now() });
  pollAndNotify().catch(() => {});
})();
