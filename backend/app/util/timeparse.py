"""
Lightweight natural-time parser: "tomorrow 10am", "in 2 minutes", "today 9:14pm"
-> a concrete UTC datetime, so reminders fire at the user's intended local time.

In the cloud the server clock is UTC (not the user's local time), so we take the
user's timezone offset (JS `getTimezoneOffset()`, minutes) and:
  1. interpret the spoken time in the USER's local clock, then
  2. convert it back to UTC for storage.
The reminder cron compares stored due_at (naive-UTC ISO) against utcnow().

Deliberately dependency-free and forgiving: anything it can't parse returns None
(the reminder is still saved, just without an automatic ping).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta


def parse_when(
    text: str, now: datetime | None = None, tz_offset_min: int = 0
) -> datetime | None:
    """Return a naive UTC datetime for `text`, interpreted in the user's local
    timezone (tz_offset_min = JS getTimezoneOffset, e.g. -330 for IST)."""
    if not text:
        return None
    now_utc = now or datetime.utcnow()
    # The user's local "now" — all reasoning about today/tomorrow/passed happens here.
    now = now_utc - timedelta(minutes=tz_offset_min)
    t = text.strip().lower()

    # "in/after N minutes/hours" or "N minutes from now"
    m = re.search(r"(?:in|after)?\s*(\d+)\s*(min|minute|minutes|hour|hours|hr|hrs)\b", t)
    if m and ("from now" in t or "in " in t or "after" in t):
        n = int(m.group(1))
        unit = m.group(2)
        delta = timedelta(hours=n) if unit.startswith(("hour", "hr")) else timedelta(minutes=n)
        return now + delta + timedelta(minutes=tz_offset_min)  # -> UTC

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
            return candidate + timedelta(minutes=tz_offset_min)  # -> UTC

    # "tomorrow" with no time -> default 9:00 am
    if "tomorrow" in t:
        local = base.replace(hour=9, minute=0, second=0, microsecond=0)
        return local + timedelta(minutes=tz_offset_min)  # -> UTC

    return None
