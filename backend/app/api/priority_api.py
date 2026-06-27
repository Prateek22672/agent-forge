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
    scanned, total_new = 0, 0
    for conn in connected:
        user = db.get(User, conn.user_id)
        if not user or not _should_scan(user, now_utc):
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
    return {"scanned_users": scanned, "new_priority": total_new}
