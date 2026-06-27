"""Calendar API — list upcoming Google Calendar events + create one."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.integrations import google_oauth
from app.models import User
from app.util.timeparse import parse_when

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


class EventCreate(BaseModel):
    title: str
    when: str
    location: str = ""


@router.get("/events")
def list_events(user: User = Depends(get_current_user)):
    """Upcoming events. Returns {connected, granted, events} so the UI can show
    the right empty/connect state instead of erroring."""
    if not google_oauth.is_connected(user.id):
        return {"connected": False, "granted": False, "events": []}
    try:
        events = google_oauth.list_events(user.id, 15)
        return {"connected": True, "granted": True, "events": events}
    except Exception:
        # Connected but Calendar scope not granted (or transient API issue).
        return {"connected": True, "granted": False, "events": []}


@router.post("/events", status_code=201)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start = parse_when(payload.when, tz_offset_min=getattr(user, "tz_offset_min", 0) or 0)
    if not start:
        raise HTTPException(400, "Couldn't understand the time (e.g. 'tomorrow 10:30am').")
    end = start + timedelta(hours=1)
    try:
        link = google_oauth.create_event(
            user.id, payload.title, start.isoformat(), end.isoformat(), payload.location
        )
    except Exception as exc:
        raise HTTPException(400, str(exc))
    return {"link": link}
