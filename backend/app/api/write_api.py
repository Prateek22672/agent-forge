"""
Write-assist API — powers the browser extension's in-compose email tools
(auto-correct / rewrite / write-from-instruction) on Gmail, Outlook, etc.

Kept separate from the agent runtime: this is a single fast LLM call with no
tools, no memory lookup — it just transforms text, so it's instant from any
page the extension is injected into.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.models import User

router = APIRouter(prefix="/api/write", tags=["write"])


class PolishRequest(BaseModel):
    text: str = ""
    instruction: str = ""  # e.g. "write a polite follow-up asking for status"
    mode: str = "improve"  # improve | shorten | formal | friendly | write
    # Best-effort context read from the compose window (subject line, "To"
    # recipient chips) — lets "write" address the recipient by name instead of
    # generic filler like "Dear Project Manager", and keeps rewrites aware of
    # what the email is actually about.
    subject: str = ""
    recipients: list[str] = []


@router.post("/polish")
def polish(payload: PolishRequest, user: User = Depends(get_current_user)):
    from app.llm.router import get_fast_groq

    llm = get_fast_groq(0.4)
    if llm is None:
        raise HTTPException(503, "No model available right now.")

    context_lines = []
    if payload.subject.strip():
        context_lines.append(f"Subject: {payload.subject.strip()}")
    if payload.recipients:
        context_lines.append("To: " + ", ".join(payload.recipients[:5]))
    context = ("\n".join(context_lines) + "\n\n") if context_lines else ""

    mode_guides = {
        "improve": "Fix grammar/spelling and tighten the wording. Keep the meaning, "
        "tone, and length close to the original.",
        "shorten": "Make it noticeably shorter and punchier while keeping the key points.",
        "formal": "Rewrite in a polished, professional/formal tone.",
        "friendly": "Rewrite in a warm, friendly, conversational tone.",
        "write": "Write a complete, ready-to-send email body from the instruction below.",
    }
    guide = mode_guides.get(payload.mode, mode_guides["improve"])

    if payload.mode == "write":
        prompt = (
            f"{context}Write a complete, ready-to-send email body (no subject line) "
            f"from this instruction:\n\n{payload.instruction or payload.text}\n\n"
            "If a recipient name is given above, address them by first name in the "
            "greeting; otherwise use a neutral greeting (no placeholder brackets like "
            "[Name]). Be concrete and specific to the instruction — avoid generic "
            "filler sentences that could apply to any email. Output ONLY the email "
            "body text."
        )
    else:
        if not payload.text.strip():
            raise HTTPException(400, "No text to work with.")
        extra = f" Additional instruction: {payload.instruction}" if payload.instruction else ""
        prompt = (
            f"{context}{guide}{extra}\n\nDo not add a greeting/signature that wasn't "
            f"already there. Output ONLY the rewritten text, nothing else.\n\nTEXT:\n{payload.text}"
        )

    out = llm.invoke(prompt)
    text = out.content if isinstance(out.content, str) else str(out.content)
    return {"text": text.strip()}
