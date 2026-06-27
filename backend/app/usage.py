"""
Lightweight usage tracking for the admin panel.

We count how many requests were routed to each provider and each individual key
(by masked suffix). It's deliberately simple: an in-memory dict persisted to
data/usage.json so the numbers survive restarts. Good enough for insights without
adding a metrics stack.
"""
from __future__ import annotations

import json
import threading

from app.config import settings

_PATH = settings.data_dir / "usage.json"
_lock = threading.Lock()


def _load() -> dict:
    if _PATH.exists():
        try:
            return json.loads(_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


_data: dict = _load()


def record(provider: str, key_suffix: str = "") -> None:
    """Count one request routed to a provider/key."""
    with _lock:
        prov = _data.setdefault(provider, {"total": 0, "keys": {}})
        prov["total"] += 1
        if key_suffix:
            prov["keys"][key_suffix] = prov["keys"].get(key_suffix, 0) + 1
        try:
            _PATH.write_text(json.dumps(_data), encoding="utf-8")
        except Exception:
            pass


def snapshot() -> dict:
    with _lock:
        # Deep-ish copy so callers can't mutate our state.
        return {
            p: {"total": v.get("total", 0), "keys": dict(v.get("keys", {}))}
            for p, v in _data.items()
        }


def total_calls() -> int:
    with _lock:
        return sum(v.get("total", 0) for v in _data.values())
