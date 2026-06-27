"""
Google sign-in (OAuth 2.0) for Gmail — the "Connect with Google" button.

WHY OAUTH INSTEAD OF AN APP PASSWORD?
    An app password is a static secret the user pastes in. OAuth is the modern,
    trusted flow: the user clicks "Connect", Google shows a consent screen, and
    we receive a *scoped, revocable* token (read-only Gmail here). The user can
    revoke it any time from their Google account, and we never see their password.
    That's the "trust win" — and exactly how real products connect Gmail.

WHAT THE USER MUST DO ONCE (free):
    Create an OAuth client at https://console.cloud.google.com/apis/credentials
    (type: "Web application"), add the redirect URI shown in OAUTH_REDIRECT_URI,
    enable the Gmail API, and put the client id/secret in .env. Until then, the
    endpoints return a clear "not configured" message instead of failing.

WHERE THE TOKEN LIVES:
    The refresh token is stored in the OS keychain via secret_store — never on
    disk in plaintext, never in the database.
"""
from __future__ import annotations

import base64
import json
import os

from app.config import settings
from app.security import secret_store

# Don't error if Google returns a different scope set than requested (happens when
# a returning user previously granted more, or with include_granted_scopes).
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

# Non-sensitive login scopes — these never trigger the "unverified app" warning,
# so anyone can sign in even before Google verification.
LOGIN_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

# RESTRICTED/SENSITIVE scopes — these require Google verification (+ a CASA
# assessment for Gmail) to use beyond test users without the warning.
DATA_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
]


def get_scopes() -> list[str]:
    """Active scopes. With GOOGLE_DATA_SCOPES=false (public beta) we request only
    login scopes, so there's no verification needed and no warning."""
    return LOGIN_SCOPES + (DATA_SCOPES if settings.google_data_scopes else [])


# Kept for backward-compat where a module constant is referenced.
SCOPES = get_scopes()

def _token_key(user_id: str) -> str:
    # One token per user, stored separately in the OS keychain.
    return f"google_oauth_token::{user_id}"


def is_configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def _client_config() -> dict:
    return {
        "web": {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.oauth_redirect_uri],
        }
    }


def build_auth_url(state: str) -> str:
    """Return the Google consent-screen URL to redirect the user to."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        _client_config(), scopes=get_scopes(), redirect_uri=settings.oauth_redirect_uri
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",       # so we get a refresh token
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return auth_url


def complete_flow(code: str):
    """Exchange the auth code for OAuth credentials (does NOT persist yet — the
    caller may need the profile first to decide which user to store under)."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        _client_config(), scopes=get_scopes(), redirect_uri=settings.oauth_redirect_uri
    )
    flow.fetch_token(code=code)
    return flow.credentials


def userinfo(creds) -> dict:
    """Fetch the signed-in Google account's email + name."""
    try:
        from googleapiclient.discovery import build

        oauth2 = build("oauth2", "v2", credentials=creds)
        info = oauth2.userinfo().get().execute()
        return {
            "email": info.get("email", ""),
            "name": info.get("name", ""),
            "scopes": list(creds.scopes or SCOPES),
        }
    except Exception:
        return {"email": "", "name": "", "scopes": list(creds.scopes or SCOPES)}


def store_credentials(user_id: str, creds) -> None:
    """Persist the OAuth token for a user in the OS keychain."""
    secret_store.set_secret(_token_key(user_id), creds.to_json())


def exchange_code(code: str, user_id: str) -> dict:
    """Convenience: exchange + persist for a known user (the 'connect' flow)."""
    creds = complete_flow(code)
    store_credentials(user_id, creds)
    return userinfo(creds)


def _load_credentials(user_id: str):
    """Load this user's stored credentials, refreshing the access token if needed."""
    raw = secret_store.get_secret(_token_key(user_id))
    if not raw:
        return None
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    # Load with the full scope union so any previously-granted token still loads,
    # regardless of the current GOOGLE_DATA_SCOPES setting.
    creds = Credentials.from_authorized_user_info(
        json.loads(raw), LOGIN_SCOPES + DATA_SCOPES
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        secret_store.set_secret(_token_key(user_id), creds.to_json())
    return creds


def _email_from_credentials(creds) -> str:
    try:
        from googleapiclient.discovery import build

        oauth2 = build("oauth2", "v2", credentials=creds)
        info = oauth2.userinfo().get().execute()
        return info.get("email", "")
    except Exception:
        return ""


def is_connected(user_id: str) -> bool:
    return secret_store.get_secret(_token_key(user_id)) is not None


def disconnect(user_id: str) -> None:
    secret_store.delete_secret(_token_key(user_id))


def send_email(user_id: str, to: str, subject: str, body: str) -> str:
    """Send an email via the user's Gmail. Should only be called AFTER the user
    has explicitly confirmed in the UI. Raises if not connected / scope missing."""
    creds = _load_credentials(user_id)
    if not creds:
        raise RuntimeError("Google account is not connected.")
    if "https://www.googleapis.com/auth/gmail.send" not in (creds.scopes or []):
        raise RuntimeError(
            "Send permission not granted — reconnect Google to allow sending."
        )
    import base64
    from email.mime.text import MIMEText

    from googleapiclient.discovery import build

    service = build("gmail", "v1", credentials=creds)
    msg = MIMEText(body)
    msg["to"] = to
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = service.users().messages().send(userId="me", body={"raw": raw}).execute()
    return sent.get("id", "sent")


def create_event(
    user_id: str, summary: str, start_iso: str, end_iso: str, location: str = ""
) -> str:
    """Create a Google Calendar event. start/end are local ISO datetimes.
    Raises RuntimeError if not connected or the scope wasn't granted."""
    creds = _load_credentials(user_id)
    if not creds:
        raise RuntimeError("Google account is not connected.")
    if "https://www.googleapis.com/auth/calendar.events" not in (creds.scopes or []):
        raise RuntimeError(
            "Calendar permission not granted — reconnect Google to allow Calendar."
        )
    from googleapiclient.discovery import build

    service = build("calendar", "v3", credentials=creds)
    body = {
        "summary": summary,
        "location": location,
        "start": {"dateTime": start_iso},
        "end": {"dateTime": end_iso},
    }
    ev = service.events().insert(calendarId="primary", body=body).execute()
    return ev.get("htmlLink", "created")


def fetch_recent(count: int, user_id: str) -> list[dict]:
    """Fetch recent inbox messages via the Gmail API. Returns dicts with
    from/subject/snippet. Raises RuntimeError if not connected / scope missing."""
    creds = _load_credentials(user_id)
    if not creds:
        raise RuntimeError("Google account is not connected.")
    if "https://www.googleapis.com/auth/gmail.readonly" not in (creds.scopes or []):
        raise RuntimeError(
            "Gmail access wasn't granted (the app is in sign-in-only mode). "
            "Enable Gmail scopes and reconnect Google to read email."
        )

    from googleapiclient.discovery import build

    service = build("gmail", "v1", credentials=creds)
    listing = (
        service.users()
        .messages()
        .list(userId="me", maxResults=count, labelIds=["INBOX"])
        .execute()
    )
    out = []
    for ref in listing.get("messages", []):
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=ref["id"], format="metadata",
                 metadataHeaders=["From", "Subject"])
            .execute()
        )
        headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
        out.append(
            {
                "from": headers.get("From", ""),
                "subject": headers.get("Subject", ""),
                "snippet": msg.get("snippet", ""),
            }
        )
    return out
