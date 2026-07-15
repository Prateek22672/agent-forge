"""Shared 'find-or-create a user from a Google identity' logic — used by both
the website/desktop OAuth callback and the browser-extension login endpoint,
so the account-creation rules live in exactly one place."""
from __future__ import annotations

import os

from sqlalchemy.orm import Session

from app.auth import hash_password
from app.integrations import google_oauth
from app.models import User
from app.seed import create_starter_agents


def login_or_create_user(db: Session, creds) -> tuple[User | None, dict]:
    """Given verified Google credentials, return (user, userinfo). Creates a new
    AgentFury account on first sign-in. Returns (None, info) if Google didn't
    give us an email (shouldn't happen with the openid/email scopes)."""
    info = google_oauth.userinfo(creds)
    email = (info.get("email") or "").strip().lower()
    if not email:
        return None, info
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            email=email,
            name=info.get("name", ""),
            # Random unusable password — this account signs in via Google only.
            password_hash=hash_password(os.urandom(24).hex()),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        create_starter_agents(db, user.id)
    google_oauth.store_credentials(user.id, creds)
    _upsert_connection(db, user.id, info)
    return user, info


def _upsert_connection(db: Session, user_id: str, info: dict) -> None:
    from app.models import Connection

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
