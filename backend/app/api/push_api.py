"""Push subscription endpoints + the cron endpoint that fires due reminders."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import push
from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import PushSubscription, Reminder, User

router = APIRouter(prefix="/api", tags=["push"])


class SubscriptionIn(BaseModel):
    endpoint: str
    keys: dict  # { p256dh, auth }


@router.get("/push/vapid-public-key")
def vapid_public_key():
    return {"key": settings.vapid_public_key, "enabled": push.push_enabled()}


@router.post("/push/subscribe", status_code=201)
def subscribe(
    payload: SubscriptionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == payload.endpoint)
        .first()
    )
    if existing:
        existing.user_id = user.id
        existing.p256dh = payload.keys.get("p256dh", "")
        existing.auth = payload.keys.get("auth", "")
    else:
        db.add(
            PushSubscription(
                user_id=user.id,
                endpoint=payload.endpoint,
                p256dh=payload.keys.get("p256dh", ""),
                auth=payload.keys.get("auth", ""),
            )
        )
    db.commit()
    return {"ok": True}


@router.post("/push/test")
def test_push(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Send a test notification to the current user's devices, returning a full
    diagnostic so we can see WHY a push didn't arrive (e.g. on iOS)."""
    result = push.notify_user(
        db, user.id, "AgentFury", "Notifications are working.", "/"
    )
    return {"enabled": push.push_enabled(), **result}


@router.get("/push/health")
def push_health(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything the UI needs to tell the user WHY an alert might not arrive —
    and exactly how to fix it."""
    from app.security import secret_store

    subs = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user.id)
        .count()
    )
    return {
        "push_configured": push.push_enabled(),
        "device_subscriptions": subs,
        "cron_reminders_last": secret_store.get_secret("heartbeat_reminders") or "",
        "cron_scan_last": secret_store.get_secret("heartbeat_scan") or "",
        "notify_new_mail": getattr(user, "notify_new_mail", False),
        "scan_freq": getattr(user, "priority_scan_freq", "off"),
        "server_now": datetime.utcnow().isoformat(),
    }


# ---------- Cron: every-minute pass (reminders + new-mail alerts) ----------
# ACKs instantly and works on a background thread so the external pinger's short
# timeout can never kill it. This 1-min ping also keeps the free instance awake.
import threading

_min_lock = threading.Lock()
_min_running = False


def _run_minute_pass() -> None:
    """Fire due reminders + check new mail for opted-in users (cheap, no LLM)."""
    global _min_running
    from app import priority
    from app.database import SessionLocal
    from app.models import Connection, User
    from app.security import secret_store

    db = SessionLocal()
    try:
        now = datetime.utcnow().isoformat()  # due_at is stored as naive-UTC ISO
        # Heartbeat so the UI can prove/deny that this checker is running.
        try:
            secret_store.set_secret("heartbeat_reminders", now)
        except Exception:
            pass

        # 1. Due reminders -> push.
        due = (
            db.query(Reminder)
            .filter(
                Reminder.status == "pending",
                Reminder.notified == False,  # noqa: E712
                Reminder.due_at != "",
                Reminder.due_at <= now,
            )
            .all()
        )
        for r in due:
            push.notify_user(db, r.user_id, "⏰ Reminder", r.title, "/")
            r.notified = True
        db.commit()

        # 2. New-mail alerts EVERY MINUTE for opted-in users — near-instant
        #    "you've got mail" without waiting for the 15-min priority scan.
        connected = (
            db.query(Connection)
            .filter(Connection.provider == "google", Connection.status == "connected")
            .all()
        )
        for conn in connected:
            try:
                user = db.get(User, conn.user_id)
                if user is not None and getattr(user, "notify_new_mail", False):
                    priority.check_new_mail(db, user.id)
            except Exception:
                db.rollback()
    except Exception:
        pass
    finally:
        db.close()
        with _min_lock:
            _min_running = False


@router.post("/cron/fire-reminders")
def fire_reminders(secret: str = Query(default="")):
    """Called every minute by an external cron (cron-job.org). Returns instantly;
    the pass (due reminders + new-mail alerts) runs in the background."""
    global _min_running
    if not settings.cron_secret or secret != settings.cron_secret:
        raise HTTPException(403, "Forbidden")
    with _min_lock:
        if _min_running:
            return {"started": False, "reason": "previous pass still running"}
        _min_running = True
    threading.Thread(target=_run_minute_pass, daemon=True).start()
    return {"started": True}
