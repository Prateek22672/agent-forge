# AgentForge — one-command run (Windows). Builds the UI and serves everything
# on http://localhost:8000. Requires Python 3.11+ and Node 18+.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==> Backend: virtualenv + dependencies" -ForegroundColor Cyan
Set-Location "$root\backend"
if (-not (Test-Path ".venv")) { python -m venv .venv }
& ".venv\Scripts\python.exe" -m pip install --upgrade pip -q
& ".venv\Scripts\python.exe" -m pip install -r requirements.txt -q

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created backend\.env — add your GROQ_API_KEY to it, then re-run." -ForegroundColor Yellow
  exit 1
}

Write-Host "==> Frontend: install + build" -ForegroundColor Cyan
Set-Location "$root\frontend"
if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund }
npm run build

Write-Host "==> Starting AgentForge on http://localhost:8000" -ForegroundColor Green
Set-Location "$root\backend"
& ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
