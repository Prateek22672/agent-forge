"""
Web Push sender — delivers reminder/priority notifications to a user's browsers
(PWA) even when the app is closed, using the Web Push protocol + VAPID.

Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT in the environment.
Subscriptions that the push service reports as gone (404/410) are pruned.
"""
from __future__ import annotations

import json

from app.config import settings


def push_enabled() -> bool:
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def _private_key_pem() -> str:
    return settings.vapid_private_key.replace("\\n", "\n")


def send_to_subscription(sub, title: str, body: str, url: str = "/") -> bool:
    """Send one push. Returns (status, error):
      status = "sent" | "dead" (prune it) | "error"
      error  = a short string when status == "error" (else "")."""
    from pywebpush import WebPushException, webpush

    payload = json.dumps({"title": title, "body": body, "url": url})
    info = {
        "endpoint": sub.endpoint,
        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
    }
    try:
        webpush(
            subscription_info=info,
            data=payload,
            vapid_private_key=_private_key_pem(),
            vapid_claims={"sub": settings.vapid_subject},
            ttl=60,
        )
        return ("sent", "")
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            return ("dead", "")  # subscription gone — prune it
        body_txt = ""
        try:
            body_txt = exc.response.text[:200] if exc.response is not None else ""
        except Exception:
            pass
        return ("error", f"{status or ''} {exc} {body_txt}".strip())
    except Exception as exc:
        return ("error", str(exc)[:200])


def notify_user(db, user_id: str, title: str, body: str, url: str = "/") -> dict:
    """Push to all of a user's devices. Prunes dead subscriptions.
    Returns {subscriptions, sent, dead, errors:[...]} for diagnostics."""
    if not push_enabled():
        return {"subscriptions": 0, "sent": 0, "dead": 0, "errors": ["push_not_configured"]}
    from app.models import PushSubscription

    subs = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user_id)
        .all()
    )
    sent = dead = 0
    errors: list[str] = []
    for sub in subs:
        status, err = send_to_subscription(sub, title, body, url)
        if status == "sent":
            sent += 1
        elif status == "dead":
            dead += 1
            db.delete(sub)
        else:
            errors.append(err)
    db.commit()
    return {"subscriptions": len(subs), "sent": sent, "dead": dead, "errors": errors}
