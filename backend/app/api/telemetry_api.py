"""
User-facing telemetry: the extension reports here when its anti-copy-block
override actually fires on a site (see extension/content-global.js). This is
a reporting signal for admin review only — see BypassEvent in app/models.py
for the full rationale. Nothing here judges or acts automatically.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BypassEvent, User
from app.security.ratelimit import rate_limit
from app.auth import get_current_user

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


class BypassEventIn(BaseModel):
    domain: str = ""


@router.post("/bypass-event", status_code=204)
def report_bypass_event(
    payload: BypassEventIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(20, 60)),
):
    domain = (payload.domain or "")[:200]
    db.add(BypassEvent(user_id=user.id, domain=domain))
    db.commit()
    # Self-trim, same pattern as ErrorLog — this is a signal feed, not an archive.
    count = db.query(BypassEvent).count()
    if count > 5000:
        stale = (
            db.query(BypassEvent.id)
            .order_by(BypassEvent.created_at.asc())
            .limit(count - 5000)
            .all()
        )
        ids = [row[0] for row in stale]
        db.query(BypassEvent).filter(BypassEvent.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
