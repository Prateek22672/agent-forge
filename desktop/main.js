// AgentFury desktop (Electron) — native shell over the live cloud app.
//
// Why this design: you already run the backend in the cloud (Render) and the UI
// on Vercel. The desktop app loads that same app, so accounts + data are shared
// with the web version (nothing to bundle, nothing to sync). What the desktop
// shell ADDS over a browser tab:
//   • a real installed app (Start menu / dock) with a system tray
//   • it keeps running in the tray, so the in-app reminder poller fires REAL OS
//     notifications even when the window is closed
//   • silent auto-update from GitHub Releases
//
// Set APP_URL to your Vercel URL (or pass AGENTFURY_URL at runtime).

const {
  app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain,
  globalShortcut, screen, clipboard,
} = require("electron");
const path = require("path");
const { execFile } = require("child_process");
const { startLocalBackend, stopLocalBackend } = require("./local-backend");
const fileSearch = require("./file-search");
const contentIndex = require("./content-index");
const settings = require("./settings");

// Custom protocol used to bring the Google sign-in back from the system browser
// into this app (see handleDeepLink). Registering early is important on Windows.
const PROTOCOL = "agentforge";
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Your deployed app (override at runtime with AGENTFURY_URL if needed).
const APP_URL = process.env.AGENTFURY_URL || "https://agentfury.foliofyx.in";

let mainWindow = null;
let spotWindow = null;
let tray = null;
let quitting = false;

// Required on Windows so OS notifications show the app name/icon correctly.
app.setAppUserModelId("com.agentforge.app");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "AgentFury",
    autoHideMenuBar: true,
    webPreferences: {
      // WITHOUT THIS the web app cannot tell it is running in the desktop shell:
      // window.agentforge is undefined, so it asks the backend for a *browser*
      // sign-in URL (desktop=false). Google's consent then completes in the
      // browser and logs the WEBSITE in, while this window sits on the login
      // screen forever — the deep link back to the app is never requested.
      // It also powers ringAlarm(), so reminders can raise the window.
      preload: path.join(__dirname, "preload.js"),
      // Keep timers (the reminder poller) running when the window is hidden in
      // the tray — this is what lets reminders fire in the background.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Branded splash first, then the app — so the window never flashes blank
  // (and stays friendly during the ~50s the free backend takes to wake).
  const SPLASH =
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      "<body style='margin:0;background:#000;color:#fff;font-family:system-ui;" +
        "display:flex;align-items:center;justify-content:center;height:100vh'>" +
        "<div style='text-align:center'><div style='letter-spacing:.35em;" +
        "font-weight:600'>AGENTFURY</div><div style='margin-top:14px;color:#888;" +
        "font-size:13px'>Connecting…</div></div></body>"
    );
  mainWindow.loadURL(SPLASH);
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.loadURL(APP_URL);
  });

  // If the app can't load (offline / backend asleep), show a retry screen.
  // Guards, so it only fires for genuine failures:
  //  • isMainFrame — ignore a failed favicon/iframe/subresource inside the app.
  //  • code === -3 is ERR_ABORTED, which fires on normal redirects and fast
  //    re-navigations (including our own will-redirect cancel of Google auth) —
  //    treating it as an error would flash the retry screen spuriously.
  mainWindow.webContents.on("did-fail-load", (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && url && url.startsWith(APP_URL)) {
      const ERR =
        "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<body style='margin:0;background:#000;color:#fff;font-family:system-ui;" +
            "display:flex;align-items:center;justify-content:center;height:100vh'>" +
            "<div style='text-align:center'><div style='letter-spacing:.35em;" +
            "font-weight:600'>AGENTFURY</div><div style='margin-top:14px;color:#888;" +
            "font-size:13px'>Can’t reach the server. Check your connection.</div>" +
            "<button onclick='location.href=\"" +
            APP_URL +
            "\"' style='margin-top:18px;background:#fff;color:#000;border:0;" +
            "padding:10px 22px;font-weight:600;cursor:pointer'>Retry</button></div></body>"
        );
      mainWindow.loadURL(ERR);
    }
  });

  // Open external links (Google consent, docs) in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Bulletproof Google sign-in: if anything tries to load Google's auth pages
  // INSIDE the app window, cancel it and open the real browser instead (which
  // has the user's Google session → account picker). The login returns to the
  // app via the agentforge:// deep link.
  const forceExternalGoogle = (e, url) => {
    if (url.startsWith("https://accounts.google.com")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  };
  mainWindow.webContents.on("will-navigate", forceExternalGoogle);
  mainWindow.webContents.on("will-redirect", forceExternalGoogle);

  // Closing hides to the tray (keeps reminders running) instead of quitting.
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // A 1x1 fallback so a missing icon never crashes startup; ship build/icon.png
  // for a real tray icon.
  let image;
  try {
    image = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));
    if (image.isEmpty()) image = nativeImage.createEmpty();
  } catch {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip("AgentFury");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Quick Find…", accelerator: "CommandOrControl+Space", click: () => showSpotlight() },
      { label: "Open AgentFury", click: () => showWindow() },
      { label: "Rebuild file index", click: () => { try { indexRoots(); } catch {} } },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", showWindow);
}

