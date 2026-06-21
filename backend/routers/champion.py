"""
GET  /champion/pick         — palpite atual do usuário (auth)
POST /champion/pick         — registrar/atualizar palpite (auth, antes do deadline)
GET  /champion/picks/stats  — distribuição de palpites (público)
GET  /admin/champion/award  — status do award (admin)
POST /admin/champion/award  — credita +100 campeão / +50 vice (admin, idempotente)
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, DateTime, ForeignKey, func

from database import Base, get_db
from auth_utils import get_current_user, require_admin
from models import User, Team, Ranking, Notification

router = APIRouter(tags=["champion"])

DEADLINE = datetime(2026, 6, 26, 12, 0, 0)  # UTC — antes do 1º mata-mata
CHAMPION_BONUS  = 100
RUNNER_UP_BONUS = 50


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ChampionPick(Base):
    __tablename__ = "champion_picks"
    id                = Column(Integer, primary_key=True)
    user_id           = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    team_id           = Column(Integer, ForeignKey("teams.id"), nullable=False)
    runner_up_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    created_at        = Column(DateTime, default=_utcnow)
    updated_at        = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ChampionAward(Base):
    """Tracks a completed award run — prevents double-crediting."""
    __tablename__ = "champion_awards"
    id                = Column(Integer, primary_key=True)
    champion_team_id  = Column(Integer, ForeignKey("teams.id"), nullable=False)
    runner_up_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    awarded_by        = Column(Integer, ForeignKey("users.id"), nullable=True)
    champion_users    = Column(Integer, default=0)
    runner_up_users   = Column(Integer, default=0)
    awarded_at        = Column(DateTime, default=_utcnow)


def _can_change() -> bool:
    return _utcnow() < DEADLINE


def _team_dict(t: Team) -> dict:
    return {"team_id": t.id, "code": t.code, "name": t.name, "flag": t.flag_url}


def _pick_response(pick: "ChampionPick", db: Session) -> dict:
    champion  = db.query(Team).filter(Team.id == pick.team_id).first()
    runner_up = db.query(Team).filter(Team.id == pick.runner_up_team_id).first() if pick.runner_up_team_id else None
    return {
        "champion":  {**_team_dict(champion),  "team_id": champion.id}  if champion  else None,
        "runner_up": {**_team_dict(runner_up), "team_id": runner_up.id} if runner_up else None,
        "picked_at":  pick.created_at,
        "can_change": _can_change(),
    }


@router.get("/champion/pick")
def get_pick(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pick = db.query(ChampionPick).filter(ChampionPick.user_id == user.id).first()
    if not pick:
        raise HTTPException(404, "Sem palpite")
    return _pick_response(pick, db)


@router.post("/champion/pick")
def set_pick(body: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not _can_change():
        raise HTTPException(403, "Prazo encerrado para palpite de campeão")

    team_id           = body.get("team_id")
    runner_up_team_id = body.get("runner_up_team_id")

    if not team_id and not runner_up_team_id:
        raise HTTPException(400, "team_id ou runner_up_team_id obrigatório")

    pick = db.query(ChampionPick).filter(ChampionPick.user_id == user.id).first()

    if team_id is not None:
        team = db.query(Team).filter(Team.id == team_id).first()
        if not team:
            raise HTTPException(404, "Time não encontrado")
        if pick and pick.runner_up_team_id == team_id:
            raise HTTPException(400, "Campeão e vice-campeão não podem ser o mesmo time")
        if not pick:
            pick = ChampionPick(user_id=user.id, team_id=team_id)
            db.add(pick)
        else:
            pick.team_id = team_id

    if runner_up_team_id is not None:
        ru_team = db.query(Team).filter(Team.id == runner_up_team_id).first()
        if not ru_team:
            raise HTTPException(404, "Time não encontrado")
        if pick and pick.team_id == runner_up_team_id:
            raise HTTPException(400, "Campeão e vice-campeão não podem ser o mesmo time")
        if not pick:
            raise HTTPException(400, "Escolha o campeão antes do vice")
        pick.runner_up_team_id = runner_up_team_id

    pick.updated_at = _utcnow()
    db.commit()
    return _pick_response(pick, db)


@router.get("/champion/picks/stats")
def picks_stats(db: Session = Depends(get_db)):
    def _stats_for(col):
        rows = (
            db.query(Team, func.count(col).label("cnt"))
            .join(ChampionPick, col == Team.id, isouter=True)
            .group_by(Team.id)
            .having(func.count(col) > 0)
            .order_by(func.count(col).desc())
            .all()
        )
        total = sum(r.cnt for r in rows) or 1
        return [{**_team_dict(r.Team), "count": r.cnt, "pct": round(r.cnt * 100 / total, 1)} for r in rows]

    return {
        "champion":  _stats_for(ChampionPick.team_id),
        "runner_up": _stats_for(ChampionPick.runner_up_team_id),
    }


@router.get("/admin/champion/award")
def award_status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    award = db.query(ChampionAward).order_by(ChampionAward.id.desc()).first()
    if not award:
        return {"awarded": False}
    champion  = db.query(Team).filter(Team.id == award.champion_team_id).first()
    runner_up = db.query(Team).filter(Team.id == award.runner_up_team_id).first()
    return {
        "awarded": True,
        "champion":  _team_dict(champion)  if champion  else None,
        "runner_up": _team_dict(runner_up) if runner_up else None,
        "champion_users":  award.champion_users,
        "runner_up_users": award.runner_up_users,
        "awarded_at": award.awarded_at,
    }


@router.post("/admin/champion/award")
def award_champion(
    body: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    champion_id  = body.get("champion_team_id")
    runner_up_id = body.get("runner_up_team_id")
    if not champion_id or not runner_up_id:
        raise HTTPException(400, "champion_team_id e runner_up_team_id obrigatórios")

    # Idempotency: block if already awarded
    existing = db.query(ChampionAward).first()
    if existing:
        raise HTTPException(409, "Bônus já creditado. Use /admin/champion/award (GET) para ver o status.")

    champion  = db.query(Team).filter(Team.id == champion_id).first()
    runner_up = db.query(Team).filter(Team.id == runner_up_id).first()
    if not champion or not runner_up:
        raise HTTPException(404, "Time não encontrado")

    champion_picks  = db.query(ChampionPick).filter(ChampionPick.team_id == champion_id).all()
    runner_up_picks = db.query(ChampionPick).filter(ChampionPick.runner_up_team_id == runner_up_id).all()

    def _credit(picks, bonus, notif_title, notif_body):
        for p in picks:
            r = db.query(Ranking).filter(Ranking.user_id == p.user_id).first()
            if not r:
                r = Ranking(user_id=p.user_id, total_points=0, exact_scores=0, correct_results=0)
                db.add(r)
            r.total_points = (r.total_points or 0) + bonus
            db.add(Notification(
                user_id=p.user_id,
                type="champion_bonus",
                title=notif_title,
                body=notif_body,
                meta={"team_id": p.team_id, "bonus": bonus},
            ))

    _credit(
        champion_picks, CHAMPION_BONUS,
        f"🏆 +{CHAMPION_BONUS} pts! {champion.name} é campeão!",
        f"Seu palpite de campeão estava certo. Parabéns!",
    )
    _credit(
        runner_up_picks, RUNNER_UP_BONUS,
        f"🥈 +{RUNNER_UP_BONUS} pts! {runner_up.name} é vice-campeão!",
        f"Seu palpite de vice-campeão estava certo. Bom trabalho!",
    )

    award = ChampionAward(
        champion_team_id=champion_id,
        runner_up_team_id=runner_up_id,
        awarded_by=admin.id,
        champion_users=len(champion_picks),
        runner_up_users=len(runner_up_picks),
    )
    db.add(award)
    db.commit()

    return {
        "champion_bonus":  {"team_id": champion_id,  "name": champion.name,  "users": len(champion_picks),  "pts_each": CHAMPION_BONUS},
        "runner_up_bonus": {"team_id": runner_up_id, "name": runner_up.name, "users": len(runner_up_picks), "pts_each": RUNNER_UP_BONUS},
        "awarded_at": award.awarded_at,
    }
