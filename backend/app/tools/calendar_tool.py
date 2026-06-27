"""Google Calendar tool — create events from chat. Per-user (uses that user's
OAuth token). Falls back to a helpful message if Calendar isn't granted yet."""
from __future__ import annotations

from datetime import timedelta

from langchain_core.tools import tool

from app.util.timeparse import parse_when


def make_calendar_tool(user_id: str):
    @tool
    def add_calendar_event(title: str, when: str, location: str = "") -> str:
        """Add an event to the user's Google Calendar. `when` is natural time
        (e.g. 'tomorrow 10:30am'). Use when the user asks to put something on
        their calendar."""
        from app.integrations import google_oauth

        start = parse_when(when)
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
