"""
Runtime-mutable settings (overlay on top of .env defaults).

Some settings — like "use cloud Groq vs local Ollama" — should be flippable from
the UI without editing files or restarting. We persist those overrides in a small
JSON file under data/ and read them with get(). Anything not overridden falls
back to the .env-backed `settings` object.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config import settings

_PATH: Path = settings.data_dir / "runtime_settings.json"

# Which keys the UI is allowed to change, with their fallback from .env.
_DEFAULTS = {
    "llm_provider": settings.llm_provider,   # "groq" | "ollama"
    "ollama_model": settings.ollama_model,
    "default_model": settings.default_model,
}


def _load() -> dict[str, Any]:
    if _PATH.exists():
        try:
            return json.loads(_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def get(key: str) -> Any:
    return _load().get(key, _DEFAULTS.get(key))


def all_settings() -> dict[str, Any]:
    data = dict(_DEFAULTS)
    data.update(_load())
    return data


def set_many(updates: dict[str, Any]) -> dict[str, Any]:
    data = _load()
    for k, v in updates.items():
        if k in _DEFAULTS:  # only allow known keys
            data[k] = v
    _PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return all_settings()
