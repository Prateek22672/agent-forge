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
    # Priority-inbox auto-scan: off | 15m | 1h | 5h | morning | night | morning_night
    priority_scan_freq: Mapped[str] = mapped_column(String(20), default="off")
    # Mirror new priority emails into Google Calendar (native notifications).
    priority_to_calendar: Mapped[bool] = mapped_column(default=True)
    # Push a notification for EVERY new inbox email (checked each scan tick).
    notify_new_mail: Mapped[bool] = mapped_column(default=False)
    # Dedupe cursor: key of the newest inbox email we've already seen.
    last_seen_mail_key: Mapped[str] = mapped_column(String(80), default="")
    # AUTOPILOT: the autonomous background agent (one opt-in, then no human
    # needed — it triages mail, drafts replies, schedules, and briefs).
    autopilot: Mapped[bool] = mapped_column(default=False)
    autopilot_cursor: Mapped[str] = mapped_column(String(80), default="")
    last_brief: Mapped[str] = mapped_column(String(20), default="")  # YYYY-MM-DD
    tz_offset_min: Mapped[int] = mapped_column(default=0)  # JS getTimezoneOffset()
    last_priority_scan: Mapped[str] = mapped_column(String(40), default="")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_source: Mapped[str] = mapped_column(String(20), default="")
    # Manual-review suspension (see BypassEvent below) — set by an admin after
    # reviewing flagged activity, never automatically. Suspended users can't
    # log in until an admin lifts it.
    is_suspended: Mapped[bool] = mapped_column(default=False)
    suspended_reason: Mapped[str] = mapped_column(Text, default="")
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A warning an admin sent after review — shown in-app on next load, and
    # cleared once the user acknowledges it. A softer step than suspension.
    notice: Mapped[str] = mapped_column(Text, default="")
    notice_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class LoginEvent(Base):
    """One successful sign-in, so the admin panel can show how many people are
    actually using the platform day to day and from which surface (web,
    extension, desktop) — not just how many accounts exist."""

    __tablename__ = "login_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(20), default="web")  # web|extension|desktop
    method: Mapped[str] = mapped_column(String(20), default="password")  # password|google
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class BypassEvent(Base):
    """A record that the extension's anti-copy-block override actually fired
    on some site — i.e. the site tried to block copying and we neutralized
    it. This is a REPORTING signal for human review, not an automated
    judgment: most hits are ordinary (news sites, blogs) and totally fine.
    It exists so an admin can spot a pattern — e.g. one account repeatedly
    hitting a site that requires consented screen-monitoring — and decide
    whether to suspend the account manually. We never act on this
    automatically."""

    __tablename__ = "bypass_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    domain: Mapped[str] = mapped_column(String(200), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class ErrorLog(Base):
    """A server-side error worth an admin's attention (5xx responses, unhandled
    exceptions). Kept lightweight and self-trimming (see app/error_log.py) — this
    is meant for "is something on fire right now", not a full APM stack."""

    __tablename__ = "error_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    source: Mapped[str] = mapped_column(String(20), default="web")  # web|extension|desktop|unknown
    method: Mapped[str] = mapped_column(String(10), default="")
    path: Mapped[str] = mapped_column(String(300), default="")
    status_code: Mapped[int] = mapped_column(default=500)
    message: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[int] = mapped_column(default=0)
    user_id: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


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
    # When True, the due ping is a loud, dismiss-required ALARM (sound), not just
    # a passive notification.
    alarm: Mapped[bool] = mapped_column(default=False)
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


class PriorityEmail(Base):
    """An inbox email the classifier flagged as important (placement, interview,
    deadline, action-needed…). Shown in the user's Priority view and pushed when
    new. `key` is a per-user hash of sender+subject so we don't add duplicates."""

    __tablename__ = "priority_emails"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    key: Mapped[str] = mapped_column(String(80), index=True)  # dedupe hash
    sender: Mapped[str] = mapped_column(String(400), default="")
    subject: Mapped[str] = mapped_column(Text, default="")
    snippet: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(60), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    pushed: Mapped[bool] = mapped_column(default=False)
    # Second-chance alert fired (user hadn't dismissed it hours later).
    escalated: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AgentAction(Base):
    """One autonomous action Autopilot took on the user's behalf — the
    'while you were away' feed that makes the agent's work visible."""

    __tablename__ = "agent_actions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    # draft_reply | reminder | calendar_event | note | brief
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(Text, default="")
    detail: Mapped[str] = mapped_column(Text, default="")
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
