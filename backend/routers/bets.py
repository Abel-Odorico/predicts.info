from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import case, desc, func, or_, and_
from sqlalchemy.orm import Session, joinedload
from database import get_db
from auth_utils import get_current_user, get_optional_user
from models import Bet, Match, MatchPhase, MatchStatus, Ranking, User, UserRole
from schemas import BetCreate, RankingRow
from routers.audit import log_action

router = APIRouter(tags=["bets"])


def _match_now(match_date: datetime | None) -> datetime:
    if match_date and match_date.tzinfo is not None:
        return datetime.now(match_date.tzinfo)
    # Synced fixtures are stored as naive UTC timestamps.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _is_open(match: Match) -> bool:
    if match.status != MatchStatus.scheduled:
        return False
    deadline = match.bet_deadline or match.match_date
    if deadline:
        return _match_now(deadline) < deadline
    return True


def _bet_visible_to(bet: Bet, viewer: User | None) -> bool:
    """Palpite alheio só fica visível depois que as apostas fecham (jogo começou).

    Dono e admin sempre veem; sem match carregado, esconde por segurança."""
    if viewer and (viewer.id == bet.user_id or viewer.role == UserRole.admin):
        return True
    if not bet.match:
        return False
    return not _is_open(bet.match)


def _bet_result(b: Bet) -> str | None:
    if b.evaluated_at is None:
        return None
    if b.points_earned in (3, 25):
        return "exact"
    if b.points_earned and b.points_earned > 0:
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
        "et_winner_pick": b.et_winner_pick,
        "et_points_earned": b.et_points_earned,
        "result": _bet_result(b),
        "created_at": b.created_at,
        "locked_at": b.locked_at,
        "group_name": match.group_name if match else None,
        "match_phase": match.phase.value if match and match.phase else None,
        "match_status": match.status.value if match and match.status else None,
        "match_date": match.match_date if match else None,
        "team_a_code": match.team_a.code if match and match.team_a else None,
        "team_b_code": match.team_b.code if match and match.team_b else None,
        "team_a_name": match.team_a.name if match and match.team_a else None,
        "team_b_name": match.team_b.name if match and match.team_b else None,
        "team_a_flag": match.team_a.flag_url if match and match.team_a else None,
        "team_b_flag": match.team_b.flag_url if match and match.team_b else None,
        "official_score_a": result.score_a if result else None,
        "official_score_b": result.score_b if result else None,
        "decided_by_penalties": result.decided_by_penalties if result else False,
        "et_winner": result.et_winner if result else None,
        "penalty_score_a": result.penalty_score_a if result else None,
        "penalty_score_b": result.penalty_score_b if result else None,
        "is_open": _is_open(match) if match else False,
    }


def _history_payload(user: User, bets: list[Bet], ranking: Ranking | None, ranking_position: int | None = None, total_users: int | None = None) -> dict:
    return {
        "user": {
            "id": user.id,
            "name": user.name,
        },
        "stats": {
            "total_points": ranking.total_points if ranking else 0,
            "exact_scores": ranking.exact_scores if ranking else 0,
            "correct_results": ranking.correct_results if ranking else 0,
            "total_bets": len(bets),
        },
        "ranking_position": ranking_position,
        "total_users": total_users,
        "bets": [_bet_dict(b) for b in bets],
    }


