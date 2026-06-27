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
        db, user.id, "AgentForge", "Notifications are working.", "/"
    )
    return {"enabled": push.push_enabled(), **result}


# ---------- Cron: fire due reminders ----------
@router.post("/cron/fire-reminders")
def fire_reminders(
    secret: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Called every minute by an external cron (cron-job.org). Finds reminders
    whose time has arrived and pushes them. Protected by CRON_SECRET."""
    if not settings.cron_secret or secret != settings.cron_secret:
        raise HTTPException(403, "Forbidden")

    now = datetime.utcnow().isoformat()  # due_at is stored as naive-UTC ISO
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
    fired = 0
    for r in due:
        push.notify_user(db, r.user_id, "⏰ Reminder", r.title, "/")
        r.notified = True
        fired += 1
    db.commit()
    return {"checked_at": now, "fired": fired}
