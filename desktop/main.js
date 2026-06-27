// AgentForge desktop (Electron).
//
// Responsibilities:
//   1. Start the bundled Python backend as a child process.
//   2. Open a window that loads the app the backend serves (http://127.0.0.1:PORT).
//   3. Live in the system tray. Closing the window HIDES it (keeps the agent +
//      reminder notifications running in the background); Quit fully exits.
//
// Background notifications: we keep the renderer alive when hidden and turn off
// background throttling, so the in-app reminder poller keeps firing native OS
// notifications even when the window is "closed" to the tray.

const { app, BrowserWindow, Tray, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = 8137; // uncommon port to avoid clashing with a dev server on 8000
const BASE = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let tray = null;
let backend = null;
let quitting = false;

// ---- Resolve where the backend lives (dev vs packaged) ----
function backendCommand() {
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    AGENTFORGE_DATA_DIR: dataDir,
    PORT: String(PORT),
  };

  if (app.isPackaged) {
    // Bundled backend exe + built frontend shipped as extraResources.
    const res = process.resourcesPath;
    env.FRONTEND_DIST = path.join(res, "frontend");
    const exe = path.join(res, "backend", process.platform === "win32" ? "agentforge-backend.exe" : "agentforge-backend");
    return { cmd: exe, args: [], env };
  }

  // Dev: run uvicorn from the project's venv.
  const root = path.join(__dirname, "..");
  env.FRONTEND_DIST = path.join(root, "frontend", "dist");
  const py =
    process.platform === "win32"
      ? path.join(root, "backend", ".venv", "Scripts", "python.exe")
      : path.join(root, "backend", ".venv", "bin", "python");
  return {
    cmd: py,
    args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(PORT)],
    env,
    cwd: path.join(root, "backend"),
  };
}

function startBackend() {
  const { cmd, args, env, cwd } = backendCommand();
  backend = spawn(cmd, args, { env, cwd, stdio: "ignore" });
  backend.on("exit", (code) => {
    if (!quitting) console.error("Backend exited with code", code);
  });
}

function waitForBackend(retries = 60) {
  return new Promise((resolve, reject) => {
    const tryOnce = (n) => {
      http
        .get(`${BASE}/api/health`, (res) => {
          res.statusCode === 200 ? resolve() : retry(n);
        })
        .on("error", () => retry(n));
    };
    const retry = (n) =>
      n <= 0 ? reject(new Error("backend did not start")) : setTimeout(() => tryOnce(n - 1), 500);
    tryOnce(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#000000",
    title: "AgentForge",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: false, // keep timers (reminder poller) alive when hidden
      contextIsolation: true,
    },
  });
  mainWindow.loadURL(BASE);

  // Open external links in the real browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BASE)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Closing hides to tray (keeps reminders running) unless we're really quitting.
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = path.join(__dirname, "icon.png");
  tray = new Tray(icon);
  tray.setToolTip("AgentForge");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open AgentForge", click: () => (mainWindow ? mainWindow.show() : createWindow()) },
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
  tray.on("click", () => (mainWindow ? mainWindow.show() : createWindow()));
}

app.whenReady().then(async () => {
  startBackend();
  try {
    await waitForBackend();
  } catch (e) {
    console.error(e);
  }
  createWindow();
  try {
    createTray();
  } catch (e) {
    console.warn("Tray unavailable (add desktop/icon.png):", e.message);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Single instance — focus the existing window instead of opening a second.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on("before-quit", () => {
  quitting = true;
  if (backend) backend.kill();
});

app.on("window-all-closed", () => {
  // Keep running in the tray (don't quit) — that's what powers background alarms.
});
