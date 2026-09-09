"""
Quick Find API — answers questions about the user's own local files.

WHY THIS IS NOT THE AGENT ENDPOINT
    The desktop popup is a launcher: it is judged on whether the answer appears
    before the user gets bored, which is roughly a second. The agent endpoint
    cannot do that and shouldn't try — it resolves a conversation, runs a tool
    loop, and writes messages to the database, all of which are the right calls
    for a chat and all of which are dead weight here.

    So this is one call to the measured-fastest model (see get_fast_groq), with
    no tools, no memory lookup and no persistence.

WHERE THE KNOWLEDGE COMES FROM
    The passages are retrieved ON THE USER'S MACHINE by the desktop app and
    posted here. The server never sees the file index, never sees a document
    that didn't match, and stores none of what it does see. The model is told to
    answer only from those passages and to say when they don't cover the
    question — a wrong answer about your own files is worse than no answer,
    because you have no reason to doubt it.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.models import User
from app.security.ratelimit import rate_limit

router = APIRouter(prefix="/api/quickfind", tags=["quickfind"])

MAX_PASSAGES = 6
MAX_PASSAGE_CHARS = 1200


class Passage(BaseModel):
    name: str = ""
    text: str = ""


class AskRequest(BaseModel):
    question: str = ""
    passages: list[Passage] = Field(default_factory=list)


SYSTEM = (
    "You answer questions about the user's own files, using ONLY the excerpts "
    "provided. Rules:\n"
    "1. Answer in 1-3 short sentences. No preamble, no restating the question.\n"
    "2. Name the file the answer came from, in [square brackets].\n"
    "3. If the excerpts do not contain the answer, say exactly what is missing "
    "instead of guessing. Never invent a detail that is not in the text.\n"
    "4. If the excerpts only partly cover it, answer that part and say what is "
    "not covered.\n"
    "5. 'Where is X' is a question about location: answer with the file name and "
    "the folder it sits in, not a summary of what it contains.\n"
    "6. Prefer concrete detail from the excerpts — names, dates, numbers — over "
    "general description. The user can already see the file names; what they "
    "cannot see is what is inside."
)


@router.post("/ask")
def quickfind_ask(
    payload: AskRequest,
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(40, 60)),
):
    question = (payload.question or "").strip()[:600]
    if not question:
        return {"ok": False, "error": "Ask a question."}

    passages = [p for p in payload.passages if (p.text or "").strip()][:MAX_PASSAGES]

    from app.llm.router import get_fast_groq

    llm = get_fast_groq(temperature=0.2)
    if llm is None:
        return {"ok": False, "error": "No fast model is configured."}

    if passages:
        body = "\n\n".join(
            f"[{p.name or f'excerpt {i + 1}'}]\n{(p.text or '')[:MAX_PASSAGE_CHARS]}"
            for i, p in enumerate(passages)
        )
        prompt = f"{body}\n\nQuestion: {question}"
    else:
        # Nothing matched locally. Say so rather than answering from general
        # knowledge — the user asked about THEIR files, and a confident answer
        # sourced from somewhere else is the most misleading thing we could do.
        return {
            "ok": True,
            "answer": "I couldn't find anything in your files about that.",
            "grounded": False,
            "used": [],
        }

    try:
        res = llm.invoke([("system", SYSTEM), ("human", prompt)])
        text = (getattr(res, "content", "") or "").strip()
    except Exception:
        return {"ok": False, "error": "The model didn't respond. Try again."}

    # Which excerpts the answer actually leaned on — used to show sources in the
    # popup, so the claim can be checked against the file rather than trusted.
    used = [p.name for p in passages if p.name and p.name.lower() in text.lower()]
    return {
        "ok": True,
        "answer": text or "(no answer)",
        "grounded": True,
        "used": used or [p.name for p in passages[:2] if p.name],
    }