function showWindow() {
  if (!mainWindow) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// Quick-open toggle, like ChatGPT desktop's Ctrl+Space: a global hotkey that
// summons the assistant from anywhere, and hides it again if it's already the
// focused window — so the same key both opens and dismisses.
function toggleQuickOpen() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ---------------------------------------------------------------------------
// Quick Find — the spotlight popup (Ctrl+Shift+A).
//
// This is the one thing the desktop app can do that the website never will:
// answer about the user's OWN machine. It's a separate, frameless window over
// LOCAL html — not the cloud app — so it opens instantly, works with no network,
// and never waits on a backend cold start. Search runs in this process against
// an in-memory index (see file-search.js); no file contents are read and nothing
// is sent anywhere.
// ---------------------------------------------------------------------------
const SPOT_W = 680;
const SPOT_H = 460;

function createSpotlight() {
  spotWindow = new BrowserWindow({
    width: SPOT_W,
    height: SPOT_H,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,      // a launcher shouldn't sit in the taskbar
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#00000000",
    title: "AgentFury Quick Find",
    webPreferences: {
      preload: path.join(__dirname, "spotlight-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  spotWindow.loadFile(path.join(__dirname, "spotlight.html"));

  // Clicking away dismisses it, the way every launcher behaves.
  spotWindow.on("blur", () => {
    if (spotWindow && spotWindow.isVisible()) spotWindow.hide();
  });
  // Hide instead of destroy, so reopening is instant and the index stays warm.
  spotWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      spotWindow.hide();
    }
  });
}

function showSpotlight() {
  if (!spotWindow) createSpotlight();
  // Open on whichever screen the mouse is on, sitting slightly above centre —
  // that's where the eye already is, and it clears the taskbar.
  try {
    const pt = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(pt).workArea;
    spotWindow.setBounds({
      x: Math.round(area.x + (area.width - SPOT_W) / 2),
      y: Math.round(area.y + Math.max(60, area.height * 0.22)),
      width: SPOT_W,
      height: SPOT_H,
    });
  } catch {
    spotWindow.center();
  }
  spotWindow.show();
  spotWindow.focus();
  spotWindow.webContents.send("spot:shown");
}

function toggleSpotlight() {
  if (spotWindow && spotWindow.isVisible()) spotWindow.hide();
  else showSpotlight();
}

// Index the folders people actually keep things in. Deliberately NOT the whole
// drive: the home folder is where a person's files live, and skipping the rest
// keeps the walk fast and the results relevant.
function indexRoots() {
  const pick = (n) => {
    try { return app.getPath(n); } catch { return null; }
  };
  const downloads = pick("downloads");
  fileSearch.setRoots(
    [pick("desktop"), downloads, pick("documents"), pick("pictures"), pick("videos"), pick("music"), pick("home")],
    downloads
  );
  fileSearch.reindex();
}

function registerHotkeys() {
  // Each accelerator is tried in turn — register() returns false (rather than
  // throwing) when the OS or another app already owns the combination.
  const tryAll = (list, fn, label) => {
    for (const accel of list) {
      try {
        if (globalShortcut.register(accel, fn)) {
          console.log(label + " hotkey:", accel);
          return accel;
        }
      } catch (e) {
        /* try the next candidate */
      }
    }
    console.warn("Could not register a " + label + " hotkey (all taken).");
    return null;
  };

  // Quick Find owns the summon keys. Reaching for a hotkey means "let me find
  // something fast" — that's the popup, not a full window that covers the screen
  // and takes a beat to load. macOS keeps Cmd+Space for Spotlight, so it starts
  // one step along. The full window is a click away in the tray, and the popup
  // hands off to it whenever a request needs the whole assistant.
  const spotKeys =
    process.platform === "darwin"
      ? ["CommandOrControl+Shift+Space", "CommandOrControl+Shift+A", "CommandOrControl+Alt+A"]
      : ["CommandOrControl+Space", "CommandOrControl+Shift+A", "CommandOrControl+Alt+A"];

  let spot = null;
  // Register every accelerator that's free, not just the first — muscle memory
  // differs, and a second binding costs nothing.
  for (const accel of spotKeys) {
    try {
      if (globalShortcut.register(accel, toggleSpotlight)) {
        if (!spot) spot = accel;
        console.log("Quick Find hotkey:", accel);
      }
    } catch (e) {
      /* try the next candidate */
    }
  }
  if (!spot) console.warn("Could not register a Quick Find hotkey (all taken).");

  // The full window keeps a summon of its own, out of Quick Find's way.
  const main = tryAll(
    ["CommandOrControl+Shift+Enter", "CommandOrControl+Alt+Space"],
    toggleQuickOpen,
    "Open AgentFury"
  );
  return { spot, main };
}

// Handle agentforge://auth?token=...&google=connected — the OAuth callback
// redirects here after the user signs in via their real browser. We reload the
// app with the token in the URL; the web app reads ?token= and logs in.
function handleDeepLink(url) {
  if (!url || !url.startsWith(PROTOCOL + "://")) return;
  const query = url.split("?")[1] || "";
  showWindow();
  if (mainWindow) mainWindow.loadURL(`${APP_URL}/?${query}`);
}

// Single instance — focus the existing window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows/Linux: a deep link to a running app arrives as a CLI arg here.
  app.on("second-instance", (e, argv) => {
    const deep = argv.find((a) => a.startsWith(PROTOCOL + "://"));
    if (deep) handleDeepLink(deep);
    else showWindow();
  });
}

// macOS delivers the deep link via this event.
app.on("open-url", (e, url) => {
  e.preventDefault();
  handleDeepLink(url);
});

// Let the web app ask us to open URLs (the Google consent) in the real browser.
ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));

