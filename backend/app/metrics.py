"""Per-call performance metrics for the admin console.

WHAT THIS ANSWERS
    usage.py already counts "how many calls went to which key". That says
    nothing about the things that actually go wrong in production and that the
    admin panel existed to surface:

        * which model is slow, right now, and by how much
        * which endpoint is failing, and with what error
        * whether the cache is doing anything
        * how often OCR has to be re-run on a second provider
        * which key is quietly rate-limiting while the pool hides it
        * whether the EXTENSION is seeing failures the server never logs
          (a timeout, a dead service worker, a blocked fetch)

    So: one record per model call, kept in a rolling window in memory, plus
    small per-key and per-endpoint rollups.

WHY IN MEMORY
    The whole point is a fast read for a dashboard that refreshes every few
    seconds. A ring of a few thousand dicts costs a couple of MB, needs no
    schema, no migration and no extra service, and the aggregates that must
    outlive a restart (counts, failures per key) are snapshotted to a small
    JSON file. If this ever needs to survive multiple instances, the recording
    interface stays and only the storage behind it changes - that is why
    everything goes through record_call() rather than touching a dict.

NEVER RAISES
    Instrumentation that can break a request is worse than no instrumentation.
    Every public function here swallows its own errors.
"""
from __future__ import annotations

import json
import statistics
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from app.config import settings

_PATH = settings.data_dir / "metrics.json"
_MAX_EVENTS = 3000  # a couple of MB, plenty for a rolling day on one instance

_lock = threading.Lock()
_events: deque[dict] = deque(maxlen=_MAX_EVENTS)
_keys: dict[str, dict] = {}      # key suffix -> counters + last error
_client: deque[dict] = deque(maxlen=400)  # failures reported BY the extension
_last_save = 0.0


def _now() -> float:
    return time.time()


def _load() -> None:
    """Bring back the counters that should survive a restart."""
    try:
        if not _PATH.exists():
            return
        data = json.loads(_PATH.read_text(encoding="utf-8"))
        _keys.update(data.get("keys") or {})
    except Exception:
        pass


_load()


def _save(force: bool = False) -> None:
    global _last_save
    if not force and _now() - _last_save < 30:
        return  # at most twice a minute; this is a nicety, not a ledger
    _last_save = _now()
    try:
        _PATH.write_text(json.dumps({"keys": _keys}), encoding="utf-8")
    except Exception:
        pass


def record_call(
    kind: str,
    *,
    model: str = "",
    provider: str = "",
    ms: float = 0.0,
    ok: bool = True,
    cached: bool = False,
    fallback: bool = False,
    key_suffix: str = "",
    error: str = "",
    extra: dict | None = None,
) -> None:
    """One model call. `kind` is the feature, not the URL: answer, image_ocr,
    proof, polish, search_answer - what a human would ask about."""
    try:
        event = {
            "t": _now(),
            "kind": kind,
            "model": model,
            "provider": provider,
            "ms": round(float(ms), 1),
            "ok": bool(ok),
            "cached": bool(cached),
            "fallback": bool(fallback),
            "key": key_suffix,
            "error": (error or "")[:300],
        }
        if extra:
            event.update({k: v for k, v in extra.items() if k not in event})
        with _lock:
            _events.append(event)
            if key_suffix:
                k = _keys.setdefault(
                    key_suffix,
                    {"calls": 0, "failures": 0, "rate_limited": 0, "last_error": "", "last_seen": 0},
                )
                k["calls"] += 1
                k["last_seen"] = event["t"]
                if not ok:
                    k["failures"] += 1
                    k["last_error"] = event["error"]
                    low = event["error"].lower()
                    if "rate" in low and "limit" in low or "429" in low:
                        k["rate_limited"] += 1
            _save()
    except Exception:
        pass


def record_client_event(
    kind: str, *, path: str = "", status: int = 0, message: str = "", version: str = "", ms: float = 0
) -> None:
    """A failure the EXTENSION saw. The server can't observe a timeout on the
    user's side, a service worker that was evicted mid-request, or a fetch a
    corporate proxy ate - but those are exactly the reports that arrive as
    "it just stopped working"."""
    try:
        with _lock:
            _client.append(
                {
                    "t": _now(),
                    "kind": (kind or "error")[:40],
                    "path": (path or "")[:120],
                    "status": int(status or 0),
                    "message": (message or "")[:300],
                    "version": (version or "")[:20],
                    "ms": round(float(ms or 0), 1),
                }
            )
    except Exception:
        pass


