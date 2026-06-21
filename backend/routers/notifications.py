"""
GET  /notifications            — lista notificações do usuário
GET  /notifications/unread-count — total não lidas
PATCH /notifications/{id}/read — marca uma como lida
PATCH /notifications/read-all  — marca todas como lidas
POST /admin/notifications/remind — envia lembretes de jogos sem aposta (admin)
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from auth_utils import get_current_user, require_admin
from models import Notification, User, Match, Bet, MatchStatus

router = APIRouter(tags=["notifications"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_notification(
    db: Session,
    user_id: int,
    type_: str,
    title: str,
    body: str | None = None,
    meta: dict | None = None,
    push: bool = True,
) -> Notification:
    n = Notification(
        user_id=user_id,
        type=type_,
        title=title,
        body=body,
        meta=meta,
    )
    db.add(n)
    if push:
        try:
            from routers.push import send_push_to_users
            send_push_to_users(db, [user_id], title, body or "", url="/apostas")
        except Exception:
            pass
    return n


@router.get("/notifications/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    count = (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == user.id, Notification.read_at.is_(None))
        .scalar() or 0
    )
    return {"count": count}


@router.get("/notifications")
def list_notifications(
    unread_only: bool = Query(False),
    type_: str | None = Query(None, alias="type"),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    if type_:
        q = q.filter(Notification.type == type_)
    total = q.count()
    rows = q.order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [_serialize(n) for n in rows],
    }


@router.patch("/notifications/read-all", status_code=204)
def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = _utcnow()
    db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.read_at.is_(None),
    ).update({"read_at": now})
    db.commit()


@router.patch("/notifications/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user.id,
    ).first()
    if n and not n.read_at:
        n.read_at = _utcnow()
        db.commit()


@router.post("/admin/notifications/remind", status_code=200)
def send_reminders(
    hours_ahead: int = Query(1, ge=1, le=24),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Cria notificações de lembrete para usuários que ainda não apostaram
    em partidas que começam dentro de `hours_ahead` horas.
    """
    now = _utcnow()
    deadline = now + timedelta(hours=hours_ahead)

    upcoming = (
        db.query(Match)
        .filter(
            Match.status == MatchStatus.scheduled,
            Match.match_date >= now,
            Match.match_date <= deadline,
        )
        .all()
    )

    if not upcoming:
        return {"sent": 0, "matches": 0}

    all_users = db.query(User).all()
    sent = 0

    for match in upcoming:
        team_a = match.team_a.name if match.team_a else "?"
        team_b = match.team_b.name if match.team_b else "?"
        match_time = match.match_date.strftime("%H:%M") if match.match_date else "?"

        betted_user_ids = {
            b.user_id for b in db.query(Bet.user_id).filter(Bet.match_id == match.id).all()
        }

        for user in all_users:
            if user.id in betted_user_ids:
                continue
            # Skip duplicate: already has a reminder for this match
            exists = db.query(Notification).filter(
                Notification.user_id == user.id,
                Notification.type == "bet_reminder",
                Notification.meta["match_id"].astext == str(match.id),
                Notification.created_at >= now - timedelta(hours=2),
            ).first()
            if exists:
                continue

            create_notification(
                db,
                user_id=user.id,
                type_="bet_reminder",
                title=f"⏰ Jogo em {hours_ahead}h — aposte agora!",
                body=f"{team_a} × {team_b} começa às {match_time}. Você ainda não apostou.",
                meta={"match_id": match.id, "team_a": team_a, "team_b": team_b},
            )
            sent += 1

    db.commit()
    return {"sent": sent, "matches": len(upcoming)}


def _serialize(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "meta": n.meta,
        "read": n.read_at is not None,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }
