"""
Lightweight admin telemetry: who logged in, from where, and what errored.

Deliberately simple (plain DB rows, no metrics stack) — this exists to answer
"is anyone using this" and "is something on fire", not to be a full APM.
Never raises: telemetry failing must never break the request it's attached to.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import ErrorLog, LoginEvent, User


def client_source(request) -> str:
    """Best-effort guess at which surface made this request. The extension
    sends an explicit header (see extension/background.js); anything else
    with a chrome/moz-extension Origin is an extension too (older versions,
    or requests we didn't tag). Everything else is 'web' — the desktop app
    is an Electron shell around the same web build, so it isn't distinguished
    separately today."""
    client = request.headers.get("x-af-client", "")
    if client in ("extension", "desktop", "web"):
        return client
    origin = request.headers.get("origin", "")
    if origin.startswith("chrome-extension://") or origin.startswith("moz-extension://"):
        return "extension"
    return "web"


def record_login(db: Session, user: User, source: str, method: str = "password") -> None:
    from datetime import datetime, timezone

    try:
        db.add(LoginEvent(user_id=user.id, source=source, method=method))
        user.last_login_at = datetime.now(timezone.utc)
        user.last_login_source = source
        db.commit()
    except Exception:
        db.rollback()


def record_error(
    source: str,
    method: str,
    path: str,
    status_code: int,
    message: str,
    duration_ms: int,
    user_id: str = "",
) -> None:
    """Standalone session — called from middleware, outside any request-scoped
    DB dependency, and after the response may already be on its way out."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        db.add(
            ErrorLog(
                source=source,
                method=method,
                path=path[:300],
                status_code=status_code,
                message=(message or "")[:2000],
                duration_ms=duration_ms,
                user_id=user_id,
            )
        )
        db.commit()
        # Self-trim: keep the table from growing forever on a busy server.
        count = db.query(ErrorLog).count()
        if count > 2000:
            stale = (
                db.query(ErrorLog.id)
                .order_by(ErrorLog.created_at.asc())
                .limit(count - 2000)
                .all()
            )
            ids = [row[0] for row in stale]
            db.query(ErrorLog).filter(ErrorLog.id.in_(ids)).delete(synchronize_session=False)
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
