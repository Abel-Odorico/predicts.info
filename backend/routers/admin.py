"""
Admin endpoints — require admin JWT.
POST /admin/results        insert real match result, recalculate Elo, evaluate bets
PATCH /admin/players/{id}  mark injury/suspension
POST /admin/recalculate    force tournament simulation refresh
GET  /admin/users          list users with admin metrics
PATCH /admin/users/{id}    update user role
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
import redis as redis_lib
import json

from database import get_db
from config import settings
from auth_utils import require_admin
from models import (
    Match, MatchResult, MatchStatus, Team, Player,
    Bet, Ranking, TournamentSimulation, User, UserRole
)
from schemas import ResultCreate, InjuryUpdate, AdminUserUpdate
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
        bet.evaluated_at = datetime.now(timezone.utc).replace(tzinfo=None)

        ranking = db.query(Ranking).filter(Ranking.user_id == bet.user_id).first()
        if not ranking:
            ranking = Ranking(user_id=bet.user_id, total_points=0, exact_scores=0, correct_results=0)
            db.add(ranking)
        ranking.total_points   = (ranking.total_points   or 0) + bet.points_earned
        ranking.exact_scores   = (ranking.exact_scores   or 0) + (1 if exact else 0)
        ranking.correct_results = (ranking.correct_results or 0) + (1 if correct_result and not exact else 0)


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


@router.get("/users")
def list_users(
    q: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = (
        db.query(
            User,
            func.count(Bet.id).label("bets_count"),
            func.coalesce(func.sum(Bet.points_earned), 0).label("bets_points"),
        )
        .outerjoin(Bet, Bet.user_id == User.id)
        .group_by(User.id)
        .order_by(User.created_at.desc())
    )

    if q:
        like = f"%{q.strip()}%"
        query = query.filter((User.name.ilike(like)) | (User.email.ilike(like)))

    rows = query.limit(limit).all()
    return [
        {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "phone": user.phone,
            "name": user.name,
            "role": user.role.value if user.role else UserRole.user.value,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "bets_count": int(bets_count or 0),
            "bets_points": int(bets_points or 0),
        }
        for user, bets_count, bets_points in rows
    ]


@router.patch("/users/{user_id}")
def update_user_role(
    user_id: int,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    try:
        new_role = UserRole(payload.role)
    except ValueError:
        raise HTTPException(400, "Invalid role")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == admin_user.id and new_role != UserRole.admin:
        raise HTTPException(400, "You cannot remove your own admin role")

    user.role = new_role
    db.commit()
    return {"user_id": user.id, "email": user.email, "role": user.role.value}


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


@router.get("/bets/coverage")
def bets_coverage(
    status: str | None = Query(default="scheduled"),
    limit: int = Query(default=50, le=200),
    user_limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    users = db.query(User).order_by(User.name.asc()).limit(user_limit).all()

    match_query = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.bets).joinedload(Bet.user))
        .order_by(Match.match_date.asc().nullslast(), Match.id.asc())
    )
    if status and status != "all":
        match_query = match_query.filter(Match.status == MatchStatus(status))
    matches = match_query.limit(limit).all()

    coverage = []
    for match in matches:
        bettors = []
        bettor_ids = set()
        for bet in match.bets:
            if not bet.user:
                continue
            bettor_ids.add(bet.user_id)
            bettors.append({
                "user_id": bet.user_id,
                "name": bet.user.name,
                "email": bet.user.email,
                "score_a": bet.score_a,
                "score_b": bet.score_b,
                "created_at": bet.created_at,
            })

        missing = [
            {"user_id": user.id, "name": user.name, "email": user.email}
            for user in users
            if user.id not in bettor_ids
        ]

        coverage.append({
            "match_id": match.id,
            "group_name": match.group_name,
            "status": match.status.value if match.status else None,
            "match_date": match.match_date,
            "team_a_code": match.team_a.code if match.team_a else None,
            "team_b_code": match.team_b.code if match.team_b else None,
            "bettors_count": len(bettors),
            "missing_count": len(missing),
            "bettors": bettors,
            "missing_users": missing,
        })

    return {
        "total_users": len(users),
        "matches": coverage,
    }
