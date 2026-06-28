"""
Connections API — per-user "Connect with Google" flow + status for the
"Connected via Google ✓" badge.

The callback is hit by Google's servers (no Authorization header), so the user
id is carried inside a SIGNED `state` value created at /start and verified at
/callback. That's what keeps each user's Gmail isolated.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

import json
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
    connected = google_oauth.is_connected(user.id)
    scopes = google.scopes if google else []
    has = lambda frag: any(frag in s for s in scopes)  # noqa: E731
    return {
        "google": {
            "configured": google_oauth.is_configured(),
            "connected": connected,
            "account_email": google.account_email if google else "",
            "scopes": scopes,
            # Per-service status for the UI's green/red indicators.
            "services": {
                "signed_in": connected,
                "gmail_read": connected and has("gmail.readonly"),
                "gmail_send": connected and has("gmail.send"),
                "calendar": connected and has("calendar.events"),
            },
        }
    }


@router.get("/google/start")
def google_start(desktop: bool = False, user: User = Depends(get_current_user)):
    if not google_oauth.is_configured():
        raise HTTPException(
            400,
            "Google OAuth isn't set up yet. Add GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET to .env (see docs/CONNECT_GOOGLE.md).",
        )
    # Sign the user id into state so the callback knows who is connecting.
    # This is the CONNECT flow → request the Gmail/Calendar (data) scopes.
    state = sign_oauth_state({"uid": user.id, "desktop": desktop})
    return {"auth_url": google_oauth.build_auth_url(state, include_data=True)}


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


def _desktop_bridge(query: str) -> HTMLResponse:
    """A real page shown in the user's browser after Google sign-in for the
    DESKTOP app. It launches the app via the agentforge:// deep link (auto, with
    a manual button as a reliable fallback) — the equivalent of Slack/Notion's
    'you can return to the app now' screen."""
    deep = f"agentforge://auth?{query}"
    deep_js = json.dumps(deep)  # safely escaped for the inline script
    html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AgentForge — signed in</title>
<style>
  html,body{{height:100%}}
  body{{margin:0;background:#000;color:#fff;display:flex;align-items:center;
    justify-content:center;text-align:center;
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif}}
  .card{{max-width:440px;padding:36px}}
  .tag{{font-size:12px;letter-spacing:.28em;color:#7a7a7a}}
  h1{{font-size:26px;margin:16px 0 8px;font-weight:600}}
  p{{color:#9a9a9a;font-size:14px;line-height:1.6;margin:6px 0}}
  .btn{{display:inline-block;margin-top:22px;background:#fff;color:#000;
    padding:13px 26px;text-decoration:none;font-weight:600}}
  .btn:hover{{background:#e6e6e6}}
</style></head>
<body><div class="card">
  <div class="tag">AGENTFORGE</div>
  <h1>You're signed in &#10003;</h1>
  <p>Returning you to the AgentForge app&hellip;</p>
  <a class="btn" href="{deep}" id="open">Open AgentForge</a>
  <p style="margin-top:18px">If the app doesn't open, click the button above.<br/>
     You can close this tab afterwards.</p>
</div>
<script>
  // Hand control back to the desktop app. A click (button) reliably launches the
  // custom scheme; we also try automatically right away.
  var url = {deep_js};
  function go(){{ window.location.href = url; }}
  setTimeout(go, 300);
  document.getElementById('open').addEventListener('click', function(e){{
    e.preventDefault(); go();
  }});
</script>
</body></html>"""
    return HTMLResponse(html)


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

    # Desktop flows hand control back to the app via the agentforge:// deep link
    # (the consent ran in the user's real browser, with their Google session).
    desktop = bool(data.get("desktop"))

    def _back(query: str):
        # Browsers refuse to auto-launch a custom scheme (agentforge://) from a
        # plain HTTP redirect, so for desktop we return a real "you're signed in"
        # page that launches the app (automatically + a manual button fallback).
        if desktop:
            return _desktop_bridge(query)
        return RedirectResponse(f"{frontend}/?{query}")

    try:
        creds = google_oauth.complete_flow(code)
    except Exception:
        return _back("google=error")

    # ----- connect flow: existing, already-authenticated user -----
    if data.get("uid"):
        user_id = data["uid"]
        if not db.get(User, user_id):
            return _back("google=error")
        google_oauth.store_credentials(user_id, creds)
        _upsert_google_connection(db, user_id, google_oauth.userinfo(creds))
        return _back("google=connected")

    # ----- login flow: find-or-create an account from the Google identity -----
    if data.get("login"):
        info = google_oauth.userinfo(creds)
        email = (info.get("email") or "").strip().lower()
        if not email:
            return _back("google=error")
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
        # Hand the session token back (browser query, or desktop deep link).
        return _back(f"token={token}&google=connected")

    return _back("google=error")


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
