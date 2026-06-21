"""
GET  /champion/pick         — palpite atual do usuário (auth)
POST /champion/pick         — registrar/atualizar palpite (auth, antes do deadline)
GET  /champion/picks/stats  — distribuição de palpites (público)
POST /admin/champion/award  — credita +100 campeão / +50 vice (admin)
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, DateTime, ForeignKey, func

from database import Base, get_db
from auth_utils import get_current_user, require_admin
from models import User, Team, Ranking

router = APIRouter(tags=["champion"])

DEADLINE = datetime(2026, 6, 26, 12, 0, 0)  # UTC — antes do 1º mata-mata
CHAMPION_BONUS  = 100
RUNNER_UP_BONUS = 50


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ChampionPick(Base):
    __tablename__ = "champion_picks"
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    team_id    = Column(Integer, ForeignKey("teams.id"), nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


def _can_change() -> bool:
    return _utcnow() < DEADLINE


def _team_dict(t: Team) -> dict:
    return {"team_id": t.id, "code": t.code, "name": t.name, "flag": t.flag_url}


@router.get("/champion/pick")
def get_pick(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pick = db.query(ChampionPick).filter(ChampionPick.user_id == user.id).first()
    if not pick:
        raise HTTPException(404, "Sem palpite")
    team = db.query(Team).filter(Team.id == pick.team_id).first()
    return {
        **_team_dict(team),
        "picked_at": pick.created_at,
        "can_change": _can_change(),
    }


@router.post("/champion/pick")
def set_pick(body: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not _can_change():
        raise HTTPException(403, "Prazo encerrado para palpite de campeão")
    team_id = body.get("team_id")
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(404, "Time não encontrado")
    pick = db.query(ChampionPick).filter(ChampionPick.user_id == user.id).first()
    if pick:
        pick.team_id   = team_id
        pick.updated_at = _utcnow()
    else:
        pick = ChampionPick(user_id=user.id, team_id=team_id)
        db.add(pick)
    db.commit()
    return {**_team_dict(team), "picked_at": pick.created_at, "can_change": True}


@router.get("/champion/picks/stats")
def picks_stats(db: Session = Depends(get_db)):
    rows = (
        db.query(Team, func.count(ChampionPick.id).label("cnt"))
        .join(ChampionPick, ChampionPick.team_id == Team.id, isouter=True)
        .group_by(Team.id)
        .having(func.count(ChampionPick.id) > 0)
        .order_by(func.count(ChampionPick.id).desc())
        .all()
    )
    total = sum(r.cnt for r in rows) or 1
    return [
        {**_team_dict(r.Team), "count": r.cnt, "pct": round(r.cnt * 100 / total, 1)}
        for r in rows
    ]


@router.post("/admin/champion/award")
def award_champion(body: dict, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    champion_id  = body.get("champion_team_id")
    runner_up_id = body.get("runner_up_team_id")
    if not champion_id or not runner_up_id:
        raise HTTPException(400, "champion_team_id e runner_up_team_id obrigatórios")

    champion_picks  = db.query(ChampionPick).filter(ChampionPick.team_id == champion_id).all()
    runner_up_picks = db.query(ChampionPick).filter(ChampionPick.team_id == runner_up_id).all()

    def _credit(picks, bonus):
        for p in picks:
            r = db.query(Ranking).filter(Ranking.user_id == p.user_id).first()
            if not r:
                r = Ranking(user_id=p.user_id, total_points=0, exact_scores=0, correct_results=0)
                db.add(r)
            r.total_points = (r.total_points or 0) + bonus
        db.commit()

    _credit(champion_picks,  CHAMPION_BONUS)
    _credit(runner_up_picks, RUNNER_UP_BONUS)

    return {
        "champion_bonus":  {"team_id": champion_id,  "users": len(champion_picks),  "pts_each": CHAMPION_BONUS},
        "runner_up_bonus": {"team_id": runner_up_id, "users": len(runner_up_picks), "pts_each": RUNNER_UP_BONUS},
    }
