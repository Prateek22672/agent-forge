"""
FastAPI application entry point.

Run with:  uvicorn app.main:app --reload --port 8000
Interactive API docs are auto-generated at  http://localhost:8000/docs
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import (
    admin,
    agents,
    auth_api,
    chat,
    connections,
    emails,
    priority_api,
    push_api,
    settings_api,
    tasks,
)
from app.config import BASE_DIR, settings
from app.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure tables exist, then upgrade existing 'Assistant' agents so
    # accounts made before reminders/notes/email gain those tools automatically.
    init_db()
    from app.database import SessionLocal
    from app.seed import upgrade_assistants

    _db = SessionLocal()
    try:
        upgrade_assistants(_db)
    finally:
        _db.close()
    yield
    # (no shutdown work needed)


app = FastAPI(
    title="AgentForge",
    description="Create and run personal AI agents on free infrastructure.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # Crocs: only the configured frontend origin(s) may call the API with creds —
    # not a wildcard. Lock FRONTEND_ORIGIN to your real domain in production.
    allow_origins=[settings.frontend_origin, "http://localhost:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def crocs_security_headers(request, call_next):
    """Crocs: defensive response headers on every request."""
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"          # block click-jacking
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return resp

app.include_router(auth_api.router)
app.include_router(agents.router)
app.include_router(chat.router)
app.include_router(connections.router)
app.include_router(settings_api.router)
app.include_router(tasks.router)
app.include_router(emails.router)
app.include_router(admin.router)
app.include_router(push_api.router)
app.include_router(priority_api.router)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "default_model": settings.default_model,
        "groq_configured": bool(settings.groq_api_key),
    }


# Serve the built frontend (single-container / packaged deployments). In dev the
# frontend runs on Vite :5173 instead, so this is skipped when dist is absent.
# IMPORTANT: mounted at "/" LAST, so it never shadows the /api/* routes above.
_dist = Path(os.environ.get("FRONTEND_DIST", str(BASE_DIR.parent / "frontend" / "dist")))
if _dist.exists():
    from fastapi.responses import FileResponse

    @app.get("/admin")
    def _admin_page():
        # SPA route — serve the same shell; the frontend renders the admin app.
        return FileResponse(_dist / "index.html")

    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
