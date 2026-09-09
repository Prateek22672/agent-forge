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
const fs = require("fs");
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
    loadApp();
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
  tray.on("click", showWindow);
  refreshTray();
}

// The tray menu carries the update state, so there is always somewhere to see
// what's happening without the app interrupting to tell you.
function refreshTray() {
  if (!tray) return;
  const s = updateState;
  let updateItem;
  if (s.status === "ready") {
    updateItem = {
      label: `Restart to update${s.version ? " to " + s.version : ""}`,
      click: () => {
        quitting = true;
        try { require("electron-updater").autoUpdater.quitAndInstall(false, true); } catch {}
      },
    };
  } else if (s.status === "downloading") {
    updateItem = {
      label: `Downloading update${s.percent ? ` — ${s.percent}%` : "…"}`,
      enabled: false,
    };
  } else if (s.status === "checking") {
    updateItem = { label: "Checking for updates…", enabled: false };
  } else {
    updateItem = {
      label: "Check for updates",
      click: () => {
        try {
          if (app.isPackaged) require("electron-updater").autoUpdater.checkForUpdates();
        } catch {}
      },
    };
  }

  try {
    tray.setToolTip(s.status === "ready" ? "AgentFury — update ready" : "AgentFury");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Quick Find…", accelerator: "CommandOrControl+Space", click: () => showSpotlight() },
        { label: "Open AgentFury", click: () => showWindow() },
        { label: "Settings…", click: () => showSettings() },
        { label: "Reload app", click: () => { showWindow(); loadApp(); } },
        { label: "Rebuild file index", click: () => { try { indexRoots(); } catch {} } },
        { type: "separator" },
        updateItem,
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
  } catch {}
}

// The web app is deployed continuously, but this shell loaded its URL once at
// launch and never again — and closing the window only hides it to the tray. So
// an app left running for a day showed yesterday's build, and reopening it
// changed nothing. Every UI fix shipped to the website was invisible here.
//
// The main document is loaded with no-cache so it always revalidates (the asset
// filenames are content-hashed, so they still cache normally), and the app
// reloads when it is brought back after sitting hidden for a while.
let lastLoadedAt = 0;
const STALE_AFTER = 20 * 60 * 1000;

