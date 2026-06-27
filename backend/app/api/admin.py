"""
Admin panel API (admin-only).

SECURITY: full API keys are NEVER returned by any endpoint here — only a masked
form (gsk_XX…last4) plus usage counts. Keys live in the OS keychain. Adding a key
is write-only (it goes in, it never comes back out). So nothing here is scrapable
to recover a real key, even by an authenticated admin.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import keys as key_manager
from app import usage
from app.auth import create_admin_token, require_admin, verify_password
from app.config import settings
from app.database import get_db
from app.models import User
from app.security.ratelimit import rate_limit

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AddKey(BaseModel):
    provider: str  # "groq" | "gemini"
    key: str


class AdminLogin(BaseModel):
    username: str
    password: str


@router.post("/login")
def admin_login(
    payload: AdminLogin,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit(8, 60)),  # Crocs: throttle admin brute force
):
    """Separate admin login. Accepts the dedicated console credentials
    (ADMIN_USERNAME/ADMIN_PASSWORD, default dj/dj), OR an is_admin user's
    email+password. Returns an admin-scoped token."""
    u = (payload.username or "").strip()
    # 1) Dedicated console account.
    if u == settings.admin_username and payload.password == settings.admin_password:
        return {"admin_token": create_admin_token("console"), "name": "Console admin"}
    # 2) A promoted (is_admin) user signing in with their own credentials.
    user = db.query(User).filter(User.email == u.lower()).first()
    if user and user.is_admin and verify_password(payload.password, user.password_hash):
        return {"admin_token": create_admin_token(user.id), "name": user.email}
    raise HTTPException(401, "Invalid admin credentials.")


def _key_rows(provider: str, env_keys: list[str], all_keys: list[str], stats: dict):
    """Build masked, non-recoverable rows for the UI."""
    per_key = stats.get(provider, {}).get("keys", {})
    rows = []
    for k in all_keys:
        suffix = k[-4:]
        rows.append(
            {
                "masked": key_manager.mask(k),
                "suffix": suffix,
                "requests": per_key.get(suffix, 0),
                "source": "env" if k in env_keys else "admin",
                "removable": k not in env_keys,  # env keys live in .env, not here
            }
        )
    return rows


@router.get("/insights")
def insights(
    db: Session = Depends(get_db), admin: str = Depends(require_admin)
):
    from app.config import settings

    stats = usage.snapshot()
    groq_env = settings.groq_key_pool
    gemini_env = [settings.gemini_api_key] if settings.gemini_api_key else []
    groq_all = key_manager.groq_keys()
    gemini_all = key_manager.gemini_keys()

    return {
        "totals": {
            "all_calls": usage.total_calls(),
            "groq_calls": stats.get("groq", {}).get("total", 0),
            "gemini_calls": stats.get("gemini", {}).get("total", 0),
            "ollama_calls": stats.get("ollama", {}).get("total", 0),
        },
        "groq": {
            "count": len(groq_all),
            "keys": _key_rows("groq", groq_env, groq_all, stats),
        },
        "gemini": {
            "count": len(gemini_all),
            "keys": _key_rows("gemini", gemini_env, gemini_all, stats),
        },
        "users_count": db.query(User).count(),
    }


@router.post("/keys")
def add_key(payload: AddKey, admin: str = Depends(require_admin)):
    if payload.provider not in ("groq", "gemini"):
        raise HTTPException(400, "provider must be 'groq' or 'gemini'")
    added, reason = key_manager.add_key(payload.provider, payload.key)
    if not added:
        msg = {
            "duplicate": "That key is already added.",
            "empty": "Key is empty.",
            "bad_format": "Invalid Groq key (must start with 'gsk_').",
        }.get(reason, "Could not add key.")
        raise HTTPException(409 if reason == "duplicate" else 400, msg)
    return {"added": True}


@router.delete("/keys/{provider}/{suffix}")
def remove_key(provider: str, suffix: str, admin: str = Depends(require_admin)):
    if not key_manager.remove_admin_key(provider, suffix):
        raise HTTPException(404, "Key not found or not removable (env keys live in .env).")
    return {"removed": True}


# ---------- Users ----------
@router.get("/users")
def list_users(db: Session = Depends(get_db), admin: str = Depends(require_admin)):
    from app.models import Agent, Connection, Conversation

    rows = db.query(User).order_by(User.created_at.desc()).all()
    out = []
    for u in rows:
        agent_count = db.query(Agent).filter(Agent.user_id == u.id).count()
        chat_count = (
            db.query(Conversation)
            .join(Agent, Conversation.agent_id == Agent.id)
            .filter(Agent.user_id == u.id)
            .count()
        )
        google = (
            db.query(Connection)
            .filter(
                Connection.user_id == u.id,
                Connection.provider == "google",
                Connection.status == "connected",
            )
            .first()
        )
        out.append(
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "is_admin": u.is_admin,
                "created_at": u.created_at,
                "agents": agent_count,
                "chats": chat_count,
                "google": google.account_email if google else "",
                "is_you": u.id == admin,
            }
        )
    return out


class MakeAdmin(BaseModel):
    is_admin: bool


@router.patch("/users/{user_id}")
def set_admin(
    user_id: str,
    payload: MakeAdmin,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    """Promote/demote a user. A promoted user can sign into /admin with their own
    email + password."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_admin = payload.is_admin
    db.commit()
    return {"id": user.id, "is_admin": user.is_admin}


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    if user_id == admin:
        raise HTTPException(400, "You can't delete the account you're logged in as.")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    # Clean up their data (agents cascade to conversations/messages).
    from app.memory import vector_store
    from app.models import (
        Agent,
        BrainFact,
        Connection,
        EmailDraft,
        Note,
        Reminder,
    )

    for agent in db.query(Agent).filter(Agent.user_id == user_id).all():
        vector_store.forget_all(agent.id)
    for model in (Agent, Connection, Reminder, Note, BrainFact, EmailDraft):
        db.query(model).filter(model.user_id == user_id).delete()
    db.delete(user)
    db.commit()
