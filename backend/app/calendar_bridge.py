"""
Calendar bridge — mirror AgentFury alerts into the user's Google Calendar.

WHY: a web app can't reliably ring a phone after the user leaves (OS limits),
but the Google Calendar app can — its notifications are native and always
allowed. So reminders/alarms and priority-email alerts are mirrored as calendar
events with popup reminders. This is a NOTIFICATION CHANNEL, not a journal:
events exist purely so the user's phone alerts them at the right moment.

Everything here is best-effort: a calendar failure must never break the
feature that triggered it.
"""
from __future__ import annotations

from datetime import datetime, timedelta


def mirror_reminder(user_id: str, title: str, due_iso: str, alarm: bool = False) -> bool:
    """Create a Google Calendar event for a reminder/alarm at its due time, with
    a popup reminder at that exact moment. Returns True if the event was created
    (False = calendar not connected / not granted / any error)."""
    if not due_iso:
        return False
    try:
        from app.integrations import google_oauth

        start = datetime.fromisoformat(due_iso)
        end = start + timedelta(minutes=15)
        google_oauth.create_event(
            user_id,
            ("🚨 Alarm: " if alarm else "⏰ Reminder: ") + title[:80],
            start.isoformat(),
            end.isoformat(),
            description="Set in AgentFury — https://agentfury.foliofyx.in",
            reminder_minutes=0,  # popup exactly at the due time
        )
        return True
    except Exception:
        return False
