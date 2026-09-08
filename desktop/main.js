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

const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, globalShortcut, screen } = require("electron");
const path = require("path");
const { startLocalBackend, stopLocalBackend } = require("./local-backend");
const fileSearch = require("./file-search");

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

ipcMain.handle("spot:search", (e, q) => {
  if (!fromSpotlight(e)) return [];
  try {
    return fileSearch.search(q, 30);
  } catch (err) {
    console.warn("Quick Find search failed:", err.message);
    return [];
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

// "Ask AgentFury" — hand the question to the full assistant window.
ipcMain.handle("spot:ask", (e, q) => {
  if (!fromSpotlight(e)) return false;
  if (spotWindow) spotWindow.hide();
  showWindow();
  try {
    if (mainWindow) mainWindow.loadURL(`${APP_URL}/?q=${encodeURIComponent(String(q || ""))}`);
  } catch {}
  return true;
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
  createWindow();

  // Cold start via the protocol (Windows): the URL is in the launch args.
  const coldDeep = process.argv.find((a) => a.startsWith(PROTOCOL + "://"));
  if (coldDeep) setTimeout(() => handleDeepLink(coldDeep), 800);

  try {
    createTray();
  } catch (e) {
    console.warn("Tray unavailable:", e.message);
  }

  // Build the file index and the popup up front, in the background, so the very
  // first Ctrl+Shift+A is as fast as every one after it.
  try {
    indexRoots();
    createSpotlight();
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
