"""
Priority inbox — scan recent Gmail, flag the important ones with the LLM, store
the new ones (deduped), and return them so the caller can push notifications.

One cheap LLM call per scan (all emails classified together), using a fast Groq
model. Degrades gracefully if Gmail isn't connected/granted.
"""
from __future__ import annotations

import hashlib
import json
import re


def _key(user_id: str, sender: str, subject: str) -> str:
    raw = f"{user_id}|{sender}|{subject}".encode()
    return hashlib.sha256(raw).hexdigest()[:32]


def _classify(emails: list[dict]) -> list[dict]:
    """Return [{index, category, reason}] for the PRIORITY emails only."""
    from app.llm.router import get_fast_groq

    llm = get_fast_groq(0.2)
    if llm is None or not emails:
        return []
    listing = "\n".join(
        f"{i}. From: {e.get('from','')} | Subject: {e.get('subject','')} | {e.get('snippet','')[:140]}"
        for i, e in enumerate(emails)
    )
    prompt = (
        "You triage a student's inbox. From the emails below, pick ONLY the ones "
        "that genuinely need attention — placements, interviews, internships, "
        "deadlines, results, important academic/official notices, or anything "
        "requiring a reply or action. Ignore promotions, newsletters, and noise.\n"
        "Return a STRICT JSON array; each item: "
        '{"index": <number>, "category": "<short label>", "reason": "<one line>"}. '
        "If none are important, return [].\n\nEMAILS:\n" + listing
    )
    try:
        out = llm.invoke(prompt)
        text = out.content if isinstance(out.content, str) else str(out.content)
        m = re.search(r"\[.*\]", text, re.DOTALL)
        items = json.loads(m.group(0)) if m else []
        return [x for x in items if isinstance(x, dict) and "index" in x]
    except Exception:
        return []


def scan_user(db, user_id: str, count: int = 15) -> list:
    """Scan the user's recent inbox, store newly-found priority emails, and return
    the new PriorityEmail rows (for pushing). Raises nothing — returns [] on any
    issue (e.g. Gmail not connected)."""
    from app.integrations import google_oauth
    from app.models import PriorityEmail

    if not google_oauth.is_connected(user_id):
        return []
    try:
        emails = google_oauth.fetch_recent(count, user_id)
    except Exception:
        return []

    flagged = _classify(emails)
    new_rows = []
    for item in flagged:
        try:
            e = emails[int(item["index"])]
        except (KeyError, ValueError, IndexError):
            continue
        k = _key(user_id, e.get("from", ""), e.get("subject", ""))
        exists = (
            db.query(PriorityEmail)
            .filter(PriorityEmail.user_id == user_id, PriorityEmail.key == k)
            .first()
        )
        if exists:
            continue
        row = PriorityEmail(
            user_id=user_id,
            key=k,
            sender=e.get("from", ""),
            subject=e.get("subject", ""),
            snippet=e.get("snippet", "")[:300],
            category=str(item.get("category", ""))[:60],
            reason=str(item.get("reason", ""))[:300],
        )
        db.add(row)
        new_rows.append(row)
    db.commit()
    return new_rows
