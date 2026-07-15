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


@router.post("/polish")
def polish(payload: PolishRequest, user: User = Depends(get_current_user)):
    from app.llm.router import get_fast_groq

    llm = get_fast_groq(0.4)
    if llm is None:
        raise HTTPException(503, "No model available right now.")

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
            "Write a complete, ready-to-send email body (no subject line, no "
            f"placeholders) from this instruction:\n\n{payload.instruction or payload.text}\n\n"
            "Output ONLY the email body text."
        )
    else:
        if not payload.text.strip():
            raise HTTPException(400, "No text to work with.")
        extra = f" Additional instruction: {payload.instruction}" if payload.instruction else ""
        prompt = (
            f"{guide}{extra}\n\nDo not add a greeting/signature that wasn't already "
            f"there. Output ONLY the rewritten text, nothing else.\n\nTEXT:\n{payload.text}"
        )

    out = llm.invoke(prompt)
    text = out.content if isinstance(out.content, str) else str(out.content)
    return {"text": text.strip()}
