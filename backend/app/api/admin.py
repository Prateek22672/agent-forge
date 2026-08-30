"""
Admin panel API (admin-only).

SECURITY: full API keys are NEVER returned by any endpoint here — only a masked
form (gsk_XX…last4) plus usage counts. Keys live in the OS keychain. Adding a key
is write-only (it goes in, it never comes back out). So nothing here is scrapable
to recover a real key, even by an authenticated admin.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import admin_audit
from app import keys as key_manager
from app import usage
from app.auth import create_admin_token, require_admin, verify_password
from app.config import settings
from app.database import get_db
from app.models import AdminAudit, BypassEvent, ErrorLog, LoginEvent, User
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
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit(8, 60)),  # Crocs: throttle admin brute force
):
    """Separate admin login. Accepts the dedicated console credentials
    (ADMIN_USERNAME/ADMIN_PASSWORD, default dj/dj), OR an is_admin user's
    email+password. Returns an admin-scoped token. Every attempt (success and
    failure) is written to the admin audit trail."""
    u = (payload.username or "").strip()
    ip = admin_audit.client_ip(request)
    # 1) Dedicated console account.
    if u == settings.admin_username and payload.password == settings.admin_password:
        admin_audit.record(db, "login", subject="console", ip=ip, ok=True)
        return {"admin_token": create_admin_token("console"), "name": "Console admin"}
    # 2) A promoted (is_admin) user signing in with their own credentials.
    user = db.query(User).filter(User.email == u.lower()).first()
    if user and user.is_admin and verify_password(payload.password, user.password_hash):
        admin_audit.record(db, "login", subject=user.email, ip=ip, ok=True)
        return {"admin_token": create_admin_token(user.id), "name": user.email}
    # Failure — record the attempted username + IP (breach/brute-force signal).
    admin_audit.record(db, "login_fail", subject=u[:120], ip=ip, ok=False,
                       detail="invalid admin credentials")
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
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import func

    from app.config import settings

    stats = usage.snapshot()
    groq_env = settings.groq_key_pool
    gemini_env = [settings.gemini_api_key] if settings.gemini_api_key else []
    groq_all = key_manager.groq_keys()
    gemini_all = key_manager.gemini_keys()

    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    logins_today = db.query(LoginEvent).filter(LoginEvent.created_at >= day_ago).count()
    logins_7d = db.query(LoginEvent).filter(LoginEvent.created_at >= week_ago).count()
    by_source_rows = (
        db.query(LoginEvent.source, func.count(LoginEvent.id))
        .filter(LoginEvent.created_at >= week_ago)
        .group_by(LoginEvent.source)
        .all()
    )
    active_users_7d = (
        db.query(func.count(func.distinct(LoginEvent.user_id)))
        .filter(LoginEvent.created_at >= week_ago)
        .scalar()
        or 0
    )

    errors_24h = db.query(ErrorLog).filter(ErrorLog.created_at >= day_ago).count()
    recent_errors = (
        db.query(ErrorLog).order_by(ErrorLog.created_at.desc()).limit(20).all()
    )
    # Slowest endpoints in the last 24h — where to look first for lag complaints.
    slow_rows = (
        db.query(ErrorLog.path, func.avg(ErrorLog.duration_ms), func.count(ErrorLog.id))
        .filter(ErrorLog.created_at >= day_ago, ErrorLog.duration_ms > 0)
        .group_by(ErrorLog.path)
        .order_by(func.avg(ErrorLog.duration_ms).desc())
        .limit(10)
        .all()
    )

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
        "engagement": {
            "logins_today": logins_today,
            "logins_7d": logins_7d,
            "active_users_7d": active_users_7d,
            "by_source_7d": {src: n for src, n in by_source_rows},
        },
        "health": {
            "errors_24h": errors_24h,
            "recent_errors": [
                {
                    "source": e.source,
                    "method": e.method,
                    "path": e.path,
                    "status_code": e.status_code,
                    "message": e.message,
                    "duration_ms": e.duration_ms,
                    "created_at": e.created_at,
                }
                for e in recent_errors
            ],
            "slowest_endpoints_24h": [
                {"path": p, "avg_ms": round(avg or 0), "count": n} for p, avg, n in slow_rows
            ],
        },
    }


@router.get("/metrics")
def performance_metrics(
    window: int = 60,
    admin: str = Depends(require_admin),
):
    """Everything about how the models are actually performing, plus what to
    do about it.

    One call rather than five, because a dashboard that refreshes every few
    seconds should cost one round trip. `window` is in minutes.
    """
    from app import metrics
    from app import runtime_settings
    from app.config import settings as cfg
    from app.util.answer_pipeline import answer_cache

    window = max(5, min(int(window or 60), 1440))
    data = metrics.summary(window)
    data["suggestions"] = metrics.suggestions(data)
    # What is actually configured right now - the numbers above mean little
    # without knowing which models produced them.
    data["config"] = {
        "fast_model": runtime_settings.get("fast_model") or cfg.fast_model,
        "vision_model": runtime_settings.get("vision_model") or cfg.vision_model,
        "agent_model": runtime_settings.get("default_model") or cfg.default_model,
        "gemini_vision_model": cfg.gemini_vision_model,
        "provider": runtime_settings.get("llm_provider"),
        "groq_keys": len(key_manager.groq_keys()),
        "gemini_keys": len(key_manager.gemini_keys()),
        "cache_entries": len(getattr(answer_cache, "_data", {})),
    }
    return data


@router.post("/metrics/reset")
def reset_metrics(
    request: Request,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    """Clear the rolling window - useful right after fixing something, to see
    whether the fix actually held."""
    from app import metrics

    metrics.reset()
    admin_audit.record(db, "metrics.reset", ip=request.client.host if request.client else "")
    return {"ok": True}


@router.get("/users/recent-logins")
def recent_logins(db: Session = Depends(get_db), admin: str = Depends(require_admin)):
    """Who's actually using AgentFury lately — last 50 logins, newest first."""
    rows = (
        db.query(LoginEvent, User)
        .join(User, LoginEvent.user_id == User.id)
        .order_by(LoginEvent.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "email": u.email,
            "source": ev.source,
            "method": ev.method,
            "created_at": ev.created_at,
        }
        for ev, u in rows
    ]


