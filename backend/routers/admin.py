"""
Admin endpoints — require admin JWT.
POST /admin/results        insert real match result, recalculate Elo, evaluate bets
PATCH /admin/players/{id}  mark injury/suspension
POST /admin/recalculate    force tournament simulation refresh
POST /admin/promote/{email} promote user to admin role
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
import redis as redis_lib
import json

from database import get_db
from config import settings
from auth_utils import require_admin
from models import (
    Match, MatchResult, MatchStatus, Team, Player,
    Bet, Ranking, TournamentSimulation, User, UserRole
)
from schemas import ResultCreate, InjuryUpdate
from engine.elo import update_ratings

router = APIRouter(prefix="/admin", tags=["admin"])


def _redis():
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


def _invalidate_match_cache(match_id: int) -> None:
    try:
        r = _redis()
        for key in r.scan_iter(f"sim:{match_id}:*"):
            r.delete(key)
        for key in r.scan_iter("tournament:*"):
            r.delete(key)
    except Exception:
        pass


def _evaluate_bets(match: Match, result: MatchResult, db: Session) -> None:
    bets = db.query(Bet).filter(Bet.match_id == match.id).all()
    for bet in bets:
        if bet.evaluated_at:
            continue
        exact = (bet.score_a == result.score_a and bet.score_b == result.score_b)
        correct_result = (
            (bet.score_a > bet.score_b) == (result.score_a > result.score_b) and
            (bet.score_a == bet.score_b) == (result.score_a == result.score_b)
        )
        bet.points_earned = 3 if exact else (1 if correct_result else 0)
        bet.evaluated_at = datetime.utcnow()

        ranking = db.query(Ranking).filter(Ranking.user_id == bet.user_id).first()
        if not ranking:
            ranking = Ranking(user_id=bet.user_id)
            db.add(ranking)
        ranking.total_points += bet.points_earned
        if exact:
            ranking.exact_scores += 1
        elif correct_result:
            ranking.correct_results += 1


@router.post("/results", status_code=201)
def insert_result(
    payload: ResultCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    match = db.query(Match).options(
        joinedload(Match.team_a), joinedload(Match.team_b)
    ).filter(Match.id == payload.match_id).first()

    if not match:
        raise HTTPException(404, "Match not found")
    if match.status == MatchStatus.finished:
        raise HTTPException(409, "Result already recorded")

    score_a, score_b = payload.score_a, payload.score_b
    outcome = "a" if score_a > score_b else ("b" if score_b > score_a else "draw")

    result = MatchResult(
        match_id=match.id,
        score_a=score_a,
        score_b=score_b,
        xg_a=payload.xg_a,
        xg_b=payload.xg_b,
        result=outcome,
    )
    db.add(result)

    match.status = MatchStatus.finished

    # Elo update — capture old values before mutating
    elo_result = 1.0 if score_a > score_b else (0.5 if score_a == score_b else 0.0)
    old_a = float(match.team_a.elo_rating)
    old_b = float(match.team_b.elo_rating)
    new_a, new_b = update_ratings(old_a, old_b, elo_result)
    match.team_a.elo_rating = new_a
    match.team_b.elo_rating = new_b

    db.flush()
    _evaluate_bets(match, result, db)
    db.commit()

    _invalidate_match_cache(match.id)

    return {
        "match_id": match.id,
        "result": f"{score_a}x{score_b}",
        "outcome": outcome,
        "elo_update": {
            match.team_a.code: {"before": old_a, "after": new_a, "delta": round(new_a - old_a, 2)},
            match.team_b.code: {"before": old_b, "after": new_b, "delta": round(new_b - old_b, 2)},
        },
    }


@router.patch("/players/{player_id}")
def update_player_status(
    player_id: int,
    payload: InjuryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    player = db.query(Player).filter(Player.id == player_id).first()
    if not player:
        raise HTTPException(404, "Player not found")
    player.is_injured = payload.is_injured
    player.is_suspended = payload.is_suspended
    db.commit()

    # Invalidate team caches
    try:
        r = _redis()
        for key in r.scan_iter("tournament:*"):
            r.delete(key)
    except Exception:
        pass

    return {"player_id": player_id, "is_injured": payload.is_injured, "is_suspended": payload.is_suspended}


@router.post("/recalculate")
def force_recalculate(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    try:
        r = _redis()
        cleared = 0
        for key in r.scan_iter("tournament:*"):
            r.delete(key)
            cleared += 1
        for key in r.scan_iter("sim:*"):
            r.delete(key)
            cleared += 1
    except Exception:
        cleared = 0

    return {"status": "cache_cleared", "keys_removed": cleared, "message": "Next /tournament/simulate call will recompute from scratch"}


@router.post("/promote/{email}")
def promote_user(
    email: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.role = UserRole.admin
    db.commit()
    return {"user_id": user.id, "email": user.email, "role": "admin"}


@router.get("/bets/all")
def all_bets(
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    bets = (
        db.query(Bet)
        .options(
            joinedload(Bet.user),
            joinedload(Bet.match).joinedload(Match.team_a),
            joinedload(Bet.match).joinedload(Match.team_b),
            joinedload(Bet.match).joinedload(Match.result),
        )
        .order_by(Bet.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": b.id,
            "user_email": b.user.email if b.user else None,
            "user_id": b.user_id,
            "team_a": b.match.team_a.code if b.match and b.match.team_a else None,
            "team_b": b.match.team_b.code if b.match and b.match.team_b else None,
            "score_a": b.score_a,
            "score_b": b.score_b,
            "points_earned": b.points_earned,
            "result": (
                "exact" if b.points_earned == 3
                else "correct" if b.points_earned == 1
                else "wrong" if b.evaluated_at else "pending"
            ),
            "created_at": b.created_at,
            "group": b.match.group_name if b.match else None,
        }
        for b in bets
    ]
