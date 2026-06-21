"""
POST   /push/subscribe   — save push subscription
DELETE /push/subscribe   — remove subscription
POST   /admin/push/send  — admin: queue push to all or specific users
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey
from pydantic import BaseModel

from database import Base, get_db
from auth_utils import get_current_user, require_admin
from models import User

router = APIRouter(tags=["push"])


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = db.query(PushSubscription)
    if body.user_ids:
        q = q.filter(PushSubscription.user_id.in_(body.user_ids))
    count = q.count()
    # pywebpush not installed — subscriptions stored, delivery requires VAPID setup
    return {
        "queued": count,
        "note": "Install pywebpush and configure VAPID keys to enable delivery",
    }