function loadApp(query = "") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  lastLoadedAt = Date.now();
  mainWindow.loadURL(APP_URL + (query ? `/?${query}` : ""), {
    extraHeaders: "pragma: no-cache\ncache-control: no-cache\n",
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  // Only refresh a window that has been sitting idle, and never one the user is
  // mid-conversation in — losing a half-typed message to a silent reload would
  // be a worse bug than the stale UI this fixes.
  const stale = Date.now() - lastLoadedAt > STALE_AFTER;
  if (stale && !mainWindow.isVisible()) {
    mainWindow.webContents
      .executeJavaScript("!!document.querySelector('[data-chat-dirty]')")
      .catch(() => false)
      .then((dirty) => {
        if (!dirty) loadApp();
      });
  }
  mainWindow.show();
  mainWindow.focus();
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
// Wider than a plain list needs, because the preview pane lives on the right —
// seeing the file is what stops "is this the one?" costing an app launch.
const SPOT_W = 860;
const SPOT_H = 520;

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
  // A launcher that only appears over ordinary windows isn't a launcher — the
  // moment you're in a full-screen video, a game, a presentation or a maximised
  // IDE, the hotkey looks broken. alwaysOnTop alone sits in the NORMAL band and
  // loses to all of those, so the level is raised to the one the OS reserves for
  // screensavers, which is above full-screen content on both platforms.
  try {
    spotWindow.setAlwaysOnTop(true, "screen-saver", 1);
    // macOS: appear on whichever Space is active, including over a full-screen
    // app, instead of yanking the user back to the Space the app launched on.
    spotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn("Could not raise Quick Find above full-screen windows:", e.message);
  }

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
  // Re-assert on every show. Another app going full-screen can demote a window
  // that was raised at creation, so a launcher that only sets this once
  // eventually stops appearing — which is exactly the failure being fixed.
  try {
    spotWindow.setAlwaysOnTop(true, "screen-saver", 1);
    spotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}

  spotWindow.show();
  // showInactive + focus is more reliable than show() alone when the foreground
  // window belongs to another process: Windows can refuse a focus steal, which
  // leaves the popup visible but not accepting keystrokes.
  spotWindow.focus();
  try {
    if (process.platform === "win32") {
      spotWindow.setSkipTaskbar(true);
      spotWindow.moveTop();
    }
  } catch {}
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

  // The user's chosen shortcut comes first; the rest are fallbacks for when it
  // is already owned by something else (IME switchers and other launchers take
  // Ctrl+Space on plenty of machines). Settings can change these, so everything
  // is re-registered from scratch each time.
  globalShortcut.unregisterAll();

  const cfg = settings.get().hotkeys || {};
  const spotKeys = [
    cfg.quickFind,
    process.platform === "darwin" ? "CommandOrControl+Shift+Space" : "CommandOrControl+Space",
    "CommandOrControl+Shift+A",
    "CommandOrControl+Alt+A",
  ].filter(Boolean);

  let spot = null;
  for (const accel of spotKeys) {
    try {
      if (globalShortcut.register(accel, toggleSpotlight)) {
        if (!spot) spot = accel;
        console.log("Quick Find hotkey:", accel);
        break; // the user picked one — don't silently claim three more
      }
    } catch (e) {
      /* try the next candidate */
    }
  }
  if (!spot) console.warn("Could not register a Quick Find hotkey (all taken).");

  // The full window keeps a summon of its own, out of Quick Find's way.
  const main = tryAll(
    [cfg.openApp, "CommandOrControl+Shift+Enter", "CommandOrControl+Alt+Space"].filter(Boolean),
    toggleQuickOpen,
    "Open AgentFury"
  );
  // Reported so a rejected shortcut can be rolled back instead of leaving the
  // user with nothing bound.
  return !!spot;
}

// ---------------------------------------------------------------------------
// Settings window — a real window rather than a popover, because the storage
// section has to show numbers and the shortcut recorder needs room to explain
// itself. Wide and rectangular so nothing wraps into a column of fragments.
// ---------------------------------------------------------------------------
let cfgWindow = null;

function showSettings() {
  if (cfgWindow && !cfgWindow.isDestroyed()) {
    cfgWindow.show();
    cfgWindow.focus();
    return;
  }
  cfgWindow = new BrowserWindow({
    width: 940,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "AgentFury Settings",
    backgroundColor: "#0d0e14",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "settings-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  cfgWindow.loadFile(path.join(__dirname, "settings.html"));
  cfgWindow.on("closed", () => (cfgWindow = null));
}

// How much disk the local index actually occupies. Reported rather than
// estimated, because "where is my data" deserves a real number.
function indexBytes() {
  try {
    return fs.statSync(path.join(app.getPath("userData"), "content-index.json")).size;
  } catch {
    return 0;
  }
}

ipcMain.handle("cfg:open", () => { showSettings(); return true; });

ipcMain.handle("cfg:get", () => ({
  ...settings.get(),
  version: app.getVersion(),
  index: contentIndex.stats(),
  indexBytes: indexBytes(),
  // Zero, and it is meant to stay zero: file contents are never uploaded. It is
  // shown so the claim is visible rather than buried in a privacy page.
  cloudBytes: 0,
}));

ipcMain.handle("cfg:set", (_e, next) => {
  const before = settings.get();
  const after = settings.patch(next);

  if (next && next.contentMode && next.contentMode !== before.contentMode) {
    contentIndex.setEnabled(after.contentMode !== "off");
    if (after.contentMode !== "off") buildContentIndex();
  }
  if (next && next.hotkeys) {
    const ok = registerHotkeys();
    if (!ok) {
      // Put the old binding back rather than leaving the user with no shortcut.
      settings.patch({ hotkeys: before.hotkeys });
      registerHotkeys();
      return { ...settings.get(), version: app.getVersion(), index: contentIndex.stats(),
               indexBytes: indexBytes(), cloudBytes: 0, hotkeyError: true };
    }
  }
  if (next && typeof next.launchAtLogin === "boolean" && app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: next.launchAtLogin,
        openAsHidden: true,
        args: ["--hidden"],
      });
    } catch {}
  }
  return { ...settings.get(), version: app.getVersion(), index: contentIndex.stats(),
           indexBytes: indexBytes(), cloudBytes: 0 };
});

ipcMain.handle("cfg:rebuild", async () => {
  indexRoots();
  await buildContentIndex();
  return contentIndex.stats();
});

ipcMain.handle("cfg:wipe", () => {
  contentIndex.clear();
  return contentIndex.stats();
});

// ---------------------------------------------------------------------------
// Updates
//
// Nobody should be downloading an installer and reinstalling over the top to get
// a fix. electron-updater can do the whole thing in the background — the app
// fetches the new version while it's running and swaps it in on the next launch.
//
// The one rule: never interrupt. A download runs silently, and when it's ready
// the app says so once, in the tray and in a small notice, and waits. Restarting
// is the user's call — an update that yanks the window away mid-task is worse
// than an update that waits an hour.
// ---------------------------------------------------------------------------
let updateState = { status: "idle", version: "", notified: false };

function setUpdateState(status, version) {
  updateState.status = status;
  if (version) updateState.version = version;
  refreshTray();
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:state", { ...updateState });
    }
  } catch {}
}

