"""Calendar API — list/create Google Calendar events + a per-user ICS feed that
Apple Calendar (or any calendar app) can SUBSCRIBE to (reminders + priority
emails), since Apple has no direct API for third-party event pushes."""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.integrations import google_oauth
from app.models import PriorityEmail, Reminder, User
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


@router.post("/test")
def test_calendar(user: User = Depends(get_current_user)):
    """Create a test event ~2 minutes out with a popup reminder — if the phone
    gets a Google Calendar notification, the whole channel is proven working.
    Returns the real error when it isn't (scope missing, not connected…)."""
    try:
        start = datetime.utcnow() + timedelta(minutes=2)
        link = google_oauth.create_event(
            user.id,
            "🔔 AgentFury calendar test",
            start.isoformat(),
            (start + timedelta(minutes=15)).isoformat(),
            description=(
                "If your phone showed a Google Calendar notification for this, "
                "calendar alerts are working. You can delete this event."
            ),
            reminder_minutes=0,
        )
        return {"ok": True, "link": link}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:300]}


# ---------- ICS subscribe feed (Apple Calendar & friends) ----------
def _feed_sig(user_id: str) -> str:
    """Unguessable per-user signature so the feed URL acts as its own secret."""
    from app.auth import _secret

    return hmac.new(
        _secret().encode(), f"icsfeed:{user_id}".encode(), hashlib.sha256
    ).hexdigest()[:40]


def _ics_escape(s: str) -> str:
    return (
        s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")
    )


def _ics_dt(iso: str) -> str:
    """Naive-UTC ISO -> ICS UTC stamp (YYYYMMDDTHHMMSSZ)."""
    return iso.replace("-", "").replace(":", "")[:15] + "Z"


@router.get("/feed-url")
def feed_url(user: User = Depends(get_current_user)):
    """The user's personal subscribe URL (paste into Apple Calendar / any app)."""
    base = settings.frontend_origin.rstrip("/")
    return {"url": f"{base}/api/calendar/feed/{user.id}/{_feed_sig(user.id)}"}


@router.get("/feed/{uid}/{sig}")
def ics_feed(uid: str, sig: str, db: Session = Depends(get_db)):
    """Public (signature-protected) ICS calendar: pending reminders with due
    times + this week's priority emails, each with a display alarm."""
    if not hmac.compare_digest(sig, _feed_sig(uid)):
        raise HTTPException(404, "Not found")

    now_stamp = _ics_dt(datetime.utcnow().isoformat())
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//AgentFury//EN",
        "X-WR-CALNAME:AgentFury",
        "X-PUBLISHED-TTL:PT15M",  # ask clients to refresh every 15 min
    ]

    reminders = (
        db.query(Reminder)
        .filter(Reminder.user_id == uid, Reminder.status == "pending", Reminder.due_at != "")
        .limit(100)
        .all()
    )
    for r in reminders:
        start = _ics_dt(r.due_at)
        end = _ics_dt(
            (datetime.fromisoformat(r.due_at) + timedelta(minutes=15)).isoformat()
        )
        lines += [
            "BEGIN:VEVENT",
            f"UID:rem-{r.id}@agentfury",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{start}",
            f"DTEND:{end}",
            f"SUMMARY:{_ics_escape(('⏰ ' if not r.alarm else '🚨 ') + r.title)}",
            "BEGIN:VALARM",
            "TRIGGER:PT0S",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_ics_escape(r.title)}",
            "END:VALARM",
            "END:VEVENT",
        ]

    week_ago = datetime.utcnow() - timedelta(days=7)
    priorities = (
        db.query(PriorityEmail)
        .filter(PriorityEmail.user_id == uid, PriorityEmail.created_at >= week_ago)
        .order_by(PriorityEmail.created_at.desc())
        .limit(50)
        .all()
    )
    for p in priorities:
        start_dt = p.created_at.replace(tzinfo=None)
        lines += [
            "BEGIN:VEVENT",
            f"UID:pri-{p.id}@agentfury",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{_ics_dt(start_dt.isoformat())}",
            f"DTEND:{_ics_dt((start_dt + timedelta(minutes=30)).isoformat())}",
            f"SUMMARY:{_ics_escape('⭐ ' + p.subject[:100])}",
            f"DESCRIPTION:{_ics_escape(f'From: {p.sender} — {p.reason}')}",
            "END:VEVENT",
        ]

    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines) + "\r\n", media_type="text/calendar")
