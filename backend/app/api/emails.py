"""
Outgoing email — the secure, user-confirmed send flow.

The agent can only DRAFT (via the draft_email tool); a draft sits 'pending'.
Actually sending requires the logged-in user to POST to /send with their own
auth token — the model can never send by itself, and no one else can send on
the user's behalf. That's the human-approval gate.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.integrations import google_oauth
from app.models import EmailDraft, User
from app.schemas import EmailDraftOut
from app.security.ratelimit import rate_limit

router = APIRouter(prefix="/api/emails", tags=["emails"])


@router.get("/pending", response_model=list[EmailDraftOut])
def pending(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(EmailDraft)
        .filter(EmailDraft.user_id == user.id, EmailDraft.status == "pending")
        .order_by(EmailDraft.created_at.desc())
        .all()
    )


@router.post("/{draft_id}/send", response_model=EmailDraftOut)
def send(
    draft_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit(20, 60)),  # Crocs: cap send rate (anti-spam)
):
    draft = db.get(EmailDraft, draft_id)
    if not draft or draft.user_id != user.id:
        raise HTTPException(404, "Draft not found")
    if draft.status != "pending":
        raise HTTPException(400, f"Draft already {draft.status}")
    try:
        google_oauth.send_email(user.id, draft.to_addr, draft.subject, draft.body)
    except Exception as exc:
        raise HTTPException(400, f"Send failed: {exc}")
    draft.status = "sent"
    db.commit()
    db.refresh(draft)
    return draft


@router.delete("/{draft_id}", status_code=204)
def cancel(
    draft_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    draft = db.get(EmailDraft, draft_id)
    if draft and draft.user_id == user.id:
        draft.status = "cancelled"
        db.commit()
