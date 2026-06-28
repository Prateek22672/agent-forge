#!/usr/bin/env bash
# AgentFury — one-command run (macOS/Linux). Builds the UI and serves
# everything on http://localhost:8000. Requires Python 3.11+ and Node 18+.
set -e
root="$(cd "$(dirname "$0")" && pwd)"

echo "==> Backend: virtualenv + dependencies"
cd "$root/backend"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip -q
./.venv/bin/python -m pip install -r requirements.txt -q

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created backend/.env — add your GROQ_API_KEY to it, then re-run."
  exit 1
fi

echo "==> Frontend: install + build"
cd "$root/frontend"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run build

echo "==> Starting AgentFury on http://localhost:8000"
cd "$root/backend"
exec ./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
