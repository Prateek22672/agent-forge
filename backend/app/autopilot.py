"""
AUTOPILOT — the autonomous background agent. This is what makes AgentFury an
*agent* rather than a tool: after ONE opt-in, it perceives → decides → acts on
the user's behalf with no human in the loop, on every background tick.

Each pass, per opted-in user:
  1. PERCEIVE  — fetch inbox mail that arrived since the last pass (cursor).
  2. DECIDE    — a strong LLM triages each mail like a chief of staff:
                 needs a reply? has a deadline? is it a meeting/event?
  3. ACT       — • drafts the reply (pending — one tap to send; auto-send is
                    deliberately gated for safety & Google policy)
                 • creates deadline reminders (+ mirrors to Google Calendar)
                 • adds meetings/events to Google Calendar
  4. REPORT    — every action lands in the "while you were away" activity feed,
                 and one push summarises what was handled.
  5. BRIEF     — once each morning (7–10 local), a daily brief is pushed:
                 today's events, due reminders, unhandled priorities.

Deterministic orchestration + LLM decisions (not a free-running ReAct loop) —
that's intentional: background agents must never spin, hallucinate tool calls,
or double-act. Every step is bounded, deduped by cursor, and logged.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

from app.util.timeparse import parse_when


def _log(db, user_id: str, kind: str, title: str, detail: str = "") -> None:
    from app.models import AgentAction

    db.add(AgentAction(user_id=user_id, kind=kind, title=title[:400], detail=detail[:800]))
    db.commit()


def _sender_email(raw: str) -> str:
    m = re.search(r"<([^>]+)>", raw or "")
    return (m.group(1) if m else (raw or "")).strip()


def _triage(emails: list[dict], user) -> list[dict]:
    """One LLM call: chief-of-staff decisions for a batch of new emails."""
    from app.llm.router import get_groq

    llm = get_groq("openai/gpt-oss-120b", 0.2) or get_groq("openai/gpt-oss-20b", 0.2)
    if llm is None or not emails:
        return []
    about = (getattr(user, "about", "") or "").strip()
    listing = "\n".join(
        f"{i}. From: {e.get('from','')} | Subject: {e.get('subject','')} | {e.get('snippet','')[:200]}"
        for i, e in enumerate(emails)
    )
    prompt = (
        "You are the user's chief of staff, autonomously triaging their NEW inbox "
        "mail. For each email decide what to do on their behalf.\n"
        + (f"About the user: {about}\n" if about else "")
        + "\nFor each email that needs action, output an object:\n"
        '{"index": <n>,\n'
        ' "reply": null OR "<a short, polite, ready-to-send reply body written as the user (no placeholders like [Name] — sign with their first name if known, else no signature)>",\n'
        ' "deadline": null OR {"when": "<natural time, e.g. tomorrow 5 pm>", "title": "<what is due>"},\n'
        ' "event": null OR {"when": "<natural time>", "title": "<meeting/event name>"}}\n'
        "\nRules:\n"
        "- reply ONLY for mail from a real person/organisation that genuinely awaits "
        "the user's answer (confirmations, questions, scheduling, RSVPs). Never for "
        "newsletters, marketing, or automated no-reply mail.\n"
        "- deadline for anything with a due date/time the user must not miss "
        "(assignments, fees, registrations, submissions).\n"
        "- event for meetings/interviews/classes with a concrete time.\n"
        "- If an email needs nothing, omit it. Most emails need nothing.\n"
        "Return a STRICT JSON array (possibly []). No prose.\n\nEMAILS:\n" + listing
    )
    try:
        out = llm.invoke(prompt)
        text = out.content if isinstance(out.content, str) else str(out.content)
        m = re.search(r"\[.*\]", text, re.DOTALL)
        items = json.loads(m.group(0)) if m else []
        return [x for x in items if isinstance(x, dict) and "index" in x]
    except Exception:
        return []


def run_for_user(db, user) -> int:
    """One autonomous pass. Returns the number of actions taken. Never raises."""
    try:
        actions = _handle_new_mail(db, user)
        actions += _morning_brief(db, user)
        return actions
    except Exception:
        return 0


def _handle_new_mail(db, user) -> int:
    import hashlib

    from app import push
    from app.calendar_bridge import mirror_reminder
    from app.integrations import google_oauth
    from app.models import EmailDraft, Reminder

    if not google_oauth.is_connected(user.id):
        return 0
    try:
        emails = google_oauth.fetch_recent(12, user.id)
    except Exception:
        return 0
    if not emails:
        return 0

    def key(e):
        raw = f"{user.id}|ap|{e.get('from','')}|{e.get('subject','')}".encode()
        return hashlib.sha256(raw).hexdigest()[:32]

    keys = [key(e) for e in emails]
    cursor = getattr(user, "autopilot_cursor", "") or ""
    if not cursor:
        # First pass: baseline only — never act on historical mail.
        user.autopilot_cursor = keys[0]
        db.commit()
        return 0
    fresh = []
    for e, k in zip(emails, keys):
        if k == cursor:
            break
        fresh.append(e)
    fresh = fresh[:8]
    if not fresh:
        return 0

    decisions = _triage(fresh, user)
    tz = getattr(user, "tz_offset_min", 0) or 0
    done: list[str] = []
    for d in decisions:
        try:
            e = fresh[int(d["index"])]
        except (KeyError, ValueError, IndexError):
            continue
        sender, subject = e.get("from", ""), e.get("subject", "")

        reply = d.get("reply")
        if reply and isinstance(reply, str) and _sender_email(sender):
            db.add(
                EmailDraft(
                    user_id=user.id,
                    to_addr=_sender_email(sender),
                    subject=("Re: " + subject)[:390] if subject else "Re:",
                    body=reply[:4000],
                )
            )
            db.commit()
            _log(db, user.id, "draft_reply", f"Drafted a reply to {sender[:60]}",
                 f"“{subject[:80]}” — review & tap Send in the app.")
            done.append("drafted a reply")

        dl = d.get("deadline")
        if isinstance(dl, dict) and dl.get("when") and dl.get("title"):
            due = parse_when(str(dl["when"]), tz_offset_min=tz)
            db.add(
                Reminder(
                    user_id=user.id,
                    title=str(dl["title"])[:300],
                    remind_at=str(dl["when"])[:100],
                    due_at=due.isoformat() if due else "",
                    alarm=True,
                )
            )
            db.commit()
            if due:
                mirror_reminder(user.id, str(dl["title"]), due.isoformat(), alarm=True)
            _log(db, user.id, "reminder", f"Deadline caught: {str(dl['title'])[:80]}",
                 f"From “{subject[:80]}” — reminder set for {dl['when']}.")
            done.append("set a deadline reminder")

        ev = d.get("event")
        if isinstance(ev, dict) and ev.get("when") and ev.get("title"):
            start = parse_when(str(ev["when"]), tz_offset_min=tz)
            if start:
                try:
                    google_oauth.create_event(
                        user.id, str(ev["title"])[:100], start.isoformat(),
                        (start + timedelta(hours=1)).isoformat(),
                        description=f"Added by AgentFury Autopilot from “{subject[:80]}”.",
                        reminder_minutes=30,
                    )
                    _log(db, user.id, "calendar_event",
                         f"Scheduled: {str(ev['title'])[:80]}",
                         f"On your Google Calendar for {ev['when']}.")
                    done.append("added a calendar event")
                except Exception:
                    pass

    user.autopilot_cursor = keys[0]
    db.commit()
    if done:
        push.notify_user(
            db, user.id, "🤖 Autopilot handled your inbox",
            f"{len(done)} action(s): " + ", ".join(done[:3]) + ". Review in AgentFury.", "/",
        )
    return len(done)


def _morning_brief(db, user) -> int:
    """Once per day, 7–10am local: push a one-glance brief of the day."""
    from app import push
    from app.integrations import google_oauth
    from app.models import PriorityEmail, Reminder

    tz = getattr(user, "tz_offset_min", 0) or 0
    local = datetime.utcnow() - timedelta(minutes=tz)
    today = local.strftime("%Y-%m-%d")
    if not (7 <= local.hour < 10) or getattr(user, "last_brief", "") == today:
        return 0

    parts = []
    try:
        events = google_oauth.list_events(user.id, 5)
        todays = [e for e in events if str(e.get("start", "")).startswith(today)]
        if todays:
            parts.append(f"{len(todays)} event(s): " + "; ".join(e["summary"][:40] for e in todays[:3]))
    except Exception:
        pass
    due_today = (
        db.query(Reminder)
        .filter(Reminder.user_id == user.id, Reminder.status == "pending",
                Reminder.due_at != "", Reminder.due_at.like(f"{today}%"))
        .count()
    )
    if due_today:
        parts.append(f"{due_today} reminder(s) due today")
    open_prio = (
        db.query(PriorityEmail).filter(PriorityEmail.user_id == user.id).count()
    )
    if open_prio:
        parts.append(f"{open_prio} priority email(s) awaiting you")

    body = " · ".join(parts) if parts else "Clear day — nothing urgent on the radar."
    push.notify_user(db, user.id, "☀️ Your day, briefed", body, "/")
    _log(db, user.id, "brief", "Morning brief sent", body)
    user.last_brief = today
    db.commit()
    return 1