def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100.0) * (len(ordered) - 1)))))
    return round(ordered[idx], 1)


def _group(events: list[dict], field: str) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for e in events:
        buckets.setdefault(e.get(field) or "-", []).append(e)
    out = []
    for name, rows in buckets.items():
        live = [r for r in rows if not r["cached"]]
        times = [r["ms"] for r in live if r["ok"] and r["ms"] > 0]
        failures = [r for r in rows if not r["ok"]]
        out.append(
            {
                "name": name,
                "calls": len(rows),
                "ok_rate": round(100.0 * (len(rows) - len(failures)) / len(rows), 1) if rows else 0.0,
                "cached_rate": round(100.0 * sum(1 for r in rows if r["cached"]) / len(rows), 1) if rows else 0.0,
                "fallback_rate": round(100.0 * sum(1 for r in rows if r["fallback"]) / len(rows), 1) if rows else 0.0,
                "p50_ms": _pct(times, 50),
                "p95_ms": _pct(times, 95),
                "max_ms": round(max(times), 1) if times else 0.0,
                "failures": len(failures),
                "last_error": failures[-1]["error"] if failures else "",
            }
        )
    return sorted(out, key=lambda r: r["calls"], reverse=True)


def summary(window_minutes: int = 60) -> dict[str, Any]:
    """Everything the dashboard draws, in one read."""
    try:
        cutoff = _now() - window_minutes * 60
        with _lock:
            events = [e for e in _events if e["t"] >= cutoff]
            client = [c for c in _client if c["t"] >= cutoff]
            keys = {k: dict(v) for k, v in _keys.items()}

        live = [e for e in events if not e["cached"]]
        times = [e["ms"] for e in live if e["ok"] and e["ms"] > 0]
        failures = [e for e in events if not e["ok"]]

        errors: dict[str, dict] = {}
        for e in failures:
            row = errors.setdefault(e["error"][:160] or "unknown", {"count": 0, "kind": e["kind"], "last": 0})
            row["count"] += 1
            row["last"] = max(row["last"], e["t"])

        return {
            "window_minutes": window_minutes,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "totals": {
                "calls": len(events),
                "ok_rate": round(100.0 * (len(events) - len(failures)) / len(events), 1) if events else 100.0,
                "cache_hit_rate": round(100.0 * sum(1 for e in events if e["cached"]) / len(events), 1)
                if events
                else 0.0,
                "p50_ms": _pct(times, 50),
                "p95_ms": _pct(times, 95),
                "mean_ms": round(statistics.mean(times), 1) if times else 0.0,
                "failures": len(failures),
                "client_errors": len(client),
            },
            "by_feature": _group(events, "kind"),
            "by_model": _group(live, "model"),
            "by_provider": _group(live, "provider"),
            "keys": [
                {
                    "suffix": suffix,
                    **vals,
                    "failure_rate": round(100.0 * vals.get("failures", 0) / max(1, vals.get("calls", 0)), 1),
                }
                for suffix, vals in sorted(keys.items(), key=lambda kv: -kv[1].get("calls", 0))
            ],
            "top_errors": sorted(
                ({"message": m, **v} for m, v in errors.items()), key=lambda r: r["count"], reverse=True
            )[:10],
            "client_errors": list(reversed(client))[:40],
            "recent": list(reversed(events))[:60],
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "totals": {}, "by_feature": [], "by_model": [], "keys": []}


# ---------------------------------------------------------------------------
# The part that makes it a console rather than a wall of numbers: read the
# summary and say what to DO about it. Plain rules, deliberately - a model
# call to interpret metrics would be both slower and less predictable than
# the thresholds an operator would apply anyway.
# ---------------------------------------------------------------------------

