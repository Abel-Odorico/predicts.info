from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_utils import get_current_user
from database import get_db
from models import PhaseCompetition, User

router = APIRouter(tags=["competition"])


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _payload(c: PhaseCompetition) -> dict:
    return {
        "id":          c.id,
        "name":        c.name,
        "description": c.description,
        "start_date":  c.start_date.isoformat() if c.start_date else None,
        "end_date":    c.end_date.isoformat() if c.end_date else None,
        "active":      c.active,
        "promo_text":  c.promo_text,
        "created_at":  c.created_at.isoformat() if c.created_at else None,
    }


# ── Public ────────────────────────────────────────────────────────────────────

@router.get("/competition/active")
def get_active_competition(db: Session = Depends(get_db)):
    comp = (
        db.query(PhaseCompetition)
        .filter(PhaseCompetition.active == True)
        .order_by(PhaseCompetition.id.desc())
        .first()
    )
    if not comp:
        return None
    return _payload(comp)


@router.get("/competition/list")
def list_competitions_public(db: Session = Depends(get_db)):
    rows = db.query(PhaseCompetition).order_by(PhaseCompetition.id.desc()).all()
    return [_payload(r) for r in rows]


# ── Admin ─────────────────────────────────────────────────────────────────────

class CompetitionIn(BaseModel):
    name:        str
    description: str | None = None
    start_date:  str          # ISO datetime or YYYY-MM-DD
    end_date:    str | None = None
    active:      bool = True
    promo_text:  str | None = None


def _parse_dt(s: str) -> datetime:
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise HTTPException(400, f"Data inválida: {s}")


@router.get("/admin/competitions")
def list_competitions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role.value != "admin":
        raise HTTPException(403, "Admin only")
    rows = db.query(PhaseCompetition).order_by(PhaseCompetition.id.desc()).all()
    return [_payload(r) for r in rows]


@router.post("/admin/competition", status_code=201)
def create_competition(
    body: CompetitionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role.value != "admin":
        raise HTTPException(403, "Admin only")
    comp = PhaseCompetition(
        name=body.name,
        description=body.description,
        start_date=_parse_dt(body.start_date),
        end_date=_parse_dt(body.end_date) if body.end_date else None,
        active=body.active,
        promo_text=body.promo_text,
    )
    db.add(comp)
    db.commit()
    db.refresh(comp)
    return _payload(comp)


@router.patch("/admin/competition/{comp_id}")
def update_competition(
    comp_id: int,
    body: CompetitionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role.value != "admin":
        raise HTTPException(403, "Admin only")
    comp = db.query(PhaseCompetition).filter(PhaseCompetition.id == comp_id).first()
    if not comp:
        raise HTTPException(404, "Competição não encontrada")
    comp.name        = body.name
    comp.description = body.description
    comp.start_date  = _parse_dt(body.start_date)
    comp.end_date    = _parse_dt(body.end_date) if body.end_date else None
    comp.active      = body.active
    comp.promo_text  = body.promo_text
    db.commit()
    db.refresh(comp)
    return _payload(comp)


@router.delete("/admin/competition/{comp_id}", status_code=204)
def delete_competition(
    comp_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role.value != "admin":
        raise HTTPException(403, "Admin only")
    comp = db.query(PhaseCompetition).filter(PhaseCompetition.id == comp_id).first()
    if not comp:
        raise HTTPException(404, "Competição não encontrada")
    db.delete(comp)
    db.commit()
