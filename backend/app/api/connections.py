"""
Connections API — per-user "Connect with Google" flow + status for the
"Connected via Google ✓" badge.

The callback is hit by Google's servers (no Authorization header), so the user
id is carried inside a SIGNED `state` value created at /start and verified at
/callback. That's what keeps each user's Gmail isolated.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import os

from app.auth import (
    create_token,
    get_current_user,
    hash_password,
    sign_oauth_state,
    verify_oauth_state,
)
from app.config import settings
from app.database import get_db
from app.integrations import google_oauth
from app.models import Connection, User
from app.seed import create_starter_agents

router = APIRouter(prefix="/api/connections", tags=["connections"])


@router.get("")
def list_connections(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Status of every integration for the current user (for the UI bar)."""
    google = (
        db.query(Connection)
        .filter(Connection.provider == "google", Connection.user_id == user.id)
        .first()
    )
    return {
        "google": {
            "configured": google_oauth.is_configured(),
            "connected": google_oauth.is_connected(user.id),
            "account_email": google.account_email if google else "",
            "scopes": google.scopes if google else [],
        }
    }


@router.get("/google/start")
def google_start(user: User = Depends(get_current_user)):
    if not google_oauth.is_configured():
        raise HTTPException(
            400,
            "Google OAuth isn't set up yet. Add GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET to .env (see docs/CONNECT_GOOGLE.md).",
        )
    # Sign the user id into state so the callback knows who is connecting.
    state = sign_oauth_state({"uid": user.id})
    return {"auth_url": google_oauth.build_auth_url(state)}


def _upsert_google_connection(db: Session, user_id: str, info: dict) -> None:
    conn = (
        db.query(Connection)
        .filter(Connection.provider == "google", Connection.user_id == user_id)
        .first()
    )
    if not conn:
        conn = Connection(provider="google", user_id=user_id)
        db.add(conn)
    conn.account_email = info.get("email", "")
    conn.status = "connected"
    conn.scopes = info.get("scopes", [])
    db.commit()


@router.get("/google/callback")
def google_callback(
    code: str = "", state: str = "", error: str = "", db: Session = Depends(get_db)
):
    """Single callback for BOTH flows:
      • connect  — state has {uid}; an already-logged-in user links Gmail.
      • login    — state has {login}; sign in (or create an account) via Google
                   and grant Gmail in the same consent, then hand a token back.
    """
    frontend = settings.frontend_origin
    if error or not code or not state:
        return RedirectResponse(f"{frontend}/?google=error")

    data = verify_oauth_state(state)
    if not data:
        return RedirectResponse(f"{frontend}/?google=error")

    try:
        creds = google_oauth.complete_flow(code)
    except Exception:
        return RedirectResponse(f"{frontend}/?google=error")

    # ----- connect flow: existing, already-authenticated user -----
    if data.get("uid"):
        user_id = data["uid"]
        if not db.get(User, user_id):
            return RedirectResponse(f"{frontend}/?google=error")
        google_oauth.store_credentials(user_id, creds)
        _upsert_google_connection(db, user_id, google_oauth.userinfo(creds))
        return RedirectResponse(f"{frontend}/?google=connected")

    # ----- login flow: find-or-create an account from the Google identity -----
    if data.get("login"):
        info = google_oauth.userinfo(creds)
        email = (info.get("email") or "").strip().lower()
        if not email:
            return RedirectResponse(f"{frontend}/?google=error")
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                email=email,
                name=info.get("name", ""),
                # Random unusable password — this account signs in via Google.
                password_hash=hash_password(os.urandom(24).hex()),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            create_starter_agents(db, user.id)
        google_oauth.store_credentials(user.id, creds)
        _upsert_google_connection(db, user.id, info)
        token = create_token(user.id)
        # Hand the session token back to the SPA (local app) via the redirect.
        return RedirectResponse(f"{frontend}/?token={token}&google=connected")

    return RedirectResponse(f"{frontend}/?google=error")


@router.delete("/google")
def google_disconnect(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    google_oauth.disconnect(user.id)
    conn = (
        db.query(Connection)
        .filter(Connection.provider == "google", Connection.user_id == user.id)
        .first()
    )
    if conn:
        conn.status = "disconnected"
        conn.account_email = ""
        conn.scopes = []
        db.commit()
    return {"ok": True}