// ---- Quick Find IPC -------------------------------------------------------
// Only the spotlight window may call these. Its renderer is local html we ship,
// but the check costs nothing and means a compromised main-window page (which
// loads remote content) can never reach the filesystem through these channels.
const fromSpotlight = (e) => spotWindow && e.sender === spotWindow.webContents;

ipcMain.handle("spot:search", (e, q, group) => {
  if (!fromSpotlight(e)) return { items: [], counts: {}, inside: [] };
  try {
    return {
      items: fileSearch.search(q, 40, group || "all"),
      counts: fileSearch.counts(q),
      // Matches on what's WRITTEN in the files, not just their names. Empty
      // unless the user has turned content reading on.
      inside: (q || "").trim().length > 2 ? contentIndex.search(q, 4) : [],
      contentMode: settings.get().contentMode,
    };
  } catch (err) {
    console.warn("Quick Find search failed:", err.message);
    return { items: [], counts: {}, inside: [] };
  }
});

// Storage choice. Turning content reading on triggers the first index build.
ipcMain.handle("spot:settings", (e, patch) => {
  if (!fromSpotlight(e)) return null;
  if (patch && typeof patch.contentMode === "string") {
    const before = settings.get().contentMode;
    const s = settings.setContentMode(patch.contentMode);
    if (s.contentMode !== before) {
      contentIndex.setEnabled(s.contentMode !== "off");
      if (s.contentMode !== "off") buildContentIndex();
    }
  }
  return { ...settings.get(), index: contentIndex.stats() };
});

// Read the user's files and build the searchable index. Only ever called when
// the setting says we may.
let contentBuilding = false;
async function buildContentIndex() {
  if (contentBuilding) return;
  const mode = settings.get().contentMode;
  if (mode === "off") return;
  contentBuilding = true;
  try {
    // Reuse what the filename index already walked — no second pass over disk.
    const files = fileSearch.search("", 20000, "all");
    await contentIndex.build(files);
    console.log("Content index:", JSON.stringify(contentIndex.stats()));
  } catch (err) {
    console.warn("Content index build failed:", err.message);
  } finally {
    contentBuilding = false;
  }
}

