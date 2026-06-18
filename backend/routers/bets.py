from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session, joinedload
from database import get_db
from auth_utils import get_current_user
from models import Bet, Match, MatchStatus, Ranking, User
from schemas import BetCreate, RankingRow

router = APIRouter(tags=["bets"])


def _match_now(match_date: datetime | None) -> datetime:
    if match_date and match_date.tzinfo is not None:
        return datetime.now(match_date.tzinfo)
    # Synced fixtures are stored as naive UTC timestamps.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _is_open(match: Match) -> bool:
    if match.status != MatchStatus.scheduled:
        return False
    if match.match_date:
        return _match_now(match.match_date) < match.match_date
    return True


def _bet_result(b: Bet) -> str | None:
    if b.evaluated_at is None:
        return None
    if b.points_earned == 3:
        return "exact"
    if b.points_earned == 1:
        return "correct"
    return "wrong"


def _bet_dict(b: Bet) -> dict:
    match = b.match
    result = match.result if match else None
    return {
        "id": b.id,
        "match_id": b.match_id,
        "score_a": b.score_a,
        "score_b": b.score_b,
        "points_earned": b.points_earned,
        "result": _bet_result(b),
        "created_at": b.created_at,
        "locked_at": b.locked_at,
        "group_name": match.group_name if match else None,
        "match_status": match.status.value if match and match.status else None,
        "match_date": match.match_date if match else None,
        "team_a_code": match.team_a.code if match and match.team_a else None,
        "team_b_code": match.team_b.code if match and match.team_b else None,
        "official_score_a": result.score_a if result else None,
        "official_score_b": result.score_b if result else None,
        "is_open": _is_open(match) if match else False,
    }


def _history_payload(user: User, bets: list[Bet], ranking: Ranking | None) -> dict:
    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
        },
        "stats": {
            "total_points": ranking.total_points if ranking else 0,
            "exact_scores": ranking.exact_scores if ranking else 0,
            "correct_results": ranking.correct_results if ranking else 0,
            "total_bets": len(bets),
        },
        "bets": [_bet_dict(b) for b in bets],
    }


@router.post("/bets", status_code=201)
def place_bet(
    payload: BetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    match = db.query(Match).filter(Match.id == payload.match_id).first()
    if not match:
        raise HTTPException(404, "Match not found")
    if not _is_open(match):
        raise HTTPException(409, "Bets closed for this match")

    existing = db.query(Bet).filter(
        Bet.user_id == user.id, Bet.match_id == payload.match_id
    ).first()
    if existing:
        existing.score_a = payload.score_a
        existing.score_b = payload.score_b
        db.commit()
        db.refresh(existing)
        return {
            "id": existing.id,
            "match_id": existing.match_id,
            "score_a": existing.score_a,
            "score_b": existing.score_b,
            "points_earned": existing.points_earned,
            "result": _bet_result(existing),
            "created_at": existing.created_at,
            "updated": True,
        }

    locked_at = match.match_date if match.match_date else None
    bet = Bet(
        user_id=user.id,
        match_id=payload.match_id,
        score_a=payload.score_a,
        score_b=payload.score_b,
        locked_at=locked_at,
    )
    db.add(bet)
    db.commit()
    db.refresh(bet)
    return {
        "id": bet.id,
        "match_id": bet.match_id,
        "score_a": bet.score_a,
        "score_b": bet.score_b,
        "points_earned": bet.points_earned,
        "result": _bet_result(bet),
        "created_at": bet.created_at,
        "updated": False,
    }


@router.patch("/bets/{bet_id}")
def update_bet(
    bet_id: int,
    payload: BetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    bet = db.query(Bet).filter(Bet.id == bet_id, Bet.user_id == user.id).first()
    if not bet:
        raise HTTPException(404, "Bet not found")
    match = db.query(Match).filter(Match.id == bet.match_id).first()
    if not _is_open(match):
        raise HTTPException(409, "Bets closed")
    bet.score_a = payload.score_a
    bet.score_b = payload.score_b
    db.commit()
    db.refresh(bet)
    return {"id": bet.id, "match_id": bet.match_id, "score_a": bet.score_a, "score_b": bet.score_b}


@router.get("/bets")
@router.get("/bets/mine")
def my_bets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    bets = (
        db.query(Bet)
        .options(joinedload(Bet.match).joinedload(Match.team_a),
                 joinedload(Bet.match).joinedload(Match.team_b))
        .filter(Bet.user_id == user.id)
        .order_by(Bet.created_at.desc())
        .all()
    )
    return [_bet_dict(b) for b in bets]


@router.get("/bets/users/{user_id}")
def user_bets_history(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")

    bets = (
        db.query(Bet)
        .options(
            joinedload(Bet.match).joinedload(Match.team_a),
            joinedload(Bet.match).joinedload(Match.team_b),
            joinedload(Bet.match).joinedload(Match.result),
        )
        .filter(Bet.user_id == user.id)
        .order_by(Bet.created_at.desc())
        .all()
    )
    ranking = db.query(Ranking).filter(Ranking.user_id == user.id).first()
    return _history_payload(user, bets, ranking)


@router.get("/ranking")
def ranking(limit: int = Query(default=50, le=100), db: Session = Depends(get_db)):
    bet_counts = (
        db.query(
            Bet.user_id.label("user_id"),
            func.count(Bet.id).label("total_bets"),
        )
        .group_by(Bet.user_id)
        .subquery()
    )
    rows = (
        db.query(
            User.id.label("user_id"),
            User.name.label("name"),
            User.email.label("email"),
            func.coalesce(Ranking.total_points, 0).label("total_points"),
            func.coalesce(Ranking.exact_scores, 0).label("exact_scores"),
            func.coalesce(Ranking.correct_results, 0).label("correct_results"),
            func.coalesce(bet_counts.c.total_bets, 0).label("total_bets"),
        )
        .outerjoin(Ranking, User.id == Ranking.user_id)
        .outerjoin(bet_counts, User.id == bet_counts.c.user_id)
        .filter(or_(Ranking.user_id.isnot(None), bet_counts.c.user_id.isnot(None)))
        .order_by(
            desc(func.coalesce(Ranking.total_points, 0)),
            desc(func.coalesce(Ranking.exact_scores, 0)),
            desc(func.coalesce(bet_counts.c.total_bets, 0)),
            User.name.asc(),
        )
        .limit(limit)
        .all()
    )
    return [
        {
            "position": i + 1,
            "user_id": r.user_id,
            "name": r.name,
            "email": r.email,
            "total_points": r.total_points,
            "exact_scores": r.exact_scores,
            "correct_results": r.correct_results,
            "total_bets": r.total_bets,
        }
        for i, r in enumerate(rows)
    ]