def _test_groq_key(key: str) -> tuple[bool, str]:
    """Ping Groq with a 1-token request to prove the key actually works right
    now. Returns (ok, detail) — detail is 'ok' or a short reason."""
    import httpx

    try:
        r = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": "openai/gpt-oss-20b",
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
            },
            timeout=10.0,
        )
        if r.status_code == 200:
            return True, "ok"
        if r.status_code == 401:
            return False, "invalid key (401)"
        if r.status_code == 429:
            return False, "rate-limited (429)"
        return False, f"HTTP {r.status_code}"
    except Exception as exc:
        return False, f"{type(exc).__name__}"


def _test_gemini_key(key: str) -> tuple[bool, str]:
    import httpx

    from app.config import settings

    try:
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{settings.gemini_model}:generateContent?key={key}",
            json={"contents": [{"parts": [{"text": "ping"}]}]},
            timeout=10.0,
        )
        if r.status_code == 200:
            return True, "ok"
        if r.status_code in (400, 401, 403):
            return False, "invalid key / bad format"
        if r.status_code == 429:
            return False, "rate-limited (429)"
        return False, f"HTTP {r.status_code}"
    except Exception as exc:
        return False, f"{type(exc).__name__}"


@router.get("/keys/health")
def keys_health(admin: str = Depends(require_admin)):
    """Live health check: actually CALL each key's provider and report whether
    it works right now. Keys are tested server-side and never returned — only a
    masked form + status. Runs the tests concurrently so a pool of keys checks
    in a couple of seconds, not one-timeout-at-a-time."""
    from concurrent.futures import ThreadPoolExecutor

    groq = key_manager.groq_keys()
    gemini = key_manager.gemini_keys()

    with ThreadPoolExecutor(max_workers=10) as ex:
        groq_results = list(ex.map(_test_groq_key, groq))
        gemini_results = list(ex.map(_test_gemini_key, gemini))

    def rows(keys, results):
        out = []
        for k, (ok, detail) in zip(keys, results):
            out.append({"masked": key_manager.mask(k), "suffix": k[-4:], "ok": ok, "detail": detail})
        return out

    groq_rows = rows(groq, groq_results)
    gemini_rows = rows(gemini, gemini_results)
    return {
        "groq": {"total": len(groq), "working": sum(1 for r in groq_rows if r["ok"]), "keys": groq_rows},
        "gemini": {"total": len(gemini), "working": sum(1 for r in gemini_rows if r["ok"]), "keys": gemini_rows},
    }


