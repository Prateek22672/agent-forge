"""
Browser-extension Google login.

Extensions can't use the website's redirect-to-/api/.../callback flow (there's
no page for Google to land on). Instead the extension uses Chrome's
`chrome.identity.launchWebAuthFlow`, which gives it its own
`https://<extension-id>.chromiumapp.org/` redirect URI and hands back an
authorization code directly in JS. This router lets the extension:
  1. discover the OAuth client_id (public info) to build the consent URL, and
  2. exchange the code it received for an AgentFury session token,
using the SAME Google OAuth client as the website (just a different, extension
-specific redirect URI, which must be added to the Google Cloud Console client
as an additional Authorized redirect URI).

Login-first, same as the website: only requests non-sensitive scopes, so
there's no "unverified app" warning for the extension's login button. Gmail/
Calendar connection still happens through the main web app.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import create_token
from app.config import settings
from app.database import get_db
from app.integrations import google_oauth
from app.schemas import TokenOut

router = APIRouter(prefix="/api/auth/google", tags=["auth"])


@router.get("/client-id")
def client_id():
    """Public: the OAuth client_id (not secret) so the extension can build the
    Google consent URL itself via chrome.identity.launchWebAuthFlow."""
    return {
        "client_id": settings.google_client_id,
        "configured": google_oauth.is_configured(),
    }


class ExtensionTokenRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/extension-token", response_model=TokenOut)
def extension_token(
    payload: ExtensionTokenRequest, db: Session = Depends(get_db)
):
    """Exchange the code the extension got from Google for an AgentFury session
    token — signing in (or creating an account) exactly like the website's
    Google login."""
    if not google_oauth.is_configured():
        raise HTTPException(400, "Google OAuth isn't set up on the server.")
    try:
        creds = google_oauth.complete_flow(payload.code, redirect_uri=payload.redirect_uri)
    except Exception as exc:
        raise HTTPException(400, f"Google sign-in failed: {exc}")

    from app.google_login import login_or_create_user
    from app.telemetry import record_login

    user, _info = login_or_create_user(db, creds)
    if user is None:
        raise HTTPException(400, "Google didn't return an email for this account.")
    record_login(db, user, "extension", method="google")
    token = create_token(user.id)
    return TokenOut(access_token=token, user=user)
