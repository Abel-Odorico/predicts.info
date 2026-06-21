"""
Admin endpoints — require admin JWT.
POST /admin/results        insert real match result, recalculate Elo, evaluate bets
PATCH /admin/players/{id}  mark injury/suspension
POST /admin/recalculate    force tournament simulation refresh
GET  /admin/users          list users with admin metrics
PATCH /admin/users/{id}    update user role
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, text
import redis as redis_lib
import json

from database import get_db
from config import settings
from auth_utils import require_admin
from models import (
    Match, MatchResult, MatchStatus, Team, Player,
    Bet, Ranking, TournamentSimulation, User, UserRole, Notification, PageView
)
from schemas import ResultCreate, InjuryUpdate, AdminUserUpdate
from engine.elo import update_ratings
from routers.notifications import create_notification

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


def _notify_ranking_top3(db: Session) -> None:
    top3 = (
        db.query(Ranking)
        .order_by(Ranking.total_points.desc())
        .limit(3)
        .all()
    )
    medals = ["🥇", "🥈", "🥉"]
    for pos, ranking in enumerate(top3, start=1):
        medal = medals[pos - 1]
        # Only notify if user doesn't already have a top3 notification for this exact position today
        from datetime import date
        today_start = datetime.combine(date.today(), datetime.min.time())
        already = db.query(Notification).filter(
            Notification.user_id == ranking.user_id,
            Notification.type == "ranking_top3",
            Notification.meta["position"].astext == str(pos),
            Notification.created_at >= today_start,
        ).first()
        if not already:
            create_notification(
                db,
                ranking.user_id,
                "ranking_top3",
                f"{medal} Você está em {pos}º lugar!",
                f"Com {ranking.total_points} pontos no ranking geral.",
                {"position": pos, "points": ranking.total_points},
            )


def _evaluate_bets(match: Match, result: MatchResult, db: Session) -> None:
    team_a = match.team_a.name if match.team_a else "?"
    team_b = match.team_b.name if match.team_b else "?"
    match_label = f"{team_a} × {team_b}"

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

        # Notificação de resultado
        meta = {
            "match_id": match.id,
            "team_a": team_a,
            "team_b": team_b,
            "score": f"{result.score_a}–{result.score_b}",
            "bet": f"{bet.score_a}–{bet.score_b}",
            "points": bet.points_earned,
        }
        if exact:
            create_notification(db, bet.user_id, "bet_exact",
                f"🎯 Placar exato! +3 pts", f"{match_label} · {bet.score_a}–{bet.score_b}", meta)
        elif correct_result:
            create_notification(db, bet.user_id, "bet_correct",
                f"✅ Resultado certo! +1 pt", f"{match_label} · placar: {result.score_a}–{result.score_b}", meta)
        else:
            create_notification(db, bet.user_id, "bet_wrong",
                f"❌ Resultado errado", f"{match_label} · seu palpite: {bet.score_a}–{bet.score_b}", meta)


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
    _notify_ranking_top3(db)
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


# ── Growth / Stats ─────────────────────────────────────────────────────────

_PERIOD_CFG = {
    "day":      {"days": 1,   "trunc": "hour",  "fmt": "%H:00"},
    "week":     {"days": 7,   "trunc": "day",   "fmt": "%d/%m"},
    "month":    {"days": 30,  "trunc": "day",   "fmt": "%d/%m"},
    "quarter":  {"days": 90,  "trunc": "day",   "fmt": "%d/%m"},
    "semester": {"days": 180, "trunc": "week",  "fmt": "%d/%m"},
    "year":     {"days": 365, "trunc": "month", "fmt": "%m/%Y"},
}


@router.get("/stats/growth")
def stats_growth(
    period: str = Query(default="month"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if period not in _PERIOD_CFG:
        raise HTTPException(400, f"period must be one of {list(_PERIOD_CFG)}")

    cfg = _PERIOD_CFG[period]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=cfg["days"])
    trunc = cfg["trunc"]
    fmt = cfg["fmt"]

    # ── usuários por bucket ──────────────────────────
    user_rows = db.execute(text(f"""
        SELECT
            date_trunc('{trunc}', created_at) AS bucket,
            COUNT(*) AS new_users
        FROM users
        WHERE created_at >= :since
        GROUP BY bucket
        ORDER BY bucket
    """), {"since": since}).fetchall()

    # total de usuários ANTES do período (para acumulado)
    total_before = db.execute(text("""
        SELECT COUNT(*) FROM users WHERE created_at < :since
    """), {"since": since}).scalar() or 0

    cumulative = int(total_before)
    users_series = []
    for row in user_rows:
        cumulative += int(row.new_users)
        users_series.append({
            "label": row.bucket.strftime(fmt),
            "new": int(row.new_users),
            "cumulative": cumulative,
        })

    # ── apostas por bucket ───────────────────────────
    bet_rows = db.execute(text(f"""
        SELECT
            date_trunc('{trunc}', created_at) AS bucket,
            COUNT(*) AS total_bets,
            COUNT(DISTINCT user_id) AS unique_users
        FROM bets
        WHERE created_at >= :since
        GROUP BY bucket
        ORDER BY bucket
    """), {"since": since}).fetchall()

    bets_series = [
        {
            "label": row.bucket.strftime(fmt),
            "bets": int(row.total_bets),
            "unique_users": int(row.unique_users),
        }
        for row in bet_rows
    ]

    # ── summary cards ────────────────────────────────
    now_brt = now  # já naive UTC, suficiente para diffs

    def _count_users_since(delta_days):
        cutoff = now - timedelta(days=delta_days)
        return db.execute(text("SELECT COUNT(*) FROM users WHERE created_at >= :c"), {"c": cutoff}).scalar() or 0

    def _count_bets_since(delta_days):
        cutoff = now - timedelta(days=delta_days)
        return db.execute(text("SELECT COUNT(*) FROM bets WHERE created_at >= :c"), {"c": cutoff}).scalar() or 0

    total_users = db.execute(text("SELECT COUNT(*) FROM users")).scalar() or 0
    total_bets  = db.execute(text("SELECT COUNT(*) FROM bets")).scalar() or 0
    unique_bettors = db.execute(text("SELECT COUNT(DISTINCT user_id) FROM bets")).scalar() or 0
    avg_bets = round(total_bets / total_users, 1) if total_users else 0

    most_active = db.execute(text("""
        SELECT u.name, COUNT(b.id) as cnt
        FROM bets b JOIN users u ON u.id = b.user_id
        GROUP BY u.id, u.name ORDER BY cnt DESC LIMIT 1
    """)).fetchone()

    most_bet_match = db.execute(text("""
        SELECT ta.code || ' × ' || tb.code AS match_label, COUNT(b.id) as cnt
        FROM bets b
        JOIN matches m ON m.id = b.match_id
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        GROUP BY match_label ORDER BY cnt DESC LIMIT 1
    """)).fetchone()

    return {
        "period": period,
        "users_series": users_series,
        "bets_series": bets_series,
        "summary": {
            "total_users":        int(total_users),
            "new_today":          int(_count_users_since(1)),
            "new_week":           int(_count_users_since(7)),
            "new_month":          int(_count_users_since(30)),
            "total_bets":         int(total_bets),
            "bets_today":         int(_count_bets_since(1)),
            "unique_bettors":     int(unique_bettors),
            "avg_bets_per_user":  avg_bets,
            "most_active_user":   most_active.name if most_active else None,
            "most_active_bets":   int(most_active.cnt) if most_active else 0,
            "most_bet_match":     most_bet_match.match_label if most_bet_match else None,
            "most_bet_match_cnt": int(most_bet_match.cnt) if most_bet_match else 0,
        },
    }


# ── Engagement ─────────────────────────────────────────────────────────────

def _match_snapshot(match: Match, all_users: list, db: Session) -> dict:
    """Returns bettors + non_bettors for a match."""
    bets = (
        db.query(Bet)
        .filter(Bet.match_id == match.id)
        .options(joinedload(Bet.user))
        .all()
    )
    bettor_ids = {b.user_id for b in bets}
    label = (
        f"{match.team_a.name if match.team_a else '?'} × "
        f"{match.team_b.name if match.team_b else '?'}"
    )
    total_users = len(all_users)
    return {
        "match_id": match.id,
        "label": label,
        "group": match.group_name,
        "match_date": match.match_date.isoformat() if match.match_date else None,
        "status": match.status.value if match.status else None,
        "total_bets": len(bets),
        "total_users": total_users,
        "coverage_pct": round(len(bets) / total_users * 100, 1) if total_users else 0,
        "bettors": [
            {
                "id": b.user_id,
                "name": b.user.name if b.user else "?",
                "username": b.user.username if b.user else None,
                "email": b.user.email if b.user else None,
                "score_a": b.score_a,
                "score_b": b.score_b,
                "points": b.points_earned,
                "evaluated": b.evaluated_at is not None,
                "bet_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in sorted(bets, key=lambda x: x.created_at or datetime.min)
        ],
        "non_bettors": [
            {"id": u.id, "name": u.name, "username": u.username, "email": u.email}
            for u in all_users if u.id not in bettor_ids
        ],
    }


@router.get("/engagement")
def engagement(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    ago7  = now - timedelta(days=7)
    ago30 = now - timedelta(days=30)

    all_users = db.query(User).order_by(User.name.asc()).all()
    total_users = len(all_users)

    # ── Summary KPIs ──────────────────────────────────────────────
    bettors_today_ids = {
        r[0] for r in db.query(Bet.user_id).filter(Bet.created_at >= today).distinct()
    }
    bets_today = db.query(func.count(Bet.id)).filter(Bet.created_at >= today).scalar() or 0
    active_7d_ids = {
        r[0] for r in db.query(Bet.user_id).filter(Bet.created_at >= ago7).distinct()
    }
    active_30d_ids = {
        r[0] for r in db.query(Bet.user_id).filter(Bet.created_at >= ago30).distinct()
    }
    users_with_bets = {r[0] for r in db.query(Bet.user_id).distinct()}
    never_bet_ids = {u.id for u in all_users} - users_with_bets
    page_views_today = (
        db.query(func.count(PageView.id)).filter(PageView.created_at >= today).scalar() or 0
    )

    # ── Activity 7d (bets per day) ────────────────────────────────
    activity_rows = db.execute(text("""
        SELECT
            DATE(created_at) AS day,
            COUNT(*) AS bets,
            COUNT(DISTINCT user_id) AS unique_users
        FROM bets
        WHERE created_at >= :since
        GROUP BY day
        ORDER BY day
    """), {"since": ago7}).fetchall()
    activity_7d = [
        {"date": str(r.day), "bets": int(r.bets), "unique_users": int(r.unique_users)}
        for r in activity_rows
    ]

    # ── Top bettors (by bets count) ───────────────────────────────
    top_rows = db.execute(text("""
        SELECT
            u.id, u.name, u.username, u.email,
            COUNT(b.id) AS bets_count,
            COALESCE(SUM(b.points_earned), 0) AS points,
            MAX(b.created_at) AS last_bet_at
        FROM users u
        JOIN bets b ON b.user_id = u.id
        GROUP BY u.id, u.name, u.username, u.email
        ORDER BY bets_count DESC
        LIMIT 15
    """)).fetchall()
    top_bettors = [
        {
            "id": r.id, "name": r.name, "username": r.username, "email": r.email,
            "bets_count": int(r.bets_count), "points": int(r.points),
            "last_bet_at": r.last_bet_at.isoformat() if r.last_bet_at else None,
        }
        for r in top_rows
    ]

    # ── Inactive 7d (have bets but none in last 7 days) ──────────
    inactive_rows = db.execute(text("""
        SELECT
            u.id, u.name, u.username, u.email,
            COUNT(b.id) AS bets_count,
            MAX(b.created_at) AS last_bet_at
        FROM users u
        JOIN bets b ON b.user_id = u.id
        GROUP BY u.id, u.name, u.username, u.email
        HAVING MAX(b.created_at) < :ago7
        ORDER BY last_bet_at DESC
    """), {"ago7": ago7}).fetchall()
    inactive_7d = [
        {
            "id": r.id, "name": r.name, "username": r.username, "email": r.email,
            "bets_count": int(r.bets_count),
            "last_bet_at": r.last_bet_at.isoformat() if r.last_bet_at else None,
            "days_inactive": (now - r.last_bet_at).days if r.last_bet_at else None,
        }
        for r in inactive_rows
    ]

    # ── Never bet ─────────────────────────────────────────────────
    never_bet_users = [
        {"id": u.id, "name": u.name, "username": u.username, "email": u.email,
         "joined_at": u.created_at.isoformat() if u.created_at else None}
        for u in all_users if u.id in never_bet_ids
    ]

    # ── Bettors today ─────────────────────────────────────────────
    bettors_today_users = [
        {"id": u.id, "name": u.name, "username": u.username, "email": u.email}
        for u in all_users if u.id in bettors_today_ids
    ]

    # ── Last finished match ───────────────────────────────────────
    last_finished = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.status == MatchStatus.finished)
        .order_by(Match.match_date.desc().nullslast(), Match.id.desc())
        .first()
    )
    last_finished_data = _match_snapshot(last_finished, all_users, db) if last_finished else None

    # ── Next scheduled match ──────────────────────────────────────
    next_match = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.status == MatchStatus.scheduled)
        .order_by(Match.match_date.asc().nullslast(), Match.id.asc())
        .first()
    )
    next_match_data = _match_snapshot(next_match, all_users, db) if next_match else None

    return {
        "summary": {
            "total_users": total_users,
            "bettors_today": len(bettors_today_ids),
            "bets_today": int(bets_today),
            "active_7d": len(active_7d_ids),
            "active_30d": len(active_30d_ids),
            "never_bet": len(never_bet_ids),
            "page_views_today": int(page_views_today),
        },
        "bettors_today": bettors_today_users,
        "never_bet": never_bet_users,
        "last_finished_match": last_finished_data,
        "next_match": next_match_data,
        "activity_7d": activity_7d,
        "top_bettors": top_bettors,
        "inactive_7d": inactive_7d,
    }
