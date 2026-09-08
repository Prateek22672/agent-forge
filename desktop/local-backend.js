// Local backend manager — runs AgentFury's FastAPI backend ON THIS MACHINE so
// all data stays on the laptop (local SQLite + OS keychain), fully offline for
// storage. The desktop app then loads http://127.0.0.1:<port> instead of the
// cloud, and the backend serves both the API and the built frontend from that
// one local origin.
//
// Honest note on "offline": your DATA is 100% local here. AI *inference* still
// calls Groq/Gemini over the internet unless the user configures a local Ollama
// model (the backend already supports that via the provider toggle). So this is
// "your data never leaves the laptop", not "the AI runs with no internet".
//
// Two run modes:
//   • packaged  → spawn the bundled backend executable from resources/backend/
//                 (built with PyInstaller — see docs/DESKTOP_LOCAL.md)
//   • dev       → run the Python source via the system interpreter (python -m
//                 uvicorn), so you can iterate without building the exe.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const PORT = 8756;
const BASE = `http://127.0.0.1:${PORT}`;
let proc = null;

function waitHealthy(timeoutMs = 90000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${BASE}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(BASE);
        else schedule();
      });
      req.on("error", schedule);
      req.setTimeout(2000, () => req.destroy());
    };
    const schedule = () => {
      if (Date.now() - start > timeoutMs) reject(new Error("Local backend did not become healthy in time."));
      else setTimeout(attempt, 600);
    };
    attempt();
  });
}

function resolveBackend(resourcesPath, isDev) {
  // Packaged: a PyInstaller-built executable bundled under resources/backend/.
  if (!isDev && resourcesPath) {
    const exe = process.platform === "win32" ? "agentfury-backend.exe" : "agentfury-backend";
    const p = path.join(resourcesPath, "backend", exe);
    if (fs.existsSync(p)) return { cmd: p, args: [], cwd: path.dirname(p) };
  }
  // Dev: run from the repo's backend/ with the system Python.
  const backendDir = path.resolve(__dirname, "..", "backend");
  const py = process.platform === "win32" ? "python" : "python3";
  return {
    cmd: py,
    args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(PORT)],
    cwd: backendDir,
  };
}

async function startLocalBackend({ resourcesPath, isDev, dataDir }) {
  const b = resolveBackend(resourcesPath, isDev);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {}
  const env = {
    ...process.env,
    PORT: String(PORT),
    AGENTFURY_DATA_DIR: dataDir, // all local data (SQLite, Chroma, keychain fallback) lives here
    DATABASE_URL: "", // no cloud DB → local SQLite + OS keychain mode
    FRONTEND_ORIGIN: BASE,
    OAUTH_REDIRECT_URI: `${BASE}/api/connections/google/callback`,
  };
  proc = spawn(b.cmd, b.args, { cwd: b.cwd, env, stdio: "ignore", windowsHide: true });
  proc.on("exit", () => {
    proc = null;
  });
  proc.on("error", () => {
    proc = null;
  });
  await waitHealthy();
  return BASE;
}

function stopLocalBackend() {
  if (proc) {
    try {
      proc.kill();
    } catch {}
    proc = null;
  }
}

module.exports = { startLocalBackend, stopLocalBackend, LOCAL_BASE: BASE };
