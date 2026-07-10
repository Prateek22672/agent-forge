"""
Brain auto-extraction — quietly mine each user message for at most ONE durable
personal fact (name, role, college, contacts, preferences, goals, deadlines) and
save it to the user's Brain (DB row + vector memory).

This is the personalization engine that works even with chat-history saving OFF:
we don't need the transcript — we keep only the distilled facts, so the assistant
feels personal without hoarding raw data.

Runs on a daemon thread with a small fast model: never adds latency to the reply
and never raises into the request path.
"""
from __future__ import annotations

import json
import re
import threading


def extract_fact_async(user_id: str, message: str) -> None:
    """Fire-and-forget: extract + store in the background."""
    if not user_id or not message or len(message.strip()) < 12:
        return
    threading.Thread(
        target=_extract_and_store, args=(user_id, message), daemon=True
    ).start()


def _extract_and_store(user_id: str, message: str) -> None:
    try:
        fact = _extract(message)
        if fact:
            _store(user_id, fact)
    except Exception:
        pass  # personalization is best-effort, never breaks anything


def _extract(message: str) -> str | None:
    from app.llm.router import get_fast_groq

    llm = get_fast_groq(0.1)
    if llm is None:
        return None
    prompt = (
        "You maintain a user's long-term memory. From the user's message below, "
        "extract AT MOST ONE durable personal fact worth remembering across future "
        "conversations — e.g. their name, role, college/company, a contact's email, "
        "a preference, a recurring commitment, a goal, or a hard deadline.\n"
        "IGNORE one-off requests, questions, greetings, and anything transient.\n"
        'Return STRICT JSON only: {"fact": "<one short third-person sentence>"} '
        'or {"fact": null}.\n\n'
        f"MESSAGE: {message[:800]}"
    )
    out = llm.invoke(prompt)
    text = out.content if isinstance(out.content, str) else str(out.content)
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    fact = (json.loads(m.group(0)) or {}).get("fact")
    if not fact or not isinstance(fact, str) or len(fact.strip()) < 8:
        return None
    return fact.strip()[:300]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _store(user_id: str, fact: str) -> None:
    """Save unless an equivalent fact already exists (normalized containment)."""
    from app.database import SessionLocal
    from app.memory import vector_store
    from app.models import BrainFact

    db = SessionLocal()
    try:
        existing = (
            db.query(BrainFact).filter(BrainFact.user_id == user_id).limit(300).all()
        )
        nf = _norm(fact)
        for row in existing:
            ne = _norm(row.text)
            if nf == ne or nf in ne or ne in nf:
                return  # already known
        db.add(BrainFact(user_id=user_id, text=fact))
        db.commit()
    finally:
        db.close()
    vector_store.remember_user(user_id, fact)