// Copy the path as text, or the FILE itself so it can be pasted into Explorer,
// an email, or a chat. Electron's clipboard has no native file-list format, so
// on Windows we go through PowerShell's Set-Clipboard -LiteralPath, and on macOS
// through AppleScript. Falls back to copying the path if that isn't available.
ipcMain.handle("spot:copy", (e, p, mode) => {
  if (!fromSpotlight(e) || typeof p !== "string") return false;
  if (mode === "path") {
    clipboard.writeText(p);
    return "path";
  }
  try {
    if (process.platform === "win32") {
      execFile("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "Set-Clipboard -LiteralPath @('" + p.replace(/'/g, "''") + "')",
      ]);
      return "file";
    }
    if (process.platform === "darwin") {
      execFile("osascript", [
        "-e",
        'set the clipboard to (POSIX file "' + p.replace(/"/g, '\\"') + '")',
      ]);
      return "file";
    }
  } catch {
    /* fall through to the path */
  }
  clipboard.writeText(p);
  return "path";
});

// Hand the file to the OS share sheet / mail client. Windows has no scriptable
// share sheet, so the honest fallback is to put the file on the clipboard and
// say so, rather than pretending to share.
ipcMain.handle("spot:share", async (e, p) => {
  if (!fromSpotlight(e) || typeof p !== "string") return false;
  if (process.platform === "darwin") {
    try {
      execFile("osascript", [
        "-e",
        'tell application "Finder" to activate',
        "-e",
        'tell application "System Events" to keystroke "i" using {command down, control down}',
      ]);
      return "sheet";
    } catch {
      /* fall back below */
    }
  }
  clipboard.writeText(p);
  return "copied";
});

// Move to the recycle bin — recoverable, never a hard delete.
ipcMain.handle("spot:trash", async (e, p) => {
  if (!fromSpotlight(e) || typeof p !== "string") return false;
  try {
    await shell.trashItem(p);
    fileSearch.reindex();
    return true;
  } catch (err) {
    console.warn("Trash failed:", err.message);
    return false;
  }
});

ipcMain.handle("spot:open", async (e, p) => {
  if (!fromSpotlight(e) || typeof p !== "string") return false;
  if (spotWindow) spotWindow.hide();
  // openPath returns an error STRING (empty on success) rather than throwing.
  const err = await shell.openPath(p);
  if (err) shell.showItemInFolder(p); // e.g. no handler for the type — show it instead
  return !err;
});

ipcMain.handle("spot:reveal", (e, p) => {
  if (!fromSpotlight(e) || typeof p !== "string") return false;
  if (spotWindow) spotWindow.hide();
  shell.showItemInFolder(p);
  return true;
});

// Questions are answered IN the popup. Bouncing the user to the big window for
// every question would defeat the point of a launcher — you ask, you read the
// answer, you carry on. The session token is handed to us by the web app (see
// preload.js "auth:token"); the popup never sees it.
let sessionToken = "";
let cachedAgentId = "";

