"""
Admin security audit trail — records login attempts and sensitive admin actions.
Never raises: an audit failure must never block the action it records or, worse,
turn a failed-login record into a 500.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AdminAudit


def client_ip(request) -> str:
    """Real client IP behind Render/Vercel's proxy. X-Forwarded-For is a list;
    the first entry is the original client."""
    if request is None:
        return ""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()[:60]
    try:
        return (request.client.host or "")[:60]
    except Exception:
        return ""


def record(
    db: Session,
    action: str,
    *,
    subject: str = "",
    detail: str = "",
    ip: str = "",
    ok: bool = True,
) -> None:
    try:
        db.add(
            AdminAudit(
                action=action[:40],
                subject=(subject or "")[:120],
                detail=(detail or "")[:2000],
                ip=(ip or "")[:60],
                ok=ok,
            )
        )
        db.commit()
        # Self-trim so the table can't grow unbounded.
        count = db.query(AdminAudit).count()
        if count > 3000:
            stale = (
                db.query(AdminAudit.id)
                .order_by(AdminAudit.created_at.asc())
                .limit(count - 3000)
                .all()
            )
            ids = [row[0] for row in stale]
            db.query(AdminAudit).filter(AdminAudit.id.in_(ids)).delete(synchronize_session=False)
            db.commit()
    except Exception:
        db.rollback()


def recent_failed_logins(db: Session, minutes: int = 30) -> int:
    """Count failed admin logins in the last window — a brute-force signal."""
    from datetime import datetime, timedelta, timezone

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    try:
        return (
            db.query(AdminAudit)
            .filter(AdminAudit.action == "login_fail", AdminAudit.created_at >= since)
            .count()
        )
    except Exception:
        return 0