@router.get("/flagged-users")
def flagged_users(db: Session = Depends(get_db), admin: str = Depends(require_admin)):
    """Accounts whose extension has repeatedly hit sites that try to block
    copying, grouped by user with their top domains — for manual review, NOT
    an automatic verdict. Most hits here are completely ordinary (any news
    site, blog, or forum with basic copy-protection triggers this ). What's
    worth a human look is a account with a very high count concentrated on
    ONE domain, especially one you have reason to think uses consented
    screen-monitoring (a student explicitly told to share their screen)."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import func

    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = (
        db.query(
            BypassEvent.user_id,
            BypassEvent.domain,
            func.count(BypassEvent.id).label("hits"),
            func.max(BypassEvent.created_at).label("last_hit"),
        )
        .filter(BypassEvent.created_at >= since)
        .group_by(BypassEvent.user_id, BypassEvent.domain)
        .order_by(func.count(BypassEvent.id).desc())
        .limit(500)
        .all()
    )
    by_user: dict[str, dict] = {}
    for user_id, domain, hits, last_hit in rows:
        entry = by_user.setdefault(user_id, {"user_id": user_id, "total_hits": 0, "domains": []})
        entry["total_hits"] += hits
        entry["domains"].append({"domain": domain, "hits": hits, "last_hit": last_hit})

    users_by_id = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(by_user.keys())).all()
    } if by_user else {}

    out = []
    for user_id, entry in by_user.items():
        u = users_by_id.get(user_id)
        if not u:
            continue
        entry["domains"].sort(key=lambda d: d["hits"], reverse=True)
        out.append(
            {
                **entry,
                "email": u.email,
                "name": u.name,
                "is_suspended": u.is_suspended,
                "suspended_reason": u.suspended_reason,
            }
        )
    out.sort(key=lambda e: e["total_hits"], reverse=True)
    return out


class SuspendUser(BaseModel):
    suspended: bool
    reason: str = ""


@router.patch("/users/{user_id}/suspend")
def suspend_user(
    user_id: str,
    payload: SuspendUser,
    request: Request,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    """Manual review action only — never called automatically. Suspending
    blocks login (see auth_api.py / ext_auth_api.py / connections.py) until
    an admin lifts it here again."""
    from datetime import datetime, timezone

    if user_id == admin:
        raise HTTPException(400, "You can't suspend the account you're logged in as.")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_suspended = payload.suspended
    user.suspended_reason = payload.reason.strip()[:2000] if payload.suspended else ""
    user.suspended_at = datetime.now(timezone.utc) if payload.suspended else None
    db.commit()
    admin_audit.record(
        db, "user_suspend" if payload.suspended else "user_unsuspend",
        subject=admin, ip=admin_audit.client_ip(request), detail=user.email,
    )
    return {"id": user.id, "is_suspended": user.is_suspended}


class SendNotice(BaseModel):
    message: str


@router.patch("/users/{user_id}/notice")
def send_notice(
    user_id: str,
    payload: SendNotice,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    """Send (or clear, with an empty message) an in-app warning notice. The
    softer alternative to suspending — the user sees it next time they open
    the app and has to acknowledge it, but keeps their access."""
    from datetime import datetime, timezone

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    msg = payload.message.strip()[:2000]
    user.notice = msg
    user.notice_at = datetime.now(timezone.utc) if msg else None
    db.commit()
    return {"id": user.id, "notice": user.notice}


@router.get("/audit")
def audit_log(db: Session = Depends(get_db), admin: str = Depends(require_admin)):
    """Recent admin security events (last 100), newest first, plus a
    failed-login count for the last 30 min as a brute-force signal."""
    rows = db.query(AdminAudit).order_by(AdminAudit.created_at.desc()).limit(100).all()
    return {
        "failed_logins_30m": admin_audit.recent_failed_logins(db, 30),
        "events": [
            {
                "action": e.action,
                "subject": e.subject,
                "detail": e.detail,
                "ip": e.ip,
                "ok": e.ok,
                "created_at": e.created_at,
            }
            for e in rows
        ],
    }


@router.post("/keys")
def add_key(
    payload: AddKey,
    request: Request,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
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
    # Audit — never store the key itself, only that one was added and its last-4.
    admin_audit.record(db, "key_add", subject=admin, ip=admin_audit.client_ip(request),
                       detail=f"{payload.provider} …{payload.key.strip()[-4:]}")
    return {"added": True}


@router.delete("/keys/{provider}/{suffix}")
def remove_key(
    provider: str,
    suffix: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: str = Depends(require_admin),
):
    if not key_manager.remove_admin_key(provider, suffix):
        raise HTTPException(404, "Key not found or not removable (env keys live in .env).")
    admin_audit.record(db, "key_remove", subject=admin, ip=admin_audit.client_ip(request),
                       detail=f"{provider} …{suffix}")
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
                "is_suspended": u.is_suspended,
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
