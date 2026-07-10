"""Priority inbox API + its cron scan endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import priority, push
from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import Connection, PriorityEmail, User
from app.schemas import PriorityEmailOut

router = APIRouter(prefix="/api", tags=["priority"])


@router.get("/priority", response_model=list[PriorityEmailOut])
def list_priority(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(PriorityEmail)
        .filter(PriorityEmail.user_id == user.id)
        .order_by(PriorityEmail.created_at.desc())
        .all()
    )


@router.post("/priority/scan")
def scan_now(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """On-demand scan (when the user opens the Priority page / taps refresh)."""
    new_rows = priority.scan_user(db, user.id)
    return {"new": len(new_rows)}


@router.delete("/priority/{pid}", status_code=204)
def dismiss(
    pid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    row = db.get(PriorityEmail, pid)
    if row and row.user_id == user.id:
        db.delete(row)
        db.commit()


def _should_scan(user: User, now_utc) -> bool:
    """Decide if it's time to auto-scan THIS user, per their chosen schedule."""
    from datetime import datetime, timedelta

    freq = user.priority_scan_freq or "off"
    if freq == "off":
        return False
    last = None
    if user.last_priority_scan:
        try:
            last = datetime.fromisoformat(user.last_priority_scan)
        except Exception:
            last = None
    mins_since = (now_utc - last).total_seconds() / 60 if last else 1e9

    if freq == "15m":
        return mins_since >= 14  # effectively every cron tick (cron runs 15-min)
    if freq == "1h":
        return mins_since >= 55
    if freq == "5h":
        return mins_since >= 295

    # Time-of-day options (in the user's local time). Don't repeat within 3h.
    local = now_utc - timedelta(minutes=user.tz_offset_min or 0)
    hour = local.hour
    morning = 7 <= hour < 10
    night = 20 <= hour < 23
    if mins_since < 180:
        return False
    if freq == "morning":
        return morning
    if freq == "night":
        return night
    if freq == "morning_night":
        return morning or night
    return False


@router.post("/cron/scan-priority")
def cron_scan_priority(secret: str = Query(default=""), db: Session = Depends(get_db)):
    """Called by the external cron (e.g. every 15 min). For each Gmail-connected
    user it checks their auto-scan schedule and, if due, scans + pushes new
    priority emails. Protected by CRON_SECRET."""
    if not settings.cron_secret or secret != settings.cron_secret:
        raise HTTPException(403, "Forbidden")

    from datetime import datetime

    now_utc = datetime.utcnow()
    connected = (
        db.query(Connection)
        .filter(Connection.provider == "google", Connection.status == "connected")
        .all()
    )
    # Heartbeat: lets the app SHOW users whether this background checker is
    # actually running (the #1 cause of "no notification came").
    from app.security import secret_store

    try:
        secret_store.set_secret("heartbeat_scan", now_utc.isoformat())
    except Exception:
        pass

    scanned, total_new = 0, 0
    for conn in connected:
        user = db.get(User, conn.user_id)
        if not user:
            continue
        # New-mail alerts run EVERY tick for opted-in users (cheap, no LLM) —
        # independent of their priority-scan frequency.
        if getattr(user, "notify_new_mail", False):
            priority.check_new_mail(db, user.id)
        if not _should_scan(user, now_utc):
            continue
        scanned += 1
        new_rows = priority.scan_user(db, user.id)
        for row in new_rows:
            push.notify_user(
                db, user.id, f"⭐ {row.category or 'Priority email'}", row.subject, "/"
            )
            row.pushed = True
            total_new += 1
        user.last_priority_scan = now_utc.isoformat()
    db.commit()

    # ---- Second-chance escalation (the core USP safety net) ----
    # A priority email still sitting there (not dismissed) hours after detection
    # means the user probably hasn't seen it. Alert ONCE more, louder: a push
    # plus an alarm-grade calendar event a few minutes out.
    from datetime import timedelta, timezone as _tz

    from app.calendar_bridge import mirror_reminder

    cutoff = datetime.now(_tz.utc) - timedelta(hours=4)
    stale = (
        db.query(PriorityEmail)
        .filter(
            PriorityEmail.escalated == False,  # noqa: E712
            PriorityEmail.created_at <= cutoff,
        )
        .limit(100)
        .all()
    )
    escalated = 0
    for p in stale:
        push.notify_user(
            db, p.user_id, "⏰ Still unread — priority email", p.subject, "/"
        )
        mirror_reminder(
            p.user_id,
            f"Unread priority: {p.subject[:60]}",
            (datetime.utcnow() + timedelta(minutes=10)).isoformat(),
            alarm=True,
        )
        p.escalated = True
        escalated += 1
    db.commit()
    return {"scanned_users": scanned, "new_priority": total_new, "escalated": escalated}
