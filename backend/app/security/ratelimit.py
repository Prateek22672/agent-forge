"""
Crocs — rate limiting.

A small in-memory sliding-window limiter used as a FastAPI dependency on
sensitive endpoints (login, admin login, email send). It blunts brute-force
password guessing and send-spam without any external dependency. Keyed by client
IP + path. For multi-instance production you'd back this with Redis, but for the
self-hosted single-process app this is the right amount of protection.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import HTTPException, Request

_hits: dict[str, list[float]] = defaultdict(list)
_lock = threading.Lock()


def rate_limit(max_requests: int, window_seconds: int):
    """Dependency factory: allow at most `max_requests` per `window_seconds`."""

    def _dep(request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        key = f"{ip}:{request.url.path}"
        now = time.time()
        with _lock:
            recent = [t for t in _hits[key] if now - t < window_seconds]
            if len(recent) >= max_requests:
                raise HTTPException(
                    status_code=429,
                    detail="Too many attempts. Please wait a moment and try again.",
                )
            recent.append(now)
            _hits[key] = recent

    return _dep
