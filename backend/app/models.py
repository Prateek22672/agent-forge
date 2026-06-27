"""
ORM models — the persistent shape of the platform.

An **Agent** is just configuration: a name, a system prompt, the tools it may
use, and which model to run on. The runtime (app/agents/runtime.py) turns that
config into a live LangGraph agent on demand. This "agent = data" design is the
core idea that lets users create *any* agent without writing code.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PushSubscription(Base):
    """A browser/PWA push endpoint for a user, so we can send reminder/priority
    notifications even when the app is closed. Multiple per user (one per device)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Secret(Base):
    """Encrypted secret storage for CLOUD mode (no OS keychain on a server).
    Values are Fernet-encrypted before they're written here, so the database
    never holds a usable token/key in plaintext."""

    __tablename__ = "secrets"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    value: Mapped[str] = mapped_column(Text)  # Fernet ciphertext


class User(Base):
    """An account. Every agent, conversation and connection belongs to a user,
    so multiple people (and multiple Gmail accounts) stay fully isolated."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(default=False)
    # Personalization (stored so every agent talks in the user's preferred way).
    tone: Mapped[str] = mapped_column(String(40), default="friendly")
    about: Mapped[str] = mapped_column(Text, default="")
    # When False, chat messages aren't persisted (privacy). Brain still works.
    save_history: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="You are a helpful assistant.")
    # List of tool names this agent is allowed to use (keys in the tool registry).
    tools: Mapped[list] = mapped_column(JSON, default=list)
    model: Mapped[str] = mapped_column(String(80), default="")  # "" -> use default
    temperature: Mapped[float] = mapped_column(default=0.7)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )


class Connection(Base):
    """A linked external account (e.g. Google/Gmail).

    We deliberately DO NOT store the OAuth token here — only non-secret status
    (which provider, which account, when). The actual token lives in the OS
    keychain (app/security/secret_store.py). This row is what powers the
    "Connected via Google ✓" badge in the UI.
    """

    __tablename__ = "connections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(40))  # "google"
    account_email: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="disconnected")
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Reminder(Base):
    """A personal reminder. Created from chat (the agent calls create_reminder)
    or from the Reminders page. Shown in the user's own tracker."""

    __tablename__ = "reminders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(Text)
    remind_at: Mapped[str] = mapped_column(String(120), default="")  # human text
    # Concrete time the ping should fire (naive local ISO); null if unparseable.
    due_at: Mapped[str] = mapped_column(String(40), default="")
    notified: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|done
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Note(Base):
    """A personal note. Created from chat (create_note) or the Notes page."""

    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class EmailDraft(Base):
    """An outgoing email the agent prepared. It is NEVER sent automatically — it
    stays 'pending' until the logged-in user explicitly confirms in the UI. This
    is the human-approval gate that keeps sending secure."""

    __tablename__ = "email_drafts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    to_addr: Mapped[str] = mapped_column(String(300))
    subject: Mapped[str] = mapped_column(String(400), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|sent|cancelled
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class BrainFact(Base):
    """A piece of the user's personal knowledge base ("brain") — e.g. a contact
    ("Bharat's email is bharat@x.com") or a preference. Mirrored into the user's
    vector memory so the assistant recalls it automatically when relevant."""

    __tablename__ = "brain_facts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"))
    title: Mapped[str] = mapped_column(String(200), default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    agent: Mapped["Agent"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"))
    role: Mapped[str] = mapped_column(String(20))  # "user" | "assistant" | "tool"
    content: Mapped[str] = mapped_column(Text)
    # Optional structured trace (tool calls the agent made) for the UI to show.
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
