"""
Email tool (Gmail/IMAP) — the building block for an "email summariser" agent.

This tool FETCHES recent emails. Summarising them is then just the agent's LLM
doing what it's good at. That separation (tool fetches data, model reasons over
it) is the heart of agent design.

Requires EMAIL_ADDRESS + EMAIL_APP_PASSWORD in .env (a Google App Password,
not your real password). If they're absent the tool returns a helpful message
instead of crashing.
"""
from __future__ import annotations

import email
import imaplib
from email.header import decode_header

from langchain_core.tools import tool

from app.config import settings


def _decode(value: str | bytes | None) -> str:
    if value is None:
        return ""
    parts = decode_header(value if isinstance(value, str) else value.decode("latin-1"))
    out = ""
    for text, enc in parts:
        if isinstance(text, bytes):
            out += text.decode(enc or "utf-8", errors="replace")
        else:
            out += text
    return out


def make_email_tool(user_id: str):
    """Build the email tool bound to a specific user, so it reads THAT user's
    connected Gmail (per-user OAuth token) — never another user's inbox."""

    @tool
    def fetch_recent_emails(count: int = 5) -> str:
        """Fetch the most recent emails from the connected inbox (subject + sender
        + a short snippet). Use this when the user asks to read, check, or
        summarise their email. Returns up to `count` messages.
        """
        return _fetch_recent_emails(count, user_id)

    return fetch_recent_emails


def make_send_email_tool(user_id: str):
    """Build the 'draft_email' tool. It does NOT send — it creates a pending
    draft that the user must confirm in the UI. This is the security gate."""

    @tool
    def draft_email(to: str, subject: str, body: str) -> str:
        """Prepare an email to send. This does NOT send immediately — it creates a
        draft the user must confirm with a Send button. Use this when the user
        asks to send/email someone; fill in a clear subject and body."""
        from app.database import SessionLocal
        from app.models import EmailDraft

        db = SessionLocal()
        try:
            draft = EmailDraft(
                user_id=user_id, to_addr=to, subject=subject, body=body
            )
            db.add(draft)
            db.commit()
        finally:
            db.close()
        return (
            f"Drafted an email to {to} (subject: “{subject}”). It is NOT sent yet — "
            "ask the user to review and press Send to confirm."
        )

    return draft_email


def _fetch_recent_emails(count: int, user_id: str) -> str:
    # Preferred path: the user connected Google via OAuth (no password stored).
    from app.integrations import google_oauth

    if google_oauth.is_connected(user_id):
        try:
            msgs = google_oauth.fetch_recent(count, user_id)
            if not msgs:
                return "Inbox is empty."
            return "\n\n---\n\n".join(
                f"From: {m['from']}\nSubject: {m['subject']}\n{m['snippet']}"
                for m in msgs
            )
        except Exception as exc:
            return f"Failed to fetch email via Google: {exc}"

    # Fallback path: classic IMAP with an app password (still supported).
    if not settings.email_address or not settings.email_app_password:
        return (
            "No email account is connected. Either click 'Connect Google' in the "
            "app, or add EMAIL_ADDRESS + EMAIL_APP_PASSWORD to the .env file."
        )

    try:
        imap = imaplib.IMAP4_SSL(settings.email_imap_host)
        imap.login(settings.email_address, settings.email_app_password)
        imap.select("INBOX")
        _, data = imap.search(None, "ALL")
        ids = data[0].split()[-count:][::-1]  # newest first

        out = []
        for num in ids:
            _, msg_data = imap.fetch(num, "(RFC822)")
            msg = email.message_from_bytes(msg_data[0][1])
            subject = _decode(msg.get("Subject"))
            sender = _decode(msg.get("From"))
            snippet = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        snippet = part.get_payload(decode=True).decode(
                            "utf-8", errors="replace"
                        )
                        break
            else:
                snippet = msg.get_payload(decode=True).decode("utf-8", errors="replace")
            snippet = " ".join(snippet.split())[:300]
            out.append(f"From: {sender}\nSubject: {subject}\n{snippet}")

        imap.logout()
        return "\n\n---\n\n".join(out) if out else "Inbox is empty."
    except Exception as exc:
        return f"Failed to fetch email: {exc}"