ipcMain.handle("auth:token", (e, token) => {
  // Only the app window may set this — never the popup or any other page.
  if (!mainWindow || e.sender !== mainWindow.webContents) return false;
  sessionToken = typeof token === "string" ? token : "";
  cachedAgentId = "";
  return true;
});

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(APP_URL + apiPath); } catch (e) { return reject(e); }
    const lib = url.protocol === "http:" ? require("http") : require("https");
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data || "{}")); } catch (err) { reject(err); }
          } else {
            reject(new Error(`${res.statusCode} ${data.slice(0, 200)}`));
          }
        });
      }
    );
    // The free backend can cold-start, but a launcher must not hang on it.
    req.setTimeout(45000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

ipcMain.handle("spot:ask", async (e, q) => {
  if (!fromSpotlight(e)) return { ok: false, error: "Not allowed." };
  const question = String(q || "").trim();
  if (!question) return { ok: false, error: "Ask me something." };
  if (!sessionToken) {
    return { ok: false, error: "Sign in to AgentFury first — open it from the tray." };
  }
  try {
    if (!cachedAgentId) {
      const agents = await apiRequest("GET", "/api/agents");
      const list = Array.isArray(agents) ? agents : agents.items || [];
      if (!list.length) return { ok: false, error: "No agent set up yet." };
      cachedAgentId = list[0].id;
    }

    // Retrieval-augmented, with the retrieval done HERE. The whole index stays
    // on the laptop; what leaves is only the few passages that actually match
    // the question, and only because a question was asked. The model is told
    // plainly that the passages are the user's own files, and to say so when
    // they don't contain the answer rather than inventing one.
    const hits = contentIndex.search(question, 4);
    let message = question;
    let sources = [];
    if (hits.length) {
      sources = hits.map((h) => ({ name: h.file.name, path: h.file.path }));
      const context = hits
        .map((h, i) => `[${i + 1}] ${h.file.name}\n${h.snippet}`)
        .join("\n\n");
      message =
        "Answer using these excerpts from the user's own files on this laptop. " +
        "Cite the file name you used. If they don't contain the answer, say so plainly.\n\n" +
        `${context}\n\nQuestion: ${question}`;
    }

    const r = await apiRequest("POST", `/api/agents/${cachedAgentId}/chat`, { message });
    return { ok: true, text: r.reply || "(no answer)", sources };
  } catch (err) {
    const msg = /timeout/i.test(err.message)
      ? "The server took too long to answer."
      : /401/.test(err.message)
        ? "Your session expired — open AgentFury from the tray to sign in again."
        : "Couldn't reach AgentFury right now.";
    return { ok: false, error: msg };
  }
});

ipcMain.handle("spot:hide", (e) => {
  if (fromSpotlight(e) && spotWindow) spotWindow.hide();
});

// A reminder alarm is due — bring the window to the front (even from the tray)
// and flash the taskbar so it reads like a real alarm. The renderer keeps the
// poller alive in the tray because backgroundThrottling is off.
ipcMain.handle("ring-alarm", () => {
  showWindow();
  if (mainWindow) {
    try {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.show();
      mainWindow.focus();
      mainWindow.flashFrame(true);
      // Stop flashing once focused.
      mainWindow.once("focus", () => {
        mainWindow.flashFrame(false);
        mainWindow.setAlwaysOnTop(false);
      });
    } catch (e) {
      /* best effort */
    }
  }
});

app.whenReady().then(() => {
  // Started by the OS at login (or with --hidden): come up as a background
  // service — tray + hotkey + file index, no window. The point is that Quick
  // Find answers instantly later, not that a window appears now.
  const startedHidden =
    process.argv.includes("--hidden") ||
    (() => {
      try { return app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
    })();

  if (!startedHidden) createWindow();

  // Cold start via the protocol (Windows): the URL is in the launch args.
  const coldDeep = process.argv.find((a) => a.startsWith(PROTOCOL + "://"));
  if (coldDeep) setTimeout(() => handleDeepLink(coldDeep), 800);

  try {
    createTray();
  } catch (e) {
    console.warn("Tray unavailable:", e.message);
  }

  // Quick Find has to answer whenever it's called, including when the user
  // thinks the app is "closed" — closing only hides to the tray, but a fresh
  // boot would leave nothing listening for the hotkey at all. Starting at login
  // (hidden, no window) is what makes the shortcut always work.
  try {
    if (!app.isPackaged) {
      // Never register a dev checkout as a login item.
    } else if (!app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,           // macOS: start in the background
        args: ["--hidden"],           // Windows: our own flag, read below
      });
    }
  } catch (e) {
    console.warn("Could not set launch-at-login:", e.message);
  }

  // Build the file index and the popup up front, in the background, so the very
  // first Ctrl+Space is as fast as every one after it.
  try {
    const dir = app.getPath("userData");
    settings.init(dir);
    contentIndex.setStatePath(path.join(dir, "content-index.json"));
    contentIndex.setEnabled(settings.get().contentMode !== "off");

    indexRoots();
    createSpotlight();

    // Content reading is opt-in, so this only runs once the user has agreed.
    // Reuse the saved index if there is one; otherwise build after the filename
    // walk has settled, so the first hotkey press isn't competing with it.
    if (settings.get().contentMode !== "off") {
      if (!contentIndex.load()) setTimeout(buildContentIndex, 8000);
    }
  } catch (e) {
    console.warn("Quick Find unavailable:", e.message);
  }

  registerHotkeys();

  // Silent auto-update from GitHub Releases (no-op in dev / if unpublished).
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.warn("Auto-update unavailable:", e.message);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => (quitting = true));

// Release the global hotkey so it doesn't linger after the app exits.
app.on("will-quit", () => globalShortcut.unregisterAll());

// Keep running in the tray when all windows are closed (that's what powers
// background reminder notifications). Use the tray's Quit to exit fully.
app.on("window-all-closed", () => {});
