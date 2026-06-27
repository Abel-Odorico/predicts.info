"""
GET  /achievements                    — list all achievements with unlock status for current user
POST /admin/achievements/evaluate     — scan all users, grant earned achievements
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import get_db
from auth_utils import get_current_user, require_admin
from models import Bet, Match, MatchPhase, Ranking, User, UserGroup

router = APIRouter(tags=["achievements"])

ACHIEVEMENTS = {
    "first_bet":     {"icon": "🎯", "title": "Primeira Aposta",   "desc": "Apostou no primeiro jogo"},
    "exact_5":       {"icon": "🔮", "title": "Vidente",            "desc": "5 placares exatos"},
    "exact_10":      {"icon": "💎", "title": "Oráculo",            "desc": "10 placares exatos"},
    "streak_3":      {"icon": "🔗", "title": "Sequência",          "desc": "3 acertos seguidos"},
    "streak_5":      {"icon": "⚡", "title": "Maratonista",        "desc": "5 acertos seguidos"},
    "top1":          {"icon": "🏆", "title": "Campeão",            "desc": "Chegou ao 1° lugar no ranking"},
    "top3":          {"icon": "🥉", "title": "Pódio",              "desc": "Chegou ao top 3 no ranking"},
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


@router.post("/admin/achievements/evaluate")
def evaluate_achievements(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    users = db.query(User).all()
    granted_total = 0

    # Ranking positions
    rankings = db.query(Ranking).order_by(Ranking.total_points.desc()).all()
    rank_pos = {r.user_id: i + 1 for i, r in enumerate(rankings)}

    # Group stage match count
    group_match_count = db.query(Match).filter(Match.phase == MatchPhase.group).count()

    for user in users:
        existing = _get_unlocked(db, user.id)

        # first_bet
        bet_count = db.query(Bet).filter(Bet.user_id == user.id).count()
        if bet_count >= 1:
            _grant(db, user.id, "first_bet", existing)

        # exact scores from ranking
        ranking = db.query(Ranking).filter(Ranking.user_id == user.id).first()
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
        granted_total += len(new_unlocked) - len(existing)

    return {"evaluated": len(users), "granted": granted_total}
