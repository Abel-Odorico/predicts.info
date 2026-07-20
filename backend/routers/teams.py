from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import asc
from database import get_db
from models import Player, Team
from schemas import PlayerResponse, TeamResponse, TeamUpdate

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamResponse])
def list_teams(
    confederation: str | None = Query(None),
    group_name: str | None = Query(None),
    limit: int = Query(48, le=48),
    db: Session = Depends(get_db),
):
    from competitions import get_competition_id
    q = db.query(Team).filter(Team.competition_id == get_competition_id(db))
    if confederation:
        q = q.filter(Team.confederation == confederation.upper())
    if group_name:
        q = q.filter(Team.group_name == group_name.upper())
    return q.order_by(asc(Team.group_name), Team.elo_rating.desc()).limit(limit).all()


@router.get("/ranking", response_model=list[TeamResponse])
def teams_by_elo(limit: int = Query(48, le=48), db: Session = Depends(get_db)):
    from competitions import get_competition_id
    return (
        db.query(Team)
        .filter(Team.competition_id == get_competition_id(db))
        .order_by(Team.elo_rating.desc())
        .limit(limit)
        .all()
    )


@router.get("/favorites/options")
def list_favorite_options(db: Session = Depends(get_db)):
    """Lista pública combinada (Copa + Brasileirão) pro picker de 'time do coração'
    do usuário (Profile.jsx) — mesmo conceito do favorite_team_code do Bot Squad,
    só que pra gente de verdade. Rota estática ANTES de /{code} (senão o FastAPI
    tentaria casar 'favorites' como código de time)."""
    from competitions import get_competition_id
    copa_id = get_competition_id(db, "copa2026")
    br_id = get_competition_id(db, "brasileirao2026")

    def _opts(comp_id, label):
        if comp_id is None:
            return []
        rows = (
            db.query(Team)
            .filter(Team.competition_id == comp_id)
            .order_by(Team.name.asc())
            .all()
        )
        return [
            {"code": t.code, "name": t.name, "flag_url": t.flag_url, "competition": label}
            for t in rows
        ]

    return {
        "copa2026": _opts(copa_id, "Copa do Mundo"),
        "brasileirao2026": _opts(br_id, "Brasileirão"),
    }


@router.get("/{code}", response_model=TeamResponse)
def get_team(code: str, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.code == code.upper()).first()
    if not team:
        raise HTTPException(404, f"Team '{code}' not found")
    return team


@router.get("/{code}/players", response_model=list[PlayerResponse])
def get_team_players(code: str, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.code == code.upper()).first()
    if not team:
        raise HTTPException(404, f"Team '{code}' not found")
    return (
        db.query(Player)
        .filter(Player.team_id == team.id)
        .order_by(Player.position.asc().nullslast(), Player.name.asc())
        .all()
    )


@router.patch("/{code}", response_model=TeamResponse)
def update_team(code: str, payload: TeamUpdate, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.code == code.upper()).first()
    if not team:
        raise HTTPException(404, f"Team '{code}' not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(team, field, value)
    db.commit()
    db.refresh(team)
    return team
