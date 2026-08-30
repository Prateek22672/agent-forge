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


class ClientEventIn(BaseModel):
    """A failure the EXTENSION saw, reported by the extension."""

    kind: str = "error"      # error | timeout | context_invalid | blocked
    path: str = ""           # which API path it was calling
    status: int = 0
    message: str = ""
    version: str = ""        # extension version, so a bad release stands out
    ms: float = 0


@router.post("/client-event", status_code=204)
def report_client_event(
    payload: ClientEventIn,
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(30, 60)),
):
    """Record something that went wrong on the user's side.

    Server logs cannot see a request that timed out in the browser, a service
    worker Chrome evicted mid-call, or a fetch a corporate proxy ate - and
    those are exactly the ones that reach us as "it just stopped working".
    Kept in the rolling metrics window (not the database): it is a signal for
    the live dashboard, not an archive, and it must never become a way for a
    client to write unbounded rows.
    """
    from app import metrics

    metrics.record_client_event(
        payload.kind,
        path=payload.path,
        status=payload.status,
        message=payload.message,
        version=payload.version,
        ms=payload.ms,
    )
