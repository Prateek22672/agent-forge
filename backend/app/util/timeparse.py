"""
Lightweight natural-time parser: "tomorrow 10am", "in 2 minutes", "today 9:14pm"
-> a concrete datetime, so reminders can actually fire.

This app is self-hosted on the user's own machine, so the server's local clock
IS the user's local time — we parse in local time and return a naive local
datetime (ISO without tz). The frontend compares it against the local clock to
decide when to ping.

Deliberately dependency-free and forgiving: anything it can't parse returns None
(the reminder is still saved, just without an automatic ping).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta


def parse_when(text: str, now: datetime | None = None) -> datetime | None:
    if not text:
        return None
    now = now or datetime.now()
    t = text.strip().lower()

    # "in/after N minutes/hours" or "N minutes from now"
    m = re.search(r"(?:in|after)?\s*(\d+)\s*(min|minute|minutes|hour|hours|hr|hrs)\b", t)
    if m and ("from now" in t or "in " in t or "after" in t):
        n = int(m.group(1))
        unit = m.group(2)
        delta = timedelta(hours=n) if unit.startswith(("hour", "hr")) else timedelta(minutes=n)
        return now + delta

    # day offset
    base = now
    if "tomorrow" in t:
        base = now + timedelta(days=1)
    elif "today" in t or "tonight" in t:
        base = now

    # explicit clock time, e.g. "10am", "9:14 pm", "14:30"
    tm = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", t)
    if tm:
        hour = int(tm.group(1))
        minute = int(tm.group(2) or 0)
        ampm = tm.group(3)
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            candidate = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
            # If no day word and the time already passed today, assume tomorrow.
            if "tomorrow" not in t and "today" not in t and candidate <= now:
                candidate += timedelta(days=1)
            return candidate

    # "tomorrow" with no time -> default 9:00 am
    if "tomorrow" in t:
        return base.replace(hour=9, minute=0, second=0, microsecond=0)

    return None
