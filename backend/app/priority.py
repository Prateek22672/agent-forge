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


# Obvious-noise markers — used as a SAFETY NET only to drop clear marketing when
# the model is unavailable. We never use these to override the model's INCLUSION.
_NOISE_HINTS = (
    "unsubscribe to stop",
    "% off",
    "sale ends",
    "limited time offer",
    "shop now",
    "you have new followers",
)


def _classify(emails: list[dict]) -> list[dict]:
    """Return [{index, category, reason}] for the PRIORITY emails.

    Tuned for RECALL: it is far worse to miss an important email than to show an
    extra one, so the model is told to INCLUDE anything uncertain and exclude only
    clear promotional noise."""
    from app.llm.router import get_groq

    if not emails:
        return []
    # A strong open-weight model for accuracy (not the tiny fast one).
    llm = get_groq("openai/gpt-oss-120b", 0.1) or get_groq("openai/gpt-oss-20b", 0.1)
    if llm is None:
        return []

    listing = "\n".join(
        f"{i}. From: {e.get('from','')} | Subject: {e.get('subject','')} | {e.get('snippet','')[:160]}"
        for i, e in enumerate(emails)
    )
    prompt = (
        "You are a careful inbox-triage assistant for a student/professional. Your "
        "job is to surface every email that could MATTER, while filtering obvious "
        "marketing noise.\n\n"
        "GOLDEN RULE: Missing an important email is a serious failure; showing one "
        "extra is fine. So when you are UNSURE, INCLUDE it.\n\n"
        "INCLUDE (priority) — anything like:\n"
        "- placements, interviews, internships, job offers, hiring/recruiter mail\n"
        "- deadlines, exam schedules, results, fee/registration, official/academic "
        "notices from a college/university/company\n"
        "- anything asking for a reply, confirmation, signature, or action\n"
        "- security alerts, account/bank/payment, OTP/verification, password\n"
        "- personal messages from a real person, calendar invites, meetings\n"
        "- anything time-sensitive or that a person would be upset to miss\n\n"
        "EXCLUDE (noise) — ONLY when clearly one of these with no action needed:\n"
        "- marketing/sales/discount/promotional blasts, coupons\n"
        "- newsletters, digests, content recommendations, course ads\n"
        "- social-media notifications (likes, follows, 'people you may know')\n"
        "- automated 'no-reply' marketing\n\n"
        "If an email is borderline between the two, treat it as PRIORITY.\n\n"
        'Return a STRICT JSON array. Each item: {"index": <number>, '
        '"category": "<short label e.g. Placement, Interview, Deadline, Security, '
        'Personal, Action needed>", "reason": "<one short line>"}. '
        "Return [] only if every email is clearly noise.\n\nEMAILS:\n" + listing
    )
    try:
        out = llm.invoke(prompt)
        text = out.content if isinstance(out.content, str) else str(out.content)
        m = re.search(r"\[.*\]", text, re.DOTALL)
        items = json.loads(m.group(0)) if m else []
        return [x for x in items if isinstance(x, dict) and "index" in x]
    except Exception:
        # Model failed — SAFETY NET: include everything that isn't obvious marketing,
        # so we never silently drop a potentially-important email.
        out = []
        for i, e in enumerate(emails):
            blob = f"{e.get('subject','')} {e.get('snippet','')}".lower()
            if any(h in blob for h in _NOISE_HINTS):
                continue
            out.append({"index": i, "category": "Needs review", "reason": "Auto-included (classifier offline)"})
        return out


def scan_user(db, user_id: str, count: int = 25) -> list:
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
