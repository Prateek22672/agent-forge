# AgentFury — Setup (pick one path)

Only **one thing is required**: a free **Groq API key** from
<https://console.groq.com>. Everything else has a free default.

First, create your env file and paste the key:

```bash
cp backend/.env.example backend/.env
# then edit backend/.env and set GROQ_API_KEY=...
```

---

## Option A — Docker (simplest, one command) 🐳

Requires Docker Desktop.

```bash
docker compose up --build
```

Open **http://localhost:8000**. That's it — the container builds the UI, runs
the API, and serves them together. Your data persists in a Docker volume.

To stop: `Ctrl+C`, or `docker compose down` (add `-v` to also wipe data).

---

## Option B — One script, no Docker

Builds the frontend and runs everything on **http://localhost:8000**.

- **Windows (PowerShell):**
  ```powershell
  ./run.ps1
  ```
- **macOS / Linux:**
  ```bash
  ./run.sh
  ```

The script creates a Python virtualenv, installs dependencies, builds the
frontend once, and starts the server.

---

## Option C — Dev mode (two terminals, hot reload)

Best while editing code.

**Terminal 1 — backend:**
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate   |   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — frontend:**
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

---

## Optional extras (all free)

| Feature | What to add to `backend/.env` |
| --- | --- |
| More throughput | `GROQ_API_KEYS=key2,key3` (round-robined) |
| Sign in with Google + Gmail | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — see [docs/CONNECT_GOOGLE.md](docs/CONNECT_GOOGLE.md) |
| Gemini overflow | `GEMINI_API_KEY` (get an `AIza…` key at <https://aistudio.google.com/apikey>) |
| Fully private (no cloud) | install [Ollama](https://ollama.com), `ollama pull llama3.2`, then pick **Local** in Settings |

## Troubleshooting

- **First chat is slow** — Chroma downloads its local embedding model once (~80MB). Subsequent calls are fast.
- **Blank page on :8000** — make sure the frontend was built (`npm run build`, or use Docker/`run` scripts which do it for you).
- **`groq_configured: false`** — your `backend/.env` is missing `GROQ_API_KEY`, or the server was started before you added it (restart it).

See [docs/STACK.md](docs/STACK.md) for the architecture, and
[docs/ROADMAP.md](docs/ROADMAP.md) for what's next.
