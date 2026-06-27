"""Reminders & Notes API — the user's personal trackers (all scoped per user)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.memory import vector_store
from app.models import BrainFact, Note, Reminder, User
from app.schemas import (
    BrainFactCreate,
    BrainFactOut,
    NoteCreate,
    NoteOut,
    ReminderCreate,
    ReminderOut,
)

router = APIRouter(prefix="/api", tags=["trackers"])


# ---------- Reminders ----------
@router.get("/reminders", response_model=list[ReminderOut])
def list_reminders(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(Reminder)
        .filter(Reminder.user_id == user.id)
        .order_by(Reminder.created_at.desc())
        .all()
    )


@router.post("/reminders", response_model=ReminderOut, status_code=201)
def create_reminder(
    payload: ReminderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.util.timeparse import parse_when

    due = parse_when(payload.remind_at, tz_offset_min=getattr(user, "tz_offset_min", 0) or 0)
    r = Reminder(
        user_id=user.id,
        title=payload.title,
        remind_at=payload.remind_at,
        due_at=due.isoformat() if due else "",
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.post("/reminders/{rid}/notified", status_code=204)
def mark_notified(
    rid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Frontend calls this once it has shown the OS notification for a reminder."""
    r = db.get(Reminder, rid)
    if r and r.user_id == user.id:
        r.notified = True
        db.commit()


@router.patch("/reminders/{rid}", response_model=ReminderOut)
def toggle_reminder(
    rid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    r = db.get(Reminder, rid)
    if not r or r.user_id != user.id:
        raise HTTPException(404, "Reminder not found")
    r.status = "done" if r.status == "pending" else "pending"
    db.commit()
    db.refresh(r)
    return r


@router.delete("/reminders/{rid}", status_code=204)
def delete_reminder(
    rid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    r = db.get(Reminder, rid)
    if r and r.user_id == user.id:
        db.delete(r)
        db.commit()


# ---------- Notes ----------
@router.get("/notes", response_model=list[NoteOut])
def list_notes(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(Note)
        .filter(Note.user_id == user.id)
        .order_by(Note.created_at.desc())
        .all()
    )


@router.post("/notes", response_model=NoteOut, status_code=201)
def create_note(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = Note(user_id=user.id, **payload.model_dump())
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


@router.delete("/notes/{nid}", status_code=204)
def delete_note(
    nid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    n = db.get(Note, nid)
    if n and n.user_id == user.id:
        db.delete(n)
        db.commit()


# ---------- Brain (personal knowledge the AI recalls) ----------
@router.get("/brain", response_model=list[BrainFactOut])
def list_brain(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(BrainFact)
        .filter(BrainFact.user_id == user.id)
        .order_by(BrainFact.created_at.desc())
        .all()
    )


@router.post("/brain", response_model=BrainFactOut, status_code=201)
def add_brain(
    payload: BrainFactCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    fact = BrainFact(user_id=user.id, text=payload.text)
    db.add(fact)
    db.commit()
    db.refresh(fact)
    # Mirror into vector memory so the assistant recalls it.
    vector_store.remember_user(user.id, payload.text)
    return fact


@router.delete("/brain/{fid}", status_code=204)
def delete_brain(
    fid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    f = db.get(BrainFact, fid)
    if f and f.user_id == user.id:
        db.delete(f)
        db.commit()
