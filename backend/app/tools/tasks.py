"""
Reminder & Note tools — let an agent save items to the user's personal trackers
straight from chat ("remind me to attempt the quiz at 9:14pm" → a reminder).

Tools open their own DB session (they run inside the agent loop, away from the
request's session). Everything is scoped to the user_id they're built with.
"""
from __future__ import annotations

from langchain_core.tools import tool


def make_task_tools(user_id: str) -> list:
    @tool
    def create_reminder(title: str, when: str = "") -> str:
        """Save a reminder for the user. `title` is what to be reminded about;
        `when` is the human-readable time (e.g. 'today 9:14 PM'). Use this when
        the user asks to be reminded of something."""
        from app.database import SessionLocal
        from app.models import Reminder, User
        from app.util.timeparse import parse_when

        db = SessionLocal()
        try:
            u = db.get(User, user_id)
            tz = getattr(u, "tz_offset_min", 0) or 0
            due = parse_when(when, tz_offset_min=tz)
            db.add(
                Reminder(
                    user_id=user_id,
                    title=title,
                    remind_at=when,
                    due_at=due.isoformat() if due else "",
                )
            )
            db.commit()
        finally:
            db.close()
        when_txt = f" for {when}" if when else ""
        ping = " I'll ping you when it's due." if due else ""
        return f"Saved a reminder{when_txt}: “{title}”.{ping} View it on your Reminders page."

    @tool
    def list_reminders() -> str:
        """List the user's pending reminders."""
        from app.database import SessionLocal
        from app.models import Reminder

        db = SessionLocal()
        try:
            rows = (
                db.query(Reminder)
                .filter(Reminder.user_id == user_id, Reminder.status == "pending")
                .all()
            )
        finally:
            db.close()
        if not rows:
            return "No pending reminders."
        return "\n".join(f"- {r.title}" + (f" ({r.remind_at})" if r.remind_at else "") for r in rows)

    @tool
    def create_note(title: str, content: str) -> str:
        """Save a note for the user. Use when asked to note/jot/save something."""
        from app.database import SessionLocal
        from app.models import Note

        db = SessionLocal()
        try:
            db.add(Note(user_id=user_id, title=title or "Note", content=content))
            db.commit()
        finally:
            db.close()
        return f"Saved a note: “{title or 'Note'}”. View it on your Notes page."

    return [create_reminder, list_reminders, create_note]
