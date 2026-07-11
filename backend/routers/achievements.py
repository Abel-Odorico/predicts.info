"""
GET  /achievements                    — list all achievements with unlock status for current user
POST /admin/achievements/evaluate     — scan all users, grant earned achievements
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from database import get_db
from auth_utils import get_current_user, require_admin
from models import Bet, Match, MatchPhase, Notification, Ranking, User, UserGroup

router = APIRouter(tags=["achievements"])

ACHIEVEMENTS = {
    "first_bet":     {"icon": "🎯", "title": "Primeira Aposta",   "desc": "Apostou no primeiro jogo"},
    "exact_5":       {"icon": "🔮", "title": "Vidente",            "desc": "5 placares exatos"},
    "exact_10":      {"icon": "💎", "title": "Oráculo",            "desc": "10 placares exatos"},
    "streak_3":      {"icon": "🔗", "title": "Sequência",          "desc": "3 acertos seguidos"},
    "streak_5":      {"icon": "⚡", "title": "Maratonista",        "desc": "5 acertos seguidos"},
    "top1":          {"icon": "🏆", "title": "Campeão",            "desc": "Chegou ao 1° lugar no ranking"},
    "top3":          {"icon": "🥉", "title": "Pódio",              "desc": "Chegou ao top 3 no ranking"},
    "lider":         {"icon": "🥇", "title": "Líder",               "desc": "Chegou ao 1° lugar no ranking geral"},
    "vice_lider":    {"icon": "🥈", "title": "Vice-Líder",         "desc": "Chegou ao 2° lugar no ranking geral"},
    "terceiro_lugar":{"icon": "🥉", "title": "Terceiro Lugar",     "desc": "Chegou ao 3° lugar no ranking geral"},
    "destaque_rodada":{"icon": "🌟", "title": "Destaque da Rodada", "desc": "Foi quem mais pontuou na semana"},
    "bet_all":       {"icon": "💯", "title": "Completo",           "desc": "Apostou em todos os jogos da fase de grupos"},
    "group_creator": {"icon": "👑", "title": "Fundador",           "desc": "Criou um grupo privado"},
}


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _get_unlocked(db: Session, user_id: int) -> dict:
    rows = db.execute(
        text("SELECT code, unlocked_at FROM user_achievements WHERE user_id = :uid"),
        {"uid": user_id},
    ).fetchall()
    return {r[0]: r[1] for r in rows}


def _grant(db: Session, user_id: int, code: str, existing: dict):
    if code in existing:
        return
    db.execute(
        text("""
            INSERT INTO user_achievements (user_id, code, unlocked_at)
            VALUES (:uid, :code, :now)
            ON CONFLICT (user_id, code) DO NOTHING
        """),
        {"uid": user_id, "code": code, "now": _utcnow()},
    )


def _max_streak(bets_sorted: list) -> int:
    streak = max_s = 0
    for b in bets_sorted:
        if b.evaluated_at is not None:
            if b.points_earned and b.points_earned > 0:
                streak += 1
                max_s = max(max_s, streak)
            else:
                streak = 0
    return max_s


@router.get("/achievements")
def list_achievements(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    unlocked = _get_unlocked(db, user.id)
    result = []
    for code, meta in ACHIEVEMENTS.items():
        entry = {**meta, "code": code, "unlocked": code in unlocked}
        if code in unlocked:
            ts = unlocked[code]
            entry["unlocked_at"] = ts.isoformat() if ts else None
        result.append(entry)
    return result


def run_achievement_evaluation(db: Session) -> dict:
    """Núcleo reusável — chamado pela rota admin (manual) e pelo cron automático
    (main.py::_achievements_loop). Escaneia todos os usuários e concede o que já foi ganho."""
    users = db.query(User).all()
    granted_total = 0

    # Ranking positions
    from competitions import get_competition_id
    copa_id = get_competition_id(db)
    rankings = (
        db.query(Ranking)
        .filter(Ranking.competition_id == copa_id)
        .order_by(Ranking.total_points.desc())
        .all()
    )
    rank_pos = {r.user_id: i + 1 for i, r in enumerate(rankings)}

    # Group stage match count
    group_match_count = db.query(Match).filter(Match.phase == MatchPhase.group).count()

    # Destaque da rodada — quem mais pontuou nos últimos 7 dias (janela corrida, não
    # "rodada" numerada — Copa não tem rodada fixa por jogo). Empate: todos que baterem
    # o máximo levam a conquista (não escolhe só 1 arbitrariamente).
    week_ago = _utcnow() - timedelta(days=7)
    weekly_scores = (
        db.query(
            Bet.user_id,
            func.sum(func.coalesce(Bet.points_earned, 0) + func.coalesce(Bet.et_points_earned, 0)).label("pts"),
        )
        .filter(Bet.evaluated_at.isnot(None), Bet.evaluated_at >= week_ago)
        .group_by(Bet.user_id)
        .all()
    )
    weekly_top_user_ids: set[int] = set()
    if weekly_scores:
        max_pts = max(s.pts for s in weekly_scores)
        if max_pts > 0:
            weekly_top_user_ids = {s.user_id for s in weekly_scores if s.pts == max_pts}

    for user in users:
        existing = _get_unlocked(db, user.id)

        # first_bet
        bet_count = db.query(Bet).filter(Bet.user_id == user.id).count()
        if bet_count >= 1:
            _grant(db, user.id, "first_bet", existing)

        # exact scores from ranking
        ranking = db.query(Ranking).filter(
            Ranking.user_id == user.id, Ranking.competition_id == copa_id
        ).first()
        exacts = ranking.exact_scores if ranking else 0
        if exacts >= 5:  _grant(db, user.id, "exact_5",  existing)
        if exacts >= 10: _grant(db, user.id, "exact_10", existing)

        # streak
        evaluated_bets = (
            db.query(Bet)
            .join(Bet.match)
            .filter(Bet.user_id == user.id, Bet.evaluated_at.isnot(None))
            .order_by(Match.match_date.asc())
            .all()
        )
        streak = _max_streak(evaluated_bets)
        if streak >= 3: _grant(db, user.id, "streak_3", existing)
        if streak >= 5: _grant(db, user.id, "streak_5", existing)

        # ranking position
        pos = rank_pos.get(user.id, 999)
        if pos == 1: _grant(db, user.id, "top1", existing)
        if pos <= 3: _grant(db, user.id, "top3", existing)
        if pos == 1: _grant(db, user.id, "lider", existing)
        if pos == 2: _grant(db, user.id, "vice_lider", existing)
        if pos == 3: _grant(db, user.id, "terceiro_lugar", existing)

        # destaque_rodada — unlock único (permanente); não "perde" se outro superar depois
        if user.id in weekly_top_user_ids:
            _grant(db, user.id, "destaque_rodada", existing)

        # bet_all — bet on all group stage games
        if group_match_count > 0:
            group_bets = db.query(Bet).join(Bet.match).filter(
                Bet.user_id == user.id,
                Match.phase == MatchPhase.group,
            ).count()
            if group_bets >= group_match_count:
                _grant(db, user.id, "bet_all", existing)

        # group_creator
        owns = db.query(UserGroup).filter(UserGroup.owner_user_id == user.id).count()
        if owns >= 1:
            _grant(db, user.id, "group_creator", existing)

        db.commit()
        new_unlocked = _get_unlocked(db, user.id)
        for code in new_unlocked.keys() - existing.keys():
            meta = ACHIEVEMENTS[code]
            db.add(Notification(
                user_id=user.id, type="achievement_unlocked",
                title=f"{meta['icon']} Conquista desbloqueada: {meta['title']}",
                body=meta["desc"],
                meta={"code": code},
            ))
        granted_total += len(new_unlocked) - len(existing)
        db.commit()

    return {"evaluated": len(users), "granted": granted_total}


@router.post("/admin/achievements/evaluate")
def evaluate_achievements(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return run_achievement_evaluation(db)
