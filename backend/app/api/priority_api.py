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


@router.post("/cron/scan-priority")
def cron_scan_priority(secret: str = Query(default=""), db: Session = Depends(get_db)):
    """Called by the external cron (e.g. every 15 min). Scans every Gmail-connected
    user and pushes any NEW priority emails. Protected by CRON_SECRET."""
    if not settings.cron_secret or secret != settings.cron_secret:
        raise HTTPException(403, "Forbidden")

    user_ids = [
        c.user_id
        for c in db.query(Connection)
        .filter(Connection.provider == "google", Connection.status == "connected")
        .all()
    ]
    total_new = 0
    for uid in user_ids:
        new_rows = priority.scan_user(db, uid)
        for row in new_rows:
            push.notify_user(
                db, uid, f"⭐ {row.category or 'Priority email'}", row.subject, "/"
            )
            row.pushed = True
            total_new += 1
    db.commit()
    return {"users": len(user_ids), "new_priority": total_new}
