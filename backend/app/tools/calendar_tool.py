"""Google Calendar tool — create events from chat. Per-user (uses that user's
OAuth token). Falls back to a helpful message if Calendar isn't granted yet."""
from __future__ import annotations

from datetime import timedelta

from langchain_core.tools import tool

from app.util.timeparse import parse_when


def _user_tz(user_id: str) -> int:
    from app.database import SessionLocal
    from app.models import User

    db = SessionLocal()
    try:
        u = db.get(User, user_id)
        return getattr(u, "tz_offset_min", 0) or 0
    finally:
        db.close()


def make_calendar_tool(user_id: str):
    @tool
    def add_calendar_event(title: str, when: str, location: str = "") -> str:
        """Add an event to the user's Google Calendar. `when` is natural time
        (e.g. 'tomorrow 10:30am'). Use when the user asks to put something on
        their calendar."""
        from app.integrations import google_oauth

        start = parse_when(when, tz_offset_min=_user_tz(user_id))
        if not start:
            return "I couldn't understand the time — try e.g. 'tomorrow 10:30am'."
        end = start + timedelta(hours=1)
        try:
            link = google_oauth.create_event(
                user_id, title, start.isoformat(), end.isoformat(), location
            )
            return f"Added to your Google Calendar: “{title}” ({when}). {link}"
        except Exception as exc:
            return (
                f"Couldn't add the calendar event: {exc} "
                "Tip: open Settings → reconnect Google to grant Calendar access."
            )

    return add_calendar_event


def make_list_events_tool(user_id: str):
    @tool
    def list_upcoming_events(count: int = 10) -> str:
        """List the user's upcoming Google Calendar events. Use when they ask
        what's on their calendar / schedule / agenda."""
        from app.integrations import google_oauth

        try:
            events = google_oauth.list_events(user_id, count)
        except Exception as exc:
            return f"Couldn't read your calendar: {exc}"
        if not events:
            return "No upcoming events on your calendar."
        lines = []
        for e in events:
            when = e["start"].replace("T", " ")[:16]
            loc = f" @ {e['location']}" if e["location"] else ""
            lines.append(f"- {when} — {e['summary']}{loc}")
        return "\n".join(lines)

    return list_upcoming_events
