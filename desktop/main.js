// AgentForge desktop (Electron) — native shell over the live cloud app.
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
// Set APP_URL to your Vercel URL (or pass AGENTFORGE_URL at runtime).

const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain } = require("electron");
const path = require("path");

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

// Your deployed app (override at runtime with AGENTFORGE_URL if needed).
const APP_URL = process.env.AGENTFORGE_URL || "https://agent-forge-hkom.vercel.app";

let mainWindow = null;
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
    title: "AgentForge",
    autoHideMenuBar: true,
    webPreferences: {
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
        "font-weight:600'>AGENTFORGE</div><div style='margin-top:14px;color:#888;" +
        "font-size:13px'>Connecting…</div></div></body>"
    );
  mainWindow.loadURL(SPLASH);
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.loadURL(APP_URL);
  });

  // If the app can't load (offline / backend asleep), show a retry screen.
  mainWindow.webContents.on("did-fail-load", (e, code, desc, url) => {
    if (url && url.startsWith(APP_URL)) {
      const ERR =
        "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<body style='margin:0;background:#000;color:#fff;font-family:system-ui;" +
            "display:flex;align-items:center;justify-content:center;height:100vh'>" +
            "<div style='text-align:center'><div style='letter-spacing:.35em;" +
            "font-weight:600'>AGENTFORGE</div><div style='margin-top:14px;color:#888;" +
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
  tray.setToolTip("AgentForge");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open AgentForge", click: () => showWindow() },
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

// Keep running in the tray when all windows are closed (that's what powers
// background reminder notifications). Use the tray's Quit to exit fully.
app.on("window-all-closed", () => {});