function setupUpdates() {
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    console.warn("Auto-update unavailable:", e.message);
    return;
  }
  // Download without asking, install only when told. Downloading early is what
  // makes "Restart" instant later.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => setUpdateState("checking"));
  autoUpdater.on("update-not-available", () => setUpdateState("idle"));
  autoUpdater.on("update-available", (info) => setUpdateState("downloading", info?.version));
  autoUpdater.on("download-progress", (p) => {
    updateState.percent = Math.round(p.percent || 0);
    refreshTray();
  });
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState("ready", info?.version);
    if (!updateState.notified) {
      updateState.notified = true;
      // One quiet nudge, and only if a window is open to receive it.
      try {
        if (tray && process.platform === "win32") {
          tray.displayBalloon({
            title: "AgentFury update ready",
            content: `Version ${info?.version || ""} installs next time you restart.`,
          });
        }
      } catch {}
    }
  });
  autoUpdater.on("error", (err) => {
    // A failed check must never surface as a crash or a dialog — it's a
    // background nicety, and the app works fine without it.
    console.warn("Update check failed:", err && err.message);
    setUpdateState("idle");
  });

  const check = () => {
    if (!app.isPackaged) return; // dev checkouts have nothing to update to
    try { autoUpdater.checkForUpdates(); } catch {}
  };
  check();
  // The app is expected to stay in the tray for days, so a single check at
  // launch would leave it stale. Every 6 hours is enough to be current without
  // being noise.
  setInterval(check, 6 * 60 * 60 * 1000);

  ipcMain.handle("update:check", () => { check(); return { ...updateState }; });
  ipcMain.handle("update:state", () => ({ ...updateState }));
  ipcMain.handle("update:install", () => {
    if (updateState.status !== "ready") return false;
    quitting = true;
    try { autoUpdater.quitAndInstall(false, true); } catch { return false; }
    return true;
  });
}

// Handle agentforge://auth?token=...&google=connected — the OAuth callback
// redirects here after the user signs in via their real browser. We reload the
// app with the token in the URL; the web app reads ?token= and logs in.
function handleDeepLink(url) {
  if (!url || !url.startsWith(PROTOCOL + "://")) return;
  const query = url.split("?")[1] || "";
  showWindow();
  loadApp(query);
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

// A look at the file WITHOUT opening it — the difference between "is this the
// right one?" costing a keystroke or costing an app launch. Images come back as
// a data URI, text and documents as their first lines.
const PREVIEW_IMG_MAX = 6 * 1024 * 1024;
const IMG_MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif",
};

ipcMain.handle("spot:preview", async (e, p) => {
  if (!fromSpotlight(e) || typeof p !== "string") return null;
  try {
    const st = await fs.promises.stat(p);
    if (st.isDirectory()) {
      const entries = await fs.promises.readdir(p);
      return {
        type: "folder",
        count: entries.length,
        items: entries.filter((n) => !n.startsWith(".")).slice(0, 12),
      };
    }
    const ext = path.extname(p).slice(1).toLowerCase();
    if (IMG_MIME[ext] && st.size <= PREVIEW_IMG_MAX) {
      const buf = await fs.promises.readFile(p);
      return { type: "image", dataUri: `data:${IMG_MIME[ext]};base64,${buf.toString("base64")}` };
    }
    // Everything else goes through the same extractor the content index uses,
    // so a PDF or Word file previews as its actual words rather than "no
    // preview available".
    const { extractText, isExtractable } = require("./extractors");
    if (isExtractable(path.basename(p)) && st.size <= 12 * 1024 * 1024) {
      const text = await extractText(p, path.basename(p));
      if (text) return { type: "text", text: text.slice(0, 1400) };
    }
    return { type: "none", size: st.size };
  } catch {
    return null;
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
    // the question, and only because a question was asked.
    const hits = contentIndex.search(question, 5);
    const sources = hits.map((h) => ({ name: h.file.name, path: h.file.path }));

    // /api/quickfind/ask is one call to the fast model with no tool loop and no
    // persistence — a launcher is judged on whether the answer beats the user's
    // patience, and the full agent endpoint cannot do that.
    try {
      const r = await apiRequest("POST", "/api/quickfind/ask", {
        question,
        // The folder goes in the name, because "where is my internship deck?" is
        // a location question and the model cannot answer it from file contents
        // alone — it needs to be told where the match actually lives.
        passages: hits.map((h) => ({
          name: `${h.file.name} — in ${h.file.dir}`,
          text: h.snippet,
        })),
      });
      if (r && r.ok) {
        return {
          ok: true,
          text: r.answer,
          sources: r.grounded ? sources : [],
          grounded: !!r.grounded,
        };
      }
    } catch (fastErr) {
      // An older backend won't have this route yet — fall through to the agent
      // rather than failing the question outright.
      if (!/404/.test(fastErr.message)) throw fastErr;
    }

    let message = question;
    if (hits.length) {
      const context = hits.map((h, i) => `[${i + 1}] ${h.file.name}\n${h.snippet}`).join("\n\n");
      message =
        "Answer using these excerpts from the user's own files on this laptop. " +
        "Cite the file name you used. If they don't contain the answer, say so plainly.\n\n" +
        `${context}\n\nQuestion: ${question}`;
    }
    const r = await apiRequest("POST", `/api/agents/${cachedAgentId}/chat`, { message });
    return { ok: true, text: r.reply || "(no answer)", sources, grounded: hits.length > 0 };
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

  setupUpdates();

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
