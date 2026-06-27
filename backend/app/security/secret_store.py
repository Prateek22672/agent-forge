"""
Secret storage — the most sensitive thing in the app (OAuth tokens, API keys).

Three backends, chosen automatically:
  1. CLOUD (DATABASE_URL set): an **encrypted row in the database**. Values are
     Fernet-encrypted with a key derived from SECRET_KEY, so the DB never holds a
     usable secret — even a leaked DB dump is useless without SECRET_KEY.
  2. LOCAL with a keychain: the **OS keychain** (Windows Credential Manager /
     macOS Keychain / libsecret) — encrypted by the OS, the strongest local option.
  3. LOCAL fallback (rare, headless): a JSON file under data/.

This is why the same code runs privately on your machine AND on Render without
ever putting a raw secret on disk in the clear.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

from app.config import settings

SERVICE = "AgentForge"


# ---------- encryption (cloud) ----------
def _fernet():
    from cryptography.fernet import Fernet

    from app.auth import _secret

    # Derive a stable 32-byte Fernet key from SECRET_KEY (urlsafe base64).
    key = base64.urlsafe_b64encode(hashlib.sha256(_secret().encode()).digest())
    return Fernet(key)


def _db_set(key: str, value: str) -> None:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import Secret

    token = _fernet().encrypt(value.encode()).decode()
    db = SessionLocal()
    try:
        row = db.execute(select(Secret).where(Secret.key == key)).scalar_one_or_none()
        if row:
            row.value = token
        else:
            db.add(Secret(key=key, value=token))
        db.commit()
    finally:
        db.close()


def _db_get(key: str) -> str | None:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import Secret

    db = SessionLocal()
    try:
        row = db.execute(select(Secret).where(Secret.key == key)).scalar_one_or_none()
    finally:
        db.close()
    if not row:
        return None
    try:
        return _fernet().decrypt(row.value.encode()).decode()
    except Exception:
        return None


def _db_delete(key: str) -> None:
    from app.database import SessionLocal
    from app.models import Secret

    db = SessionLocal()
    try:
        row = db.get(Secret, key)
        if row:
            db.delete(row)
            db.commit()
    finally:
        db.close()


# ---------- local file fallback ----------
def _fallback_path() -> Path:
    return settings.data_dir / "secrets_fallback.json"


# ---------- public API ----------
def set_secret(key: str, value: str) -> None:
    if settings.is_cloud:
        _db_set(key, value)
        return
    try:
        import keyring

        keyring.set_password(SERVICE, key, value)
        return
    except Exception:
        pass
    path = _fallback_path()
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data[key] = value
    path.write_text(json.dumps(data), encoding="utf-8")


def get_secret(key: str) -> str | None:
    if settings.is_cloud:
        return _db_get(key)
    try:
        import keyring

        val = keyring.get_password(SERVICE, key)
        if val is not None:
            return val
    except Exception:
        pass
    path = _fallback_path()
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8")).get(key)
    return None


def delete_secret(key: str) -> None:
    if settings.is_cloud:
        _db_delete(key)
        return
    try:
        import keyring

        keyring.delete_password(SERVICE, key)
    except Exception:
        pass
    path = _fallback_path()
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        data.pop(key, None)
        path.write_text(json.dumps(data), encoding="utf-8")