@router.post("/bets", status_code=201)
def place_bet(
    payload: BetCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ip = request.client.host if request.client else None

    def _notify_whatsapp(match_id: int, score_a: int, score_b: int):
        try:
            from routers.whatsapp import send_bet_confirmation_whatsapp
            background_tasks.add_task(send_bet_confirmation_whatsapp, user.id, match_id, score_a, score_b)
        except Exception:
            pass

    def _log_rejected(reason: str, match: Match | None = None):
        log_action(
            db,
            user.id,
            "bet.rejected",
            {
                "match_id": payload.match_id,
                "score_a": payload.score_a,
                "score_b": payload.score_b,
                "reason": reason,
                "match_status": match.status.value if match and match.status else None,
                "match_date": match.match_date.isoformat() if match and match.match_date else None,
            },
            ip,
        )
        db.commit()

    match = db.query(Match).filter(Match.id == payload.match_id).first()
    if not match:
        _log_rejected("match_not_found")
        raise HTTPException(404, "Match not found")
    if not _is_open(match):
        _log_rejected("bets_closed", match)
        raise HTTPException(409, "Bets closed for this match")

    # Palpite de vencedor na prorrogação/pênaltis só existe em mata-mata —
    # fase de grupos não tem prorrogação.
    et_winner_pick = payload.et_winner_pick if match.phase != MatchPhase.group else None

    existing = db.query(Bet).filter(
        Bet.user_id == user.id, Bet.match_id == payload.match_id
    ).first()
    if existing:
        existing.score_a = payload.score_a
        existing.score_b = payload.score_b
        existing.et_winner_pick = et_winner_pick
        log_action(db, user.id, "bet.place", {
            "match_id": payload.match_id,
            "score": f"{payload.score_a}-{payload.score_b}",
            "et_winner_pick": et_winner_pick,
            "updated": True,
        })
        db.commit()
        db.refresh(existing)
        _notify_whatsapp(match.id, existing.score_a, existing.score_b)
        return {
            "id": existing.id,
            "match_id": existing.match_id,
            "score_a": existing.score_a,
            "score_b": existing.score_b,
            "points_earned": existing.points_earned,
            "et_winner_pick": existing.et_winner_pick,
            "et_points_earned": existing.et_points_earned,
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
        et_winner_pick=et_winner_pick,
        locked_at=locked_at,
    )
    db.add(bet)
    db.flush()
    log_action(db, user.id, "bet.place", {
        "match_id": payload.match_id,
        "score": f"{payload.score_a}-{payload.score_b}",
        "et_winner_pick": et_winner_pick,
        "updated": False,
        "bet_id": bet.id,
    })
    db.commit()
    db.refresh(bet)
    _notify_whatsapp(match.id, bet.score_a, bet.score_b)
    return {
        "id": bet.id,
        "match_id": bet.match_id,
        "score_a": bet.score_a,
        "score_b": bet.score_b,
        "points_earned": bet.points_earned,
        "et_winner_pick": bet.et_winner_pick,
        "et_points_earned": bet.et_points_earned,
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
    bet.et_winner_pick = payload.et_winner_pick if match.phase != MatchPhase.group else None
    db.commit()
    db.refresh(bet)
    return {
        "id": bet.id,
        "match_id": bet.match_id,
        "score_a": bet.score_a,
        "score_b": bet.score_b,
        "et_winner_pick": bet.et_winner_pick,
    }


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
def user_bets_history(
    user_id: int,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
):
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
    bets = [b for b in bets if _bet_visible_to(b, viewer)]
    ranking = db.query(Ranking).filter(Ranking.user_id == user.id).first()

    # compute ranking position
    ranked_users = (
        db.query(User.id)
        .outerjoin(Ranking, User.id == Ranking.user_id)
        .filter(or_(Ranking.user_id.isnot(None), User.id.in_(
            db.query(Bet.user_id).distinct()
        )))
        .order_by(
            desc(func.coalesce(Ranking.total_points, 0)),
            desc(func.coalesce(Ranking.exact_scores, 0)),
            User.name.asc(),
        )
        .all()
    )
    total_users = len(ranked_users)
    ranking_position = next((i + 1 for i, r in enumerate(ranked_users) if r[0] == user_id), None)

    return _history_payload(user, bets, ranking, ranking_position, total_users)


@router.get("/bets/users/{user_id}/ranking-history")
def get_ranking_history(user_id: int, db: Session = Depends(get_db)):
    from sqlalchemy import text
    rows = db.execute(text("""
        SELECT position, total_users, points, snapshot_at
        FROM ranking_snapshots
        WHERE user_id = :uid
        ORDER BY snapshot_at ASC
        LIMIT 90
    """), {"uid": user_id}).fetchall()
    return [
        {"position": r[0], "total_users": r[1], "points": r[2],
         "snapshot_at": r[3].isoformat() if r[3] else None}
        for r in rows
    ]


@router.get("/bets/compare/{user_a_id}/{user_b_id}")
def compare_users(
    user_a_id: int,
    user_b_id: int,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
):
    user_a = db.query(User).filter(User.id == user_a_id).first()
    user_b = db.query(User).filter(User.id == user_b_id).first()
    if not user_a or not user_b:
        raise HTTPException(404, "Usuário não encontrado")

    def _load(uid: int) -> dict:
        bets = (
            db.query(Bet)
            .options(
                joinedload(Bet.match).joinedload(Match.team_a),
                joinedload(Bet.match).joinedload(Match.team_b),
                joinedload(Bet.match).joinedload(Match.result),
            )
            .filter(Bet.user_id == uid)
            .all()
        )
        return {b.match_id: b for b in bets}

    map_a = _load(user_a_id)
    map_b = _load(user_b_id)

    rows: list[dict] = []
    a_wins = b_wins = ties = a_total = b_total = 0

    def _info(b: Bet | None) -> dict | None:
        if not b:
            return None
        return {"score_a": b.score_a, "score_b": b.score_b,
                "points": b.points_earned or 0, "result": _bet_result(b)}

    for mid in set(map_a) | set(map_b):
        ba, bb = map_a.get(mid), map_b.get(mid)
        m = (ba or bb).match if (ba or bb) else None
        if not m:
            continue
        # Palpite de jogo ainda aberto só aparece pro próprio dono
        if ba and not _bet_visible_to(ba, viewer):
            ba = None
        if bb and not _bet_visible_to(bb, viewer):
            bb = None
        if not ba and not bb:
            continue
        res = m.result
        pa = (ba.points_earned or 0) if ba else 0
        pb = (bb.points_earned or 0) if bb else 0
        a_total += pa
        b_total += pb
        if ba and bb and ba.evaluated_at and bb.evaluated_at:
            if pa > pb:   a_wins += 1
            elif pb > pa: b_wins += 1
            else:         ties   += 1
        rows.append({
            "match_id": mid,
            "match_date": m.match_date.isoformat() if m.match_date else None,
            "phase": m.phase.value if m.phase else None,
            "group_name": m.group_name,
            "team_a_code": m.team_a.code if m.team_a else None,
            "team_b_code": m.team_b.code if m.team_b else None,
            "team_a_name": m.team_a.name if m.team_a else None,
            "team_b_name": m.team_b.name if m.team_b else None,
            "team_a_flag": m.team_a.flag_url if m.team_a else None,
            "team_b_flag": m.team_b.flag_url if m.team_b else None,
            "official_score_a": res.score_a if res else None,
            "official_score_b": res.score_b if res else None,
            "bet_a": _info(ba),
            "bet_b": _info(bb),
        })

    rows.sort(key=lambda r: r["match_date"] or "")
    return {
        "user_a": {"id": user_a.id, "name": user_a.name},
        "user_b": {"id": user_b.id, "name": user_b.name},
        "matches": rows,
        "summary": {"user_a_wins": a_wins, "user_b_wins": b_wins, "ties": ties,
                    "user_a_total": a_total, "user_b_total": b_total},
    }


@router.get("/ranking")
def ranking(
    limit: int = Query(default=50, le=100),
    group: str | None = Query(default=None, description="Grupo A-L"),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    filtered = bool(group or date_from or date_to)

    if filtered:
        match_q = db.query(Match.id)
        if group:
            match_q = match_q.filter(Match.group_name == group.upper())
        if date_from:
            match_q = match_q.filter(Match.match_date >= date_from)
        if date_to:
            match_q = match_q.filter(Match.match_date <= f"{date_to} 23:59:59")
        match_ids = [r[0] for r in match_q.all()]

        agg = (
            db.query(
                Bet.user_id.label("user_id"),
                func.coalesce(func.sum(Bet.points_earned), 0).label("total_points"),
                func.sum(case((Bet.points_earned.in_([3, 25]), 1), else_=0)).label("exact_scores"),
                func.sum(case((and_(Bet.points_earned > 0, Bet.points_earned.not_in([3, 25])), 1), else_=0)).label("correct_results"),
                func.count(Bet.id).label("total_bets"),
            )
            .filter(Bet.match_id.in_(match_ids))
            .group_by(Bet.user_id)
            .subquery()
        )
        rows = (
            db.query(
                User.id.label("user_id"),
                User.name.label("name"),
                func.coalesce(agg.c.total_points, 0).label("total_points"),
                func.coalesce(agg.c.exact_scores, 0).label("exact_scores"),
                func.coalesce(agg.c.correct_results, 0).label("correct_results"),
                func.coalesce(agg.c.total_bets, 0).label("total_bets"),
            )
            .join(agg, User.id == agg.c.user_id)
            .order_by(
                desc(func.coalesce(agg.c.total_points, 0)),
                desc(func.coalesce(agg.c.exact_scores, 0)),
                desc(func.coalesce(agg.c.total_bets, 0)),
                User.name.asc(),
            )
            .limit(limit)
            .all()
        )
    else:
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
            "total_points": r.total_points,
            "exact_scores": r.exact_scores,
            "correct_results": r.correct_results,
            "total_bets": r.total_bets,
        }
        for i, r in enumerate(rows)
    ]
