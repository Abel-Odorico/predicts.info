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
