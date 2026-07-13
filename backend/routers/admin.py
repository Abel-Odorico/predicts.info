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
from sqlalchemy import func, text, or_
import redis as redis_lib
import json

from database import get_db
from config import settings
from auth_utils import require_admin
from models import (
    Match, MatchResult, MatchStatus, Team, Player,
    Bet, Ranking, TournamentSimulation, User, UserRole, Notification, PageView,
    UserGroup, UserGroupMember, UserGroupInvite, GroupInviteStatus, AuditLog,
    Competition, Poll, PollVote,
)
from schemas import ResultCreate, InjuryUpdate, AdminUserUpdate, AdminAccountEmail
from engine.elo import update_ratings
from routers.notifications import create_notification
from routers.audit import log_action
import whatsapp_client as wa
import os

router = APIRouter(prefix="/admin", tags=["admin"])

def _calc_points(match_date, bet_a: int, bet_b: int, res_a: int, res_b: int) -> tuple[int, bool, bool]:
    """V2 (Precisão) — applied to all matches regardless of date."""
    exact = bet_a == res_a and bet_b == res_b
    if exact:
        return 25, True, False
    bet_w = 'a' if bet_a > bet_b else ('b' if bet_b > bet_a else 'draw')
    res_w = 'a' if res_a > res_b else ('b' if res_b > res_a else 'draw')
    if bet_w != res_w:
        return 0, False, False
    if res_w == 'draw':
        return 10, False, True
    bwg = bet_a if bet_w == 'a' else bet_b
    rwg = res_a if res_w == 'a' else res_b
    blg = bet_b if bet_w == 'a' else bet_a
    rlg = res_b if res_w == 'a' else res_a
    if bwg == rwg:
        pts = 18
    elif abs(bet_a - bet_b) == abs(res_a - res_b):
        pts = 15
    elif blg == rlg:
        pts = 12
    else:
        pts = 10
    return pts, False, True


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
    from competitions import get_competition_id
    top3 = (
        db.query(Ranking)
        .filter(Ranking.competition_id == get_competition_id(db))
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
        points, exact, correct_result = _calc_points(
            match.match_date, bet.score_a, bet.score_b, result.score_a, result.score_b
        )
        bet.points_earned = points
        bet.evaluated_at = datetime.now(timezone.utc).replace(tzinfo=None)

        from competitions import get_competition_id
        ranking = db.query(Ranking).filter(
            Ranking.user_id == bet.user_id, Ranking.competition_id == get_competition_id(db)
        ).first()
        if not ranking:
            ranking = Ranking(user_id=bet.user_id, total_points=0, exact_scores=0, correct_results=0)
            db.add(ranking)
        ranking.total_points    = (ranking.total_points    or 0) + points
        ranking.exact_scores    = (ranking.exact_scores    or 0) + (1 if exact else 0)
        ranking.correct_results = (ranking.correct_results or 0) + (1 if correct_result else 0)

        meta = {
            "match_id": match.id,
            "team_a": team_a,
            "team_b": team_b,
            "score": f"{result.score_a}–{result.score_b}",
            "bet": f"{bet.score_a}–{bet.score_b}",
            "points": points,
        }
        if exact:
            create_notification(db, bet.user_id, "bet_exact",
                f"🎯 Placar exato! +{points} pts", f"{match_label} · {bet.score_a}–{bet.score_b}", meta)
        elif correct_result:
            create_notification(db, bet.user_id, "bet_correct",
                f"✅ Resultado certo! +{points} pts", f"{match_label} · placar: {result.score_a}–{result.score_b}", meta)
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


@router.post("/recalculate-bets-v2")
def recalculate_all_bets_v2(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Re-evaluate every evaluated bet using V2 scoring. Rebuilds Ranking from scratch. No new notifications."""
    # Reset all rankings
    from competitions import get_competition_id
    db.query(Ranking).filter(
        Ranking.competition_id == get_competition_id(db)
    ).update({"total_points": 0, "exact_scores": 0, "correct_results": 0}, synchronize_session=False)

    evaluated_bets = (
        db.query(Bet)
        .join(MatchResult, MatchResult.match_id == Bet.match_id)
        .join(Match, Match.id == Bet.match_id)
        .filter(Bet.evaluated_at.isnot(None))
        .all()
    )

    results_map = {r.match_id: r for r in db.query(MatchResult).all()}
    updated = 0

    for bet in evaluated_bets:
        result = results_map.get(bet.match_id)
        if not result:
            continue
        points, exact, correct_result = _calc_points(
            None, bet.score_a, bet.score_b, result.score_a, result.score_b
        )
        bet.points_earned = points

        from competitions import get_competition_id
        ranking = db.query(Ranking).filter(
            Ranking.user_id == bet.user_id, Ranking.competition_id == get_competition_id(db)
        ).first()
        if not ranking:
            ranking = Ranking(user_id=bet.user_id, total_points=0, exact_scores=0, correct_results=0)
            db.add(ranking)
        ranking.total_points    = (ranking.total_points    or 0) + points
        ranking.exact_scores    = (ranking.exact_scores    or 0) + (1 if exact else 0)
        ranking.correct_results = (ranking.correct_results or 0) + (1 if correct_result else 0)
        updated += 1

    db.commit()
    return {"status": "ok", "bets_recalculated": updated}


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
            "is_active": user.is_active,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "bets_count": int(bets_count or 0),
            "bets_points": int(bets_points or 0),
        }
        for user, bets_count, bets_points in rows
    ]


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    from routers.auth import (
        _normalize_username, _normalize_phone, _validate_username, _validate_phone,
        _username_exists, _phone_exists,
    )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if not user.is_active:
        raise HTTPException(400, "Usuário desativado — reative antes de editar")

    changes = {}

    if payload.role is not None:
        try:
            new_role = UserRole(payload.role)
        except ValueError:
            raise HTTPException(400, "Invalid role")
        if user.id == admin_user.id and new_role != UserRole.admin:
            raise HTTPException(400, "You cannot remove your own admin role")
        if new_role != user.role:
            changes["role"] = [user.role.value, new_role.value]
            user.role = new_role

    if payload.name is not None:
        name = payload.name.strip()
        if len(name) < 2:
            raise HTTPException(400, "Nome deve ter ao menos 2 caracteres")
        if name != user.name:
            changes["name"] = [user.name, name]
            user.name = name

    if payload.username is not None:
        username = _normalize_username(payload.username)
        if username:
            _validate_username(username)
            if _username_exists(db, username, exclude_user_id=user.id):
                raise HTTPException(409, "Usuário já está em uso")
        if username != user.username:
            changes["username"] = [user.username, username]
            user.username = username

    if payload.phone is not None:
        phone = _normalize_phone(payload.phone)
        _validate_phone(phone)
        if phone and _phone_exists(db, phone, exclude_user_id=user.id):
            raise HTTPException(409, "Telefone já cadastrado em outra conta")
        if phone != user.phone:
            changes["phone"] = [user.phone, phone]
            user.phone = phone

    if payload.email is not None:
        email = str(payload.email).strip().lower()
        if db.query(User).filter(func.lower(User.email) == email, User.id != user.id).first():
            raise HTTPException(409, "E-mail já cadastrado em outra conta")
        if email != user.email:
            changes["email"] = [user.email, email]
            user.email = email

    if changes:
        log_action(db, admin_user.id, "admin.edit_user", {"target_user_id": user.id, "changes": changes})
        db.commit()
        db.refresh(user)

    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "phone": user.phone,
        "name": user.name,
        "role": user.role.value,
        "is_active": user.is_active,
    }


@router.post("/users/{user_id}/deactivate")
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == admin_user.id:
        raise HTTPException(400, "Você não pode desativar a própria conta")
    if not user.is_active:
        raise HTTPException(400, "Usuário já está desativado")

    original = {"name": user.name, "email": user.email, "username": user.username, "phone": user.phone}

    user.is_active = False
    user.deactivated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    user.name = f"Usuário removido #{user.id}"
    user.email = f"deleted_{user.id}@predicts.local"
    user.username = None
    user.phone = None

    log_action(db, admin_user.id, "admin.deactivate_user", {"target_user_id": user.id, "was": original})
    db.commit()
    return {"status": "ok", "user_id": user.id, "is_active": False}


_ACCOUNT_ACTION_EXPIRE_MINUTES = 60
_ACCOUNT_ACTION_URLS = {
    "email": "https://predicts.info/alterar-email",
    "phone": "https://predicts.info/alterar-telefone",
}


def _send_password_reset_bg(name: str, email: str, token: str) -> None:
    from mail import send_email, reset_password_html
    url = f"https://predicts.info/redefinir-senha?token={token}"
    html, plain = reset_password_html(name, url, _ACCOUNT_ACTION_EXPIRE_MINUTES)
    send_email(email, "Redefinir sua senha — Predicts", html, plain)


def _send_account_action_bg(action: str, name: str, email: str, token: str) -> None:
    from mail import send_email, change_email_html, change_phone_html
    url = f"{_ACCOUNT_ACTION_URLS[action]}?token={token}"
    if action == "email":
        html, plain = change_email_html(name, url, _ACCOUNT_ACTION_EXPIRE_MINUTES)
        subject = "Atualizar seu e-mail — Predicts"
    else:
        html, plain = change_phone_html(name, url, _ACCOUNT_ACTION_EXPIRE_MINUTES)
        subject = "Atualizar seu telefone — Predicts"
    send_email(email, subject, html, plain)


@router.post("/users/{user_id}/send-account-email")
def send_account_email(
    user_id: int,
    payload: AdminAccountEmail,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    import secrets

    if payload.action not in ("password", "email", "phone"):
        raise HTTPException(400, "Ação inválida — use password, email ou phone")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    expires_at = now + timedelta(minutes=_ACCOUNT_ACTION_EXPIRE_MINUTES)

    if payload.action == "password":
        from models import PasswordResetToken
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        ).delete()
        token = secrets.token_urlsafe(48)
        db.add(PasswordResetToken(user_id=user.id, token=token, expires_at=expires_at))
        db.commit()
        background_tasks.add_task(_send_password_reset_bg, user.name, user.email, token)
    else:
        from models import AccountActionToken
        db.query(AccountActionToken).filter(
            AccountActionToken.user_id == user.id,
            AccountActionToken.action == payload.action,
            AccountActionToken.used_at.is_(None),
        ).delete()
        token = secrets.token_urlsafe(48)
        db.add(AccountActionToken(user_id=user.id, action=payload.action, token=token, expires_at=expires_at))
        db.commit()
        background_tasks.add_task(_send_account_action_bg, payload.action, user.name, user.email, token)

    log_action(db, admin_user.id, f"admin.send_account_email.{payload.action}", {"target_user_id": user_id})
    db.commit()
    return {"status": "ok", "message": f"E-mail de {payload.action} enviado para {user.email}"}


@router.get("/bets/all")
def all_bets(
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    user: str | None = Query(default=None, description="busca por nome, email ou id"),
    match_id: int | None = Query(default=None),
    status: str | None = Query(default=None, description="exact|correct|wrong|pending"),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (data do jogo)"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (data do jogo)"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = (
        db.query(Bet)
        .join(User, Bet.user_id == User.id)
        .join(Match, Bet.match_id == Match.id)
        .options(
            joinedload(Bet.user),
            joinedload(Bet.match).joinedload(Match.team_a),
            joinedload(Bet.match).joinedload(Match.team_b),
            joinedload(Bet.match).joinedload(Match.result),
        )
    )

    if user:
        term = user.strip()
        if term.isdigit():
            q = q.filter(Bet.user_id == int(term))
        else:
            like = f"%{term}%"
            q = q.filter(or_(User.name.ilike(like), User.email.ilike(like)))
    if match_id:
        q = q.filter(Bet.match_id == match_id)
    if date_from:
        q = q.filter(Match.match_date >= f"{date_from} 00:00:00")
    if date_to:
        q = q.filter(Match.match_date <= f"{date_to} 23:59:59")
    if status == "pending":
        q = q.filter(Bet.evaluated_at.is_(None))
    elif status == "evaluated":
        q = q.filter(Bet.evaluated_at.isnot(None))
    elif status == "exact":
        q = q.filter(Bet.points_earned == 25)
    elif status == "correct":
        q = q.filter(Bet.points_earned > 0, Bet.points_earned != 25)
    elif status == "wrong":
        q = q.filter(Bet.evaluated_at.isnot(None), Bet.points_earned == 0)

    total = q.count()
    bets = q.order_by(Match.match_date.desc(), Bet.created_at.desc()).offset(offset).limit(limit).all()

    items = []
    for b in bets:
        m = b.match
        res = m.result if m else None
        if b.evaluated_at is None:
            result = "pending"
        elif b.points_earned == 25:
            result = "exact"
        elif b.points_earned and b.points_earned > 0:
            result = "correct"
        else:
            result = "wrong"
        items.append({
            "id": b.id,
            "user_id": b.user_id,
            "user_name": b.user.name if b.user else None,
            "user_email": b.user.email if b.user else None,
            "match_id": b.match_id,
            "team_a": m.team_a.code if m and m.team_a else None,
            "team_b": m.team_b.code if m and m.team_b else None,
            "team_a_name": m.team_a.name if m and m.team_a else None,
            "team_b_name": m.team_b.name if m and m.team_b else None,
            "match_date": m.match_date if m else None,
            "match_status": m.status if m else None,
            "score_a": b.score_a,
            "score_b": b.score_b,
            "result_a": res.score_a if res else None,
            "result_b": res.score_b if res else None,
            "points_earned": b.points_earned or 0,
            "result": result,
            "created_at": b.created_at,
            "group": m.group_name if m else None,
        })
    return {"total": total, "limit": limit, "offset": offset, "bets": items}


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


_ENG_PERIODS = {
    "today": {"days": 0,  "trunc": "hour", "label": "Hoje"},
    "7d":    {"days": 7,  "trunc": "day",  "label": "7 dias"},
    "30d":   {"days": 30, "trunc": "day",  "label": "30 dias"},
    "all":   {"days": None, "trunc": "week", "label": "Todo período"},
}

_STREAK_SQL = """
WITH daily AS (
    SELECT DISTINCT user_id, DATE(created_at) AS bet_day
    FROM bets
),
numbered AS (
    SELECT user_id, bet_day,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY bet_day) AS rn
    FROM daily
),
grouped AS (
    SELECT user_id, bet_day,
           (bet_day - (rn || ' days')::interval)::date AS grp
    FROM numbered
),
streak_groups AS (
    SELECT user_id, grp,
           COUNT(*) AS streak_len,
           MIN(bet_day) AS streak_start,
           MAX(bet_day) AS streak_end
    FROM grouped
    GROUP BY user_id, grp
),
user_best AS (
    SELECT
        user_id,
        MAX(streak_len) AS max_streak,
        MAX(streak_end) AS last_active_day,
        COALESCE(
            MAX(CASE WHEN streak_end >= CURRENT_DATE - 1 THEN streak_len END),
            0
        ) AS current_streak
    FROM streak_groups
    GROUP BY user_id
)
SELECT u.id, u.name, u.username, u.email,
       ub.max_streak, ub.current_streak, ub.last_active_day
FROM user_best ub
JOIN users u ON u.id = ub.user_id
ORDER BY ub.current_streak DESC, ub.max_streak DESC, ub.last_active_day DESC
LIMIT 20
"""


@router.get("/engagement")
def engagement(
    period: str = Query(default="7d"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if period not in _ENG_PERIODS:
        raise HTTPException(400, f"period must be one of {list(_ENG_PERIODS)}")

    now   = datetime.now(timezone.utc).replace(tzinfo=None)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cfg   = _ENG_PERIODS[period]

    if cfg["days"] is None:
        since = None
    elif cfg["days"] == 0:
        since = today
    else:
        since = now - timedelta(days=cfg["days"])

    where_since = "AND b.created_at >= :since" if since else ""
    params: dict = {"since": since} if since else {}

    all_users   = db.query(User).order_by(User.name.asc()).all()
    total_users = len(all_users)

    # ── KPIs período ──────────────────────────────────────────────
    bettors_period_q = db.query(Bet.user_id).distinct()
    bets_period_q    = db.query(func.count(Bet.id))
    if since:
        bettors_period_q = bettors_period_q.filter(Bet.created_at >= since)
        bets_period_q    = bets_period_q.filter(Bet.created_at >= since)

    bettors_period_ids = {r[0] for r in bettors_period_q}
    bets_period        = int(bets_period_q.scalar() or 0)

    # fixos (sempre today)
    bettors_today_ids = {
        r[0] for r in db.query(Bet.user_id).filter(Bet.created_at >= today).distinct()
    }
    page_views_today = int(
        db.query(func.count(PageView.id)).filter(PageView.created_at >= today).scalar() or 0
    )

    users_with_bets = {r[0] for r in db.query(Bet.user_id).distinct()}
    never_bet_ids   = {u.id for u in all_users} - users_with_bets

    # ── Activity series ───────────────────────────────────────────
    trunc = cfg["trunc"]
    if trunc == "hour":
        bucket_sql = "date_trunc('hour', created_at)"
        fmt_key    = "hour"
    elif trunc == "week":
        bucket_sql = "date_trunc('week', created_at)::date"
        fmt_key    = "week"
    else:
        bucket_sql = "DATE(created_at)"
        fmt_key    = "day"

    where_act = "WHERE created_at >= :since" if since else ""
    act_rows  = db.execute(text(f"""
        SELECT {bucket_sql} AS bucket,
               COUNT(*) AS bets,
               COUNT(DISTINCT user_id) AS unique_users
        FROM bets
        {where_act}
        GROUP BY bucket
        ORDER BY bucket
    """), params).fetchall()

    activity_series = []
    for r in act_rows:
        b = r.bucket
        if fmt_key == "hour":
            label = b.strftime("%H:00") if hasattr(b, "strftime") else str(b)
        elif fmt_key == "week":
            label = b.strftime("%d/%m") if hasattr(b, "strftime") else str(b)
        else:
            label = b.strftime("%d/%m") if hasattr(b, "strftime") else str(b)
        activity_series.append({
            "label": label,
            "date": str(b),
            "bets": int(r.bets),
            "unique_users": int(r.unique_users),
        })

    # ── Streaks (all-time, independente do período) ───────────────
    streak_rows = db.execute(text(_STREAK_SQL)).fetchall()
    streaks = [
        {
            "id": r.id, "name": r.name, "username": r.username, "email": r.email,
            "current_streak": int(r.current_streak),
            "max_streak": int(r.max_streak),
            "last_active_day": str(r.last_active_day) if r.last_active_day else None,
        }
        for r in streak_rows
    ]

    # most_engaged: higher score = current_streak*3 + max_streak + period_bets
    most_engaged = None
    if streak_rows:
        # combine streak + period bets
        period_bets_by_user: dict[int, int] = {}
        pb_rows = db.execute(text(f"""
            SELECT user_id, COUNT(*) AS cnt
            FROM bets
            {where_act}
            GROUP BY user_id
        """), params).fetchall()
        for r in pb_rows:
            period_bets_by_user[r.user_id] = int(r.cnt)

        best = max(
            streak_rows,
            key=lambda r: int(r.current_streak) * 3 + int(r.max_streak)
                          + period_bets_by_user.get(r.id, 0),
        )
        most_engaged = {
            "id": best.id, "name": best.name, "username": best.username,
            "current_streak": int(best.current_streak),
            "max_streak": int(best.max_streak),
            "period_bets": period_bets_by_user.get(best.id, 0),
        }

    # ── Top bettors no período ────────────────────────────────────
    top_rows = db.execute(text(f"""
        SELECT
            u.id, u.name, u.username, u.email,
            COUNT(b.id) AS bets_count,
            COALESCE(SUM(b.points_earned), 0) AS points,
            MAX(b.created_at) AS last_bet_at
        FROM users u
        JOIN bets b ON b.user_id = u.id
        {where_since.replace('b.', 'b.')}
        GROUP BY u.id, u.name, u.username, u.email
        ORDER BY bets_count DESC
        LIMIT 15
    """), params).fetchall()
    top_bettors = [
        {
            "id": r.id, "name": r.name, "username": r.username, "email": r.email,
            "bets_count": int(r.bets_count), "points": int(r.points),
            "last_bet_at": r.last_bet_at.isoformat() if r.last_bet_at else None,
        }
        for r in top_rows
    ]

    # ── Inativos no período (têm bets mas nenhum no período) ──────
    if since:
        inactive_rows = db.execute(text("""
            SELECT
                u.id, u.name, u.username, u.email,
                COUNT(b.id) AS bets_count,
                MAX(b.created_at) AS last_bet_at
            FROM users u
            JOIN bets b ON b.user_id = u.id
            GROUP BY u.id, u.name, u.username, u.email
            HAVING MAX(b.created_at) < :since
            ORDER BY last_bet_at DESC
        """), {"since": since}).fetchall()
        inactive = [
            {
                "id": r.id, "name": r.name, "username": r.username, "email": r.email,
                "bets_count": int(r.bets_count),
                "last_bet_at": r.last_bet_at.isoformat() if r.last_bet_at else None,
                "days_inactive": (now - r.last_bet_at).days if r.last_bet_at else None,
            }
            for r in inactive_rows
        ]
    else:
        inactive = []

    # ── Segmentos de usuários ─────────────────────────────────────
    bettors_period_users = [
        {"id": u.id, "name": u.name, "username": u.username, "email": u.email}
        for u in all_users if u.id in bettors_period_ids
    ]
    never_bet_users = [
        {"id": u.id, "name": u.name, "username": u.username, "email": u.email,
         "joined_at": u.created_at.isoformat() if u.created_at else None}
        for u in all_users if u.id in never_bet_ids
    ]

    # ── Partidas ──────────────────────────────────────────────────
    last_finished = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.status == MatchStatus.finished)
        .order_by(Match.match_date.desc().nullslast(), Match.id.desc())
        .first()
    )
    next_match = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.status == MatchStatus.scheduled)
        .order_by(Match.match_date.asc().nullslast(), Match.id.asc())
        .first()
    )

    return {
        "period": period,
        "period_label": cfg["label"],
        "summary": {
            "total_users":    total_users,
            "bettors_period": len(bettors_period_ids),
            "bets_period":    bets_period,
            "bettors_today":  len(bettors_today_ids),
            "never_bet":      len(never_bet_ids),
            "page_views_today": page_views_today,
        },
        "most_engaged": most_engaged,
        "streaks": streaks,
        "bettors_period": bettors_period_users,
        "never_bet": never_bet_users,
        "last_finished_match": _match_snapshot(last_finished, all_users, db) if last_finished else None,
        "next_match":          _match_snapshot(next_match,    all_users, db) if next_match    else None,
        "activity_series": activity_series,
        "top_bettors": top_bettors,
        "inactive": inactive,
    }


@router.get("/groups")
def list_groups(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Visão geral de todos os bolões (grupos) e seus gestores. Somente leitura."""
    groups = (
        db.query(UserGroup)
        .options(joinedload(UserGroup.owner))
        .order_by(UserGroup.created_at.desc())
        .all()
    )

    member_counts = dict(
        db.query(UserGroupMember.group_id, func.count(UserGroupMember.id))
        .group_by(UserGroupMember.group_id)
        .all()
    )
    pending_counts = dict(
        db.query(UserGroupInvite.group_id, func.count(UserGroupInvite.id))
        .filter(UserGroupInvite.status == GroupInviteStatus.pending)
        .group_by(UserGroupInvite.group_id)
        .all()
    )
    # Atividade por grupo = palpites dos seus membros (proxy)
    bet_rows = (
        db.query(
            UserGroupMember.group_id,
            func.count(Bet.id),
            func.max(Bet.created_at),
        )
        .join(Bet, Bet.user_id == UserGroupMember.user_id)
        .group_by(UserGroupMember.group_id)
        .all()
    )
    bet_counts = {gid: int(c or 0) for gid, c, _ in bet_rows}
    last_bet = {gid: lb for gid, _, lb in bet_rows}

    total_grouped_users = db.query(func.count(func.distinct(UserGroupMember.user_id))).scalar() or 0

    groups_out = [
        {
            "id": g.id,
            "name": g.name,
            "created_at": g.created_at,
            "owner": (
                {"id": g.owner.id, "name": g.owner.name, "email": g.owner.email}
                if g.owner else None
            ),
            "members_count": int(member_counts.get(g.id, 0)),
            "pending_invites": int(pending_counts.get(g.id, 0)),
            "bets_count": bet_counts.get(g.id, 0),
            "last_bet_at": last_bet.get(g.id),
        }
        for g in groups
    ]

    # ── Destaques ──────────────────────────────────────
    def _brief(g):
        return {"id": g["id"], "name": g["name"], "value": None} if g else None

    biggest = max(groups_out, key=lambda g: g["members_count"], default=None)
    most_active = max(groups_out, key=lambda g: g["bets_count"], default=None)
    owner_counts = (
        db.query(User.id, User.name, func.count(UserGroup.id).label("n"))
        .join(UserGroup, UserGroup.owner_user_id == User.id)
        .group_by(User.id, User.name)
        .order_by(func.count(UserGroup.id).desc())
        .first()
    )

    # ── Saúde ──────────────────────────────────────────
    empty_count = sum(1 for g in groups_out if g["members_count"] <= 1)
    inactive_count = sum(1 for g in groups_out if g["bets_count"] == 0)
    avg_members = round(sum(g["members_count"] for g in groups_out) / len(groups_out), 1) if groups_out else 0

    # ── Convites ───────────────────────────────────────
    inv_rows = dict(
        db.query(UserGroupInvite.status, func.count(UserGroupInvite.id))
        .group_by(UserGroupInvite.status)
        .all()
    )
    inv_pending = int(inv_rows.get(GroupInviteStatus.pending, 0))
    inv_accepted = int(inv_rows.get(GroupInviteStatus.accepted, 0))
    inv_rejected = int(inv_rows.get(GroupInviteStatus.rejected, 0))
    inv_total = inv_pending + inv_accepted + inv_rejected
    acceptance_rate = round(inv_accepted / inv_total * 100, 1) if inv_total else 0

    # ── Crescimento (grupos criados por semana, últimas 12) ─
    growth_rows = (
        db.query(
            func.date_trunc("week", UserGroup.created_at).label("bucket"),
            func.count(UserGroup.id),
        )
        .group_by("bucket")
        .order_by("bucket")
        .all()
    )
    growth = [
        {"label": b.strftime("%d/%m") if b else "—", "count": int(c)}
        for b, c in growth_rows
    ][-12:]

    return {
        "total_groups": len(groups),
        "total_grouped_users": int(total_grouped_users),
        "highlights": {
            "biggest": {"id": biggest["id"], "name": biggest["name"], "members": biggest["members_count"]} if biggest else None,
            "most_active": {"id": most_active["id"], "name": most_active["name"], "bets": most_active["bets_count"]} if most_active else None,
            "top_owner": {"id": owner_counts[0], "name": owner_counts[1], "groups": int(owner_counts[2])} if owner_counts else None,
        },
        "health": {
            "empty_count": empty_count,
            "inactive_count": inactive_count,
            "avg_members": avg_members,
        },
        "invites": {
            "pending": inv_pending,
            "accepted": inv_accepted,
            "rejected": inv_rejected,
            "total": inv_total,
            "acceptance_rate": acceptance_rate,
        },
        "growth": growth,
        "groups": groups_out,
    }


@router.get("/groups/{group_id}/members")
def group_members_detail(
    group_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Membros de um grupo com pontos e nº de palpites — serve para expandir / ver ranking."""
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")

    members = (
        db.query(UserGroupMember)
        .options(
            joinedload(UserGroupMember.user),
            joinedload(UserGroupMember.champion_pick),
        )
        .filter(UserGroupMember.group_id == group_id)
        .all()
    )
    user_ids = [m.user_id for m in members]

    points = dict(
        db.query(Ranking.user_id, Ranking.total_points)
        .filter(Ranking.user_id.in_(user_ids))
        .all()
    ) if user_ids else {}
    bet_counts = dict(
        db.query(Bet.user_id, func.count(Bet.id))
        .filter(Bet.user_id.in_(user_ids))
        .group_by(Bet.user_id)
        .all()
    ) if user_ids else {}

    rows = [
        {
            "user_id": m.user_id,
            "name": m.user.name if m.user else None,
            "email": m.user.email if m.user else None,
            "is_owner": bool(m.is_owner),
            "joined_at": m.joined_at,
            "total_points": int(points.get(m.user_id, 0) or 0),
            "bets_count": int(bet_counts.get(m.user_id, 0) or 0),
            "champion_pick": m.champion_pick.name if m.champion_pick else None,
        }
        for m in members
    ]
    rows.sort(key=lambda r: r["total_points"], reverse=True)
    for i, r in enumerate(rows, start=1):
        r["position"] = i

    return {"group_id": group_id, "group_name": group.name, "members": rows}


@router.get("/security-summary")
def security_summary(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Resumo de eventos de segurança/comportamento a partir do audit log."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    d7 = now - timedelta(days=7)
    d30 = now - timedelta(days=30)

    def _count(actions: list[str], since=None) -> int:
        q = db.query(func.count(AuditLog.id)).filter(AuditLog.action.in_(actions))
        if since is not None:
            q = q.filter(AuditLog.created_at >= since)
        return int(q.scalar() or 0)

    pw_actions = ["profile.password_change", "password.reset"]
    recent = (
        db.query(AuditLog)
        .options(joinedload(AuditLog.user))
        .filter(AuditLog.action.in_(pw_actions))
        .order_by(AuditLog.created_at.desc())
        .limit(50)
        .all()
    )

    return {
        "password_changes": {
            "total": _count(pw_actions),
            "last_7d": _count(pw_actions, d7),
            "last_30d": _count(pw_actions, d30),
        },
        "logins": {"total": _count(["login"]), "last_7d": _count(["login"], d7)},
        "registrations": {"total": _count(["register"]), "last_7d": _count(["register"], d7)},
        "recent_password_changes": [
            {
                "user_id": r.user_id,
                "user_name": r.user.name if r.user else None,
                "user_email": r.user.email if r.user else None,
                "action": r.action,
                "ip": r.ip,
                "created_at": r.created_at,
            }
            for r in recent
        ],
    }


CRON_LOG_PATH = "/var/log/predicts-cron.log"

SCHEMA_TABLES = [
    ("teams", "Torneio"), ("matches", "Torneio"), ("match_results", "Torneio"), ("players", "Torneio"),
    ("bets", "Apostas & Ranking"), ("rankings", "Apostas & Ranking"), ("ranking_snapshots", "Apostas & Ranking"),
    ("tournament_simulations", "Apostas & Ranking"), ("simulations_cache", "Apostas & Ranking"),
    ("users", "Usuários"), ("push_subscriptions", "Usuários"), ("account_action_tokens", "Usuários"),
    ("user_groups", "Grupos"), ("user_group_members", "Grupos"), ("user_group_invites", "Grupos"), ("group_messages", "Grupos"),
    ("whatsapp_messages", "WhatsApp"), ("whatsapp_campaigns", "WhatsApp"), ("whatsapp_campaign_recipients", "WhatsApp"),
    ("whatsapp_bet_sessions", "WhatsApp"), ("whatsapp_group_posts", "WhatsApp"),
    ("match_analyses", "IA & Análise"), ("team_head_to_head", "IA & Análise"), ("match_projections", "IA & Análise"),
    ("bot_decision_logs", "IA & Análise"), ("analysis_logs", "IA & Análise"),
    ("competitions", "Competição & Votação"), ("phase_competitions", "Competição & Votação"),
    ("competition_waitlist", "Competição & Votação"), ("polls", "Competição & Votação"), ("poll_votes", "Competição & Votação"),
    ("app_versions", "Competição & Votação"), ("champion_picks", "Competição & Votação"),
    ("audit_logs", "Sistema"), ("page_views", "Sistema"), ("notifications", "Sistema"), ("match_comments", "Sistema"),
]


@router.get("/system/status")
def system_status(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    """Status ao vivo do sistema — banco, redis, competições, WhatsApp, cron, votação.
    Suporta a aba 'Sistema' do admin (visão de arquitetura/funcionamento)."""
    db_status = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"error: {e}"

    redis_status = "ok"
    try:
        _redis().ping()
    except Exception as e:
        redis_status = f"error: {e}"

    comps = db.query(Competition).order_by(Competition.id).all()
    comp_rows = []
    for c in comps:
        counts = db.execute(text("""
            SELECT
              (SELECT COUNT(*) FROM teams WHERE competition_id = :c)   AS teams,
              (SELECT COUNT(*) FROM matches WHERE competition_id = :c) AS matches,
              (SELECT COUNT(*) FROM matches m JOIN match_results r ON r.match_id = m.id
                WHERE m.competition_id = :c)                           AS results,
              (SELECT COUNT(*) FROM bets b JOIN matches m ON m.id = b.match_id
                WHERE m.competition_id = :c)                           AS bets,
              (SELECT COUNT(*) FROM rankings WHERE competition_id = :c) AS ranked_users
        """), {"c": c.id}).fetchone()
        comp_rows.append({
            "id": c.id, "code": c.code, "name": c.name, "kind": c.kind,
            "status": c.status, "is_default": c.is_default,
            "teams": counts.teams, "matches": counts.matches,
            "results": counts.results, "bets": counts.bets,
            "ranked_users": counts.ranked_users,
        })

    total_users = int(db.query(func.count(User.id)).scalar() or 0)
    active_users = int(db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0)  # noqa: E712
    wa_optin = int(db.query(func.count(User.id)).filter(User.whatsapp_opt_in == True).scalar() or 0)  # noqa: E712
    total_bets = int(db.query(func.count(Bet.id)).scalar() or 0)

    wa_cfg_row = db.execute(text("SELECT value FROM site_config WHERE key = 'whatsapp_enabled'")).fetchone()
    wa_enabled = (wa_cfg_row and wa_cfg_row.value == "true")
    wa_state = None
    if wa_enabled:
        try:
            st = wa.instance_status(db)
            wa_state = (st or {}).get("instance", {}).get("state") or (st or {}).get("state")
        except Exception:
            wa_state = "error"

    poll = db.query(Poll).filter(Poll.status == "active").order_by(Poll.id.desc()).first()
    poll_info = None
    if poll:
        votes = int(db.query(func.count(PollVote.id)).filter(PollVote.poll_id == poll.id).scalar() or 0)
        poll_info = {"id": poll.id, "title": poll.title, "status": poll.status, "votes": votes, "closes_at": poll.closes_at}

    cron_tail = []
    cron_updated_at = None
    try:
        stat = os.stat(CRON_LOG_PATH)
        cron_updated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        with open(CRON_LOG_PATH, "r", errors="ignore") as f:
            lines = f.readlines()
            cron_tail = [ln.rstrip("\n") for ln in lines[-15:]]
    except OSError:
        pass

    union_sql = " UNION ALL ".join(
        f"SELECT '{t}' AS tbl_name, COUNT(*) AS row_count FROM {t}" for t, _ in SCHEMA_TABLES
    )
    counts_by_table = {r[0]: r[1] for r in db.execute(text(union_sql)).fetchall()}
    tables = [
        {"table": t, "domain": domain, "rows": counts_by_table.get(t, 0)}
        for t, domain in SCHEMA_TABLES
    ]

    return {
        "db": db_status,
        "redis": redis_status,
        "competitions": comp_rows,
        "users": {"total": total_users, "active": active_users, "whatsapp_opt_in": wa_optin},
        "bets_total": total_bets,
        "whatsapp": {"enabled": wa_enabled, "state": wa_state},
        "poll": poll_info,
        "cron": {"log_updated_at": cron_updated_at, "tail": cron_tail},
        "tables": tables,
    }