def suggestions(data: dict | None = None) -> list[dict]:
    try:
        data = data or summary()
        out: list[dict] = []
        totals = data.get("totals") or {}
        calls = totals.get("calls", 0)

        if calls < 5:
            return [
                {
                    "level": "info",
                    "title": "Not enough traffic to judge yet",
                    "detail": f"Only {calls} model call(s) in the last {data.get('window_minutes', 60)} minutes. "
                    "Use the extension for a few minutes and the numbers here become meaningful.",
                }
            ]

        if totals.get("ok_rate", 100) < 97:
            out.append(
                {
                    "level": "critical" if totals["ok_rate"] < 90 else "warn",
                    "title": f"{100 - totals['ok_rate']:.1f}% of calls are failing",
                    "detail": "Check Top errors below - a single bad key or a retired model id is the usual cause.",
                }
            )

        p95 = totals.get("p95_ms", 0)
        if p95 > 3000:
            out.append(
                {
                    "level": "warn",
                    "title": f"Slow tail: p95 is {p95 / 1000:.1f}s",
                    "detail": "If p50 is much lower, this is cold connections rather than the model - confirm "
                    "warm_fast_models() is running at startup, and that the instance isn't being put to sleep "
                    "between requests.",
                }
            )

        if totals.get("cache_hit_rate", 0) < 5 and calls > 40:
            out.append(
                {
                    "level": "info",
                    "title": "The answer cache is barely being used",
                    "detail": "Almost every request is unique. Raising the cache TTL only helps if users repeat "
                    "themselves; if this stays near zero, the spend is genuine demand, not waste.",
                }
            )

        for row in data.get("by_feature", []):
            if row["calls"] >= 5 and row["fallback_rate"] > 20:
                out.append(
                    {
                        "level": "warn",
                        "title": f"{row['name']}: falling back {row['fallback_rate']:.0f}% of the time",
                        "detail": "The first provider is being rejected that often - it is now costing latency "
                        "rather than saving it. Consider making the fallback model primary for this feature.",
                    }
                )
            if row["calls"] >= 5 and row["p95_ms"] > 6000:
                out.append(
                    {
                        "level": "warn",
                        "title": f"{row['name']} is the slow one (p95 {row['p95_ms'] / 1000:.1f}s)",
                        "detail": "Compare against the other features below - if it is alone, the model or the "
                        "payload size for that feature is the cause, not the host.",
                    }
                )

        for key in data.get("keys", []):
            if key.get("calls", 0) >= 10 and key.get("failure_rate", 0) > 25:
                out.append(
                    {
                        "level": "critical",
                        "title": f"Key …{key['suffix']} fails {key['failure_rate']:.0f}% of its calls",
                        "detail": f"Last error: {key.get('last_error') or 'unknown'}. Rotate or remove it - the "
                        "pool is spreading load onto a key that mostly errors.",
                    }
                )
            elif key.get("rate_limited", 0) >= 5:
                out.append(
                    {
                        "level": "warn",
                        "title": f"Key …{key['suffix']} is being rate limited",
                        "detail": f"{key['rate_limited']} rate-limit responses. Add another key to spread the load.",
                    }
                )

        client = data.get("client_errors") or []
        if len(client) >= 5:
            worst: dict[str, int] = {}
            for c in client:
                worst[c.get("message", "")[:80]] = worst.get(c.get("message", "")[:80], 0) + 1
            top = max(worst.items(), key=lambda kv: kv[1])
            out.append(
                {
                    "level": "warn",
                    "title": f"{len(client)} failures reported by the extension",
                    "detail": f'Most common: "{top[0]}" ({top[1]}x). These never reach the server logs - they are '
                    "timeouts, dead service workers, or blocked requests on the user's side.",
                }
            )

        if not out:
            out.append(
                {
                    "level": "good",
                    "title": "Everything is healthy",
                    "detail": f"{calls} calls, {totals.get('ok_rate', 0):.1f}% succeeded, "
                    f"p50 {totals.get('p50_ms', 0) / 1000:.2f}s, p95 {totals.get('p95_ms', 0) / 1000:.2f}s.",
                }
            )
        return out
    except Exception as exc:  # noqa: BLE001
        return [{"level": "info", "title": "Suggestions unavailable", "detail": str(exc)}]


def reset() -> None:
    with _lock:
        _events.clear()
        _client.clear()
        _keys.clear()
    _save(force=True)
