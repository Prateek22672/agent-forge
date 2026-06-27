"""
Authentication: password hashing + JWT issuing/verification + the FastAPI
dependency that resolves the current user from the Authorization header.

Design notes:
  • Passwords are hashed with PBKDF2-HMAC-SHA256 (Python stdlib) — no native
    dependency, salted, many iterations. We never store raw passwords.
  • Sessions are stateless JWTs (HS256). The signing secret is generated once and
    persisted under data/ so tokens survive restarts.
  • `sign_state` / `verify_state` reuse the same secret to carry the user id
    safely through the Google OAuth redirect (the callback has no auth header,
    so the user id must travel inside the signed `state` parameter).
"""
from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User

_ALGO = "HS256"
_ITERATIONS = 200_000


def _secret() -> str:
    """The secret for signing JWTs (and deriving the DB encryption key).

    In the cloud, SECRET_KEY env must be set so tokens survive restarts. Locally
    we persist a generated one to a file."""
    if settings.secret_key:
        return settings.secret_key
    path = settings.data_dir / "auth_secret.txt"
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    secret = os.urandom(32).hex()
    path.write_text(secret, encoding="utf-8")
    return secret


# ---------- passwords ----------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ---------- tokens ----------
def create_token(user_id: str, days: int = 30) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=days),
    }
    return jwt.encode(payload, _secret(), algorithm=_ALGO)


def _decode(token: str) -> dict:
    return jwt.decode(token, _secret(), algorithms=[_ALGO])


def sign_oauth_state(data: dict) -> str:
    """Short-lived signed token carrying data (the user id for a 'connect' flow,
    or a 'login' marker for sign-in-with-Google) safely through the OAuth round
    trip. Google echoes this back to our callback unchanged."""
    payload = {
        **data,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    return jwt.encode(payload, _secret(), algorithm=_ALGO)


def verify_oauth_state(state: str) -> dict | None:
    try:
        return _decode(state)
    except Exception:
        return None


# ---------- dependency ----------
def get_current_user(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = authorization.split(" ", 1)[1]
    try:
        user_id = _decode(token).get("sub")
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(401, "User not found")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    """Admin-only guard for the admin panel (keys, users, insights)."""
    if not getattr(user, "is_admin", False):
        raise HTTPException(403, "Admin access required")
    return user


# ---------- Separate admin console auth (the /admin page) ----------
def create_admin_token(subject: str = "admin", days: int = 7) -> str:
    payload = {
        "sub": subject,
        "scope": "admin",  # distinguishes admin tokens from user tokens
        "exp": datetime.now(timezone.utc) + timedelta(days=days),
    }
    return jwt.encode(payload, _secret(), algorithm=_ALGO)


def require_admin(authorization: str = Header(default="")) -> str:
    """Guard for /api/admin/* — requires a valid ADMIN token (from /admin/login),
    not a regular user token. Returns the admin subject."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Admin authentication required")
    token = authorization.split(" ", 1)[1]
    try:
        data = _decode(token)
    except Exception:
        raise HTTPException(401, "Invalid or expired admin token")
    if data.get("scope") != "admin":
        raise HTTPException(403, "Admin access required")
    return data.get("sub", "admin")
