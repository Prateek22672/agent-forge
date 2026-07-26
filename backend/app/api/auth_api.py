"""Auth endpoints: signup, login, and 'who am I'."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import (
    create_token,
    get_current_user,
    hash_password,
    sign_oauth_state,
    verify_password,
)
from app.database import get_db
from app.integrations import google_oauth
from app.models import User
from app.schemas import (
    LoginRequest,
    ProfileUpdate,
    SignupRequest,
    TokenOut,
    UserOut,
)
from app.seed import create_starter_agents
from app.security.ratelimit import rate_limit
from app.telemetry import client_source, record_login

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Crocs: throttle credential endpoints against brute force.
_login_limit = rate_limit(10, 60)   # 10 / minute / IP
_signup_limit = rate_limit(5, 300)  # 5 / 5 min / IP


@router.get("/google/start")
def google_login_start(desktop: bool = False):
    """Public: begin 'Sign in with Google'. Requests Gmail scopes too, so login
    and the Gmail connection happen in a single consent. `desktop=true` makes the
    callback hand the session back to the desktop app via a deep link."""
    if not google_oauth.is_configured():
        raise HTTPException(
            400,
            "Google login isn't set up yet. Add GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET to .env (see docs/CONNECT_GOOGLE.md).",
        )
    state = sign_oauth_state({"login": True, "desktop": desktop})
    return {"auth_url": google_oauth.build_auth_url(state)}


@router.get("/google/configured")
def google_login_configured():
    return {"configured": google_oauth.is_configured()}


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(
    payload: SignupRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(_signup_limit),
):
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "An account with that email already exists.")
    # The very first account becomes the admin (owns the admin panel).
    first_user = db.query(User).count() == 0
    user = User(
        email=email,
        name=payload.name.strip(),
        password_hash=hash_password(payload.password),
        is_admin=first_user,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    # Give the new account its three starter capabilities.
    create_starter_agents(db, user.id)
    record_login(db, user, client_source(request), method="signup")
    return TokenOut(access_token=create_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(_login_limit),
):
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password.")
    if user.is_suspended:
        raise HTTPException(
            403,
            "This account is suspended pending review"
            + (f": {user.suspended_reason}" if user.suspended_reason else ".")
            + " Contact support if you believe this is a mistake.",
        )
    record_login(db, user, client_source(request), method="password")
    return TokenOut(access_token=create_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/notice/ack", status_code=204)
def ack_notice(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """User acknowledged the admin's warning — clear it so it stops showing."""
    user.notice = ""
    user.notice_at = None
    db.commit()


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update the user's profile / personalization (tone, about, name)."""
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user
