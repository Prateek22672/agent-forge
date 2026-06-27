"""
Key manager — the single source of truth for which API keys exist.

Keys come from two places:
  • .env       (GROQ_API_KEY / GROQ_API_KEYS / GEMINI_API_KEY) — read-only.
  • admin-added (via the admin panel) — stored in the OS KEYCHAIN, not plaintext.

The merged, de-duplicated pool is what the router rotates over. Adding a key
checks for duplicates and basic format, so you can't add the same key twice.
"""
from __future__ import annotations

import json

from app.config import settings
from app.security import secret_store

_GROQ_STORE = "admin_groq_keys"
_GEMINI_STORE = "admin_gemini_keys"


def _stored(name: str) -> list[str]:
    raw = secret_store.get_secret(name)
    if not raw:
        return []
    try:
        return json.loads(raw)
    except Exception:
        return []


def _save(name: str, items: list[str]) -> None:
    secret_store.set_secret(name, json.dumps(items))


def _dedupe(items: list[str]) -> list[str]:
    seen, out = set(), []
    for k in items:
        k = (k or "").strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def groq_keys() -> list[str]:
    return _dedupe(settings.groq_key_pool + _stored(_GROQ_STORE))


def gemini_keys() -> list[str]:
    env = [settings.gemini_api_key] if settings.gemini_api_key else []
    return _dedupe(env + _stored(_GEMINI_STORE))


def mask(key: str) -> str:
    return f"{key[:6]}…{key[-4:]}" if len(key) > 12 else "…"


def add_key(provider: str, key: str) -> tuple[bool, str]:
    """Returns (added, reason). Reasons: 'added', 'duplicate', 'empty',
    'bad_format'."""
    key = (key or "").strip()
    if not key:
        return False, "empty"

    if provider == "groq":
        if not key.startswith("gsk_"):
            return False, "bad_format"
        if key in groq_keys():
            return False, "duplicate"
        items = _stored(_GROQ_STORE)
        items.append(key)
        _save(_GROQ_STORE, _dedupe(items))
        return True, "added"

    if provider == "gemini":
        if key in gemini_keys():
            return False, "duplicate"
        items = _stored(_GEMINI_STORE)
        items.append(key)
        _save(_GEMINI_STORE, _dedupe(items))
        return True, "added"

    return False, "bad_provider"


def remove_admin_key(provider: str, key_suffix: str) -> bool:
    """Remove an ADMIN-ADDED key by its last-4 suffix (env keys can't be removed
    here — they live in .env)."""
    store = _GROQ_STORE if provider == "groq" else _GEMINI_STORE
    items = _stored(store)
    kept = [k for k in items if not k.endswith(key_suffix)]
    if len(kept) == len(items):
        return False
    _save(store, kept)
    return True
