"""
POST   /push/subscribe      — save/update push subscription (auth required)
DELETE /push/subscribe      — remove subscription (auth required)
GET    /push/vapid-key      — return public VAPID key (public)
POST   /admin/push/send     — send push to all or specific users (admin)
"""
import json
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey
from pydantic import BaseModel

from database import Base, get_db
from auth_utils import get_current_user, require_admin
from models import User
from config import settings

router = APIRouter(tags=["push"])
log = logging.getLogger(__name__)


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _has_vapid() -> bool:
    return bool(getattr(settings, "vapid_private_key", None) and
                getattr(settings, "vapid_public_key", None))


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint   = Column(Text, nullable=False, unique=True)
    p256dh     = Column(Text, nullable=False)
    auth       = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class SubscribeBody(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class SendPushBody(BaseModel):
    title: str
    body: str
    url: str = "/"
    user_ids: list[int] | None = None


def _send_one(sub: PushSubscription, title: str, body: str, url: str = "/") -> bool:
    """Send a single push notification. Returns True on success."""
    if not _has_vapid():
        return False
    try:
        from pywebpush import webpush, WebPushException
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": f"mailto:{settings.vapid_claims_email}"},
        )
        return True
    except Exception as exc:
        log.warning("push failed for endpoint %s: %s", sub.endpoint[:40], exc)
        return False


def send_push_to_users(db: Session, user_ids: list[int], title: str, body: str, url: str = "/"):
    """Helper called from other routers (notifications, version, poll)."""
    if not _has_vapid():
        return 0
    subs = db.query(PushSubscription).filter(PushSubscription.user_id.in_(user_ids)).all()
    return sum(1 for s in subs if _send_one(s, title, body, url))


def send_push_to_all(db: Session, title: str, body: str, url: str = "/"):
    """Send to every subscriber."""
    if not _has_vapid():
        return 0
    subs = db.query(PushSubscription).all()
    return sum(1 for s in subs if _send_one(s, title, body, url))


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/push/vapid-key")
def vapid_key():
    key = getattr(settings, "vapid_public_key", None)
    return {"publicKey": key or ""}


@router.post("/push/subscribe", status_code=201)
def subscribe(
    body: SubscribeBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if existing:
        existing.user_id = user.id
        existing.p256dh  = body.p256dh
        existing.auth    = body.auth
    else:
        db.add(PushSubscription(
            user_id=user.id,
            endpoint=body.endpoint,
            p256dh=body.p256dh,
            auth=body.auth,
        ))
    db.commit()
    return {"ok": True}


@router.delete("/push/subscribe", status_code=204)
def unsubscribe(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.query(PushSubscription).filter(PushSubscription.user_id == user.id).delete()
    db.commit()


@router.post("/admin/push/send")
def send_push(
    body: SendPushBody,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if not _has_vapid():
        return {"error": "VAPID keys not configured", "sent": 0}

    q = db.query(PushSubscription)
    if body.user_ids:
        q = q.filter(PushSubscription.user_id.in_(body.user_ids))
    subs = q.all()

    def _send_all():
        ok = sum(1 for s in subs if _send_one(s, body.title, body.body, body.url))
        log.info("admin push: %d/%d delivered", ok, len(subs))

    background.add_task(_send_all)
    return {"queued": len(subs)}
