from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from auth_utils import get_current_user, get_optional_user, require_admin
from models import Poll, PollOption, PollVote, PollVoteHistory, User

router = APIRouter(tags=["poll"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _is_open(poll: Poll) -> bool:
    now = _utcnow()
    return poll.status == "active" and poll.opens_at <= now <= poll.closes_at


def _maybe_autoclose(poll: Poll, db: Session) -> Poll:
    if poll.status == "active" and _utcnow() > poll.closes_at:
        tally, total_votes = _compute_tally(poll, db)
        suggestion_count = (
            db.query(func.count(PollVote.id))
            .filter(
                PollVote.poll_id == poll.id,
                PollVote.suggestion.isnot(None),
                PollVote.suggestion != "",
            )
            .scalar() or 0
        )
        winner = max(tally, key=lambda x: x["count"]) if tally else None
        poll.status = "closed"
        poll.closed_at = _utcnow()
        poll.report = {
            "total_votes": total_votes,
            "tally": tally,
            "winner": winner,
            "suggestion_count": suggestion_count,
            "generated_at": _utcnow().isoformat(),
        }
        db.commit()
        db.refresh(poll)
    return poll


def _compute_tally(poll: Poll, db: Session):
    total = db.query(func.count(PollVote.id)).filter(PollVote.poll_id == poll.id).scalar() or 0
    rows = []
    for opt in poll.options:
        count = (
            db.query(func.count(PollVote.id))
            .filter(PollVote.poll_id == poll.id, PollVote.option_id == opt.id)
            .scalar() or 0
        )
        rows.append({
            "id": opt.id,
            "label": opt.label,
            "count": count,
            "pct": round(count / total * 100, 1) if total > 0 else 0.0,
        })
    return rows, total


def _get_latest_poll(db: Session) -> Poll | None:
    poll = db.query(Poll).filter(Poll.status == "active").order_by(Poll.id.desc()).first()
    if not poll:
        poll = db.query(Poll).order_by(Poll.id.desc()).first()
    return poll


@router.get("/poll/active")
def get_active_poll(db: Session = Depends(get_db)):
    poll = _get_latest_poll(db)
    if not poll:
        raise HTTPException(404, "Nenhuma consulta encontrada")

    poll = _maybe_autoclose(poll, db)
    tally, total_votes = _compute_tally(poll, db)

    total_users = db.query(func.count(User.id)).scalar() or 0
    suggestion_count = (
        db.query(func.count(PollVote.id))
        .filter(
            PollVote.poll_id == poll.id,
            PollVote.suggestion.isnot(None),
            PollVote.suggestion != "",
        )
        .scalar() or 0
    )

    return {
        "id": poll.id,
        "title": poll.title,
        "description": poll.description,
        "status": poll.status,
        "is_open": _is_open(poll),
        "opens_at": poll.opens_at,
        "closes_at": poll.closes_at,
        "closed_at": poll.closed_at,
        "total_votes": total_votes,
        "total_users": total_users,
        "suggestion_count": suggestion_count,
        "options": tally,
        "report": poll.report,
    }


@router.get("/poll/my-vote")
def my_vote(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    poll = _get_latest_poll(db)
    if not poll:
        raise HTTPException(404, "Nenhuma consulta encontrada")

    vote = db.query(PollVote).filter(
        PollVote.poll_id == poll.id,
        PollVote.user_id == user.id,
    ).first()

    if not vote:
        return {"voted": False, "option_id": None, "suggestion": None}

    return {
        "voted": True,
        "option_id": vote.option_id,
        "suggestion": vote.suggestion,
        "updated_at": vote.updated_at,
    }


class VotePayload(BaseModel):
    option_id: int
    suggestion: str | None = None


@router.post("/poll/vote")
def cast_vote(
    payload: VotePayload,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    poll = db.query(Poll).filter(Poll.status == "active").order_by(Poll.id.desc()).first()
    if not poll:
        raise HTTPException(404, "Nenhuma consulta ativa encontrada")
    if not _is_open(poll):
        raise HTTPException(409, "Consulta encerrada")

    option = db.query(PollOption).filter(
        PollOption.id == payload.option_id,
        PollOption.poll_id == poll.id,
    ).first()
    if not option:
        raise HTTPException(400, "Opção inválida")

    suggestion = (payload.suggestion or "").strip()[:500] or None
    ip = request.client.host if request.client else None
    ua = (request.headers.get("user-agent") or "")[:500]

    existing = db.query(PollVote).filter(
        PollVote.poll_id == poll.id,
        PollVote.user_id == user.id,
    ).first()

    if existing:
        hist = PollVoteHistory(
            vote_id=existing.id,
            poll_id=poll.id,
            user_id=user.id,
            option_id=existing.option_id,
        )
        db.add(hist)
        existing.option_id = payload.option_id
        existing.suggestion = suggestion
        existing.updated_at = _utcnow()
        db.commit()
        return {"voted": True, "updated": True, "option_id": existing.option_id}

    vote = PollVote(
        poll_id=poll.id,
        user_id=user.id,
        option_id=payload.option_id,
        suggestion=suggestion,
        ip=ip,
        user_agent=ua,
    )
    db.add(vote)
    db.commit()
    return {"voted": True, "updated": False, "option_id": payload.option_id}


@router.post("/admin/poll/close/{poll_id}")
def close_poll(
    poll_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    poll = db.query(Poll).filter(Poll.id == poll_id).first()
    if not poll:
        raise HTTPException(404, "Consulta não encontrada")
    if poll.status == "closed":
        raise HTTPException(409, "Consulta já encerrada")

    tally, total_votes = _compute_tally(poll, db)
    suggestion_count = (
        db.query(func.count(PollVote.id))
        .filter(
            PollVote.poll_id == poll.id,
            PollVote.suggestion.isnot(None),
            PollVote.suggestion != "",
        )
        .scalar() or 0
    )
    winner = max(tally, key=lambda x: x["count"]) if tally else None
    report = {
        "total_votes": total_votes,
        "tally": tally,
        "winner": winner,
        "suggestion_count": suggestion_count,
        "generated_at": _utcnow().isoformat(),
    }
    poll.status = "closed"
    poll.closed_at = _utcnow()
    poll.report = report
    db.commit()
    return {"closed": True, "report": report}


@router.post("/admin/poll/notify-pending")
def notify_pending_voters(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    from routers.notifications import create_notification

    poll = db.query(Poll).filter(Poll.status == "active").order_by(Poll.id.desc()).first()
    if not poll:
        raise HTTPException(404, "Nenhuma pesquisa ativa")
    if not _is_open(poll):
        raise HTTPException(409, "Pesquisa encerrada")

    voted_ids = db.query(PollVote.user_id).filter(PollVote.poll_id == poll.id).subquery()
    pending = db.query(User).filter(User.id.notin_(voted_ids)).all()

    count = 0
    for user in pending:
        create_notification(
            db, user.id,
            type_="poll_reminder",
            title="📊 Participe da pesquisa!",
            body=poll.title,
            meta={"poll_id": poll.id},
        )
        count += 1

    db.commit()
    return {"sent": count, "poll_id": poll.id, "total_pending": len(pending)}


@router.get("/admin/poll/suggestions")
def poll_suggestions(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    poll = _get_latest_poll(db)
    if not poll:
        raise HTTPException(404, "Nenhuma consulta encontrada")

    votes = (
        db.query(PollVote)
        .filter(
            PollVote.poll_id == poll.id,
            PollVote.suggestion.isnot(None),
            PollVote.suggestion != "",
        )
        .order_by(PollVote.updated_at.desc())
        .all()
    )
    return [
        {
            "user_id": v.user_id,
            "suggestion": v.suggestion,
            "option_id": v.option_id,
            "updated_at": v.updated_at,
        }
        for v in votes
    ]
