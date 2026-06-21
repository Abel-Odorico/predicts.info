"""
Knockout phase management: sync from Wikipedia, create/update matches.
"""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from auth_utils import require_admin
from database import get_db
from models import Match, MatchPhase, MatchStatus, Team, User
from world_cup_official import fetch_official_knockout_schedule, resolve_slot, candidate_thirds

router = APIRouter(prefix="/admin", tags=["knockout"])


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


PHASE_LABELS = {
    "r32":   "Round of 32",
    "r16":   "Oitavas de Final",
    "qf":    "Quartas de Final",
    "sf":    "Semifinal",
    "3rd":   "3º Lugar",
    "final": "Final",
}


def _build_group_table(db: Session) -> dict:
    """Build group standings dict for resolve_slot()."""
    teams = db.query(Team).filter(Team.group_name.isnot(None)).all()
    matches = (
        db.query(Match)
        .filter(Match.phase == MatchPhase.group)
        .all()
    )

    stats: dict[int, dict] = {}
    groups: dict[str, list] = defaultdict(list)

    for t in teams:
        s = {
            "id": t.id, "code": t.code, "name": t.name,
            "group_name": t.group_name,
            "elo": float(t.elo_rating),
            "points": 0, "gd": 0, "gf": 0, "played": 0,
        }
        stats[t.id] = s
        groups[t.group_name].append(s)

    for m in matches:
        r = m.result
        if not r:
            continue
        a, b = stats.get(m.team_a_id), stats.get(m.team_b_id)
        if not a or not b:
            continue
        a["played"] += 1; b["played"] += 1
        a["gf"] += r.score_a; a["gd"] += r.score_a - r.score_b
        b["gf"] += r.score_b; b["gd"] += r.score_b - r.score_a
        if r.score_a > r.score_b:
            a["points"] += 3
        elif r.score_b > r.score_a:
            b["points"] += 3
        else:
            a["points"] += 1; b["points"] += 1

    for rows in groups.values():
        rows.sort(key=lambda x: (-x["points"], -x["gd"], -x["gf"], -x["elo"]))

    thirds = [rows[2] for rows in groups.values() if len(rows) >= 3]
    thirds.sort(key=lambda x: (-x["points"], -x["gd"], -x["gf"], -x["elo"]))

    return {"groups": dict(groups), "thirds": thirds}


def _resolve_team(label: str, table: dict, db: Session) -> Optional[Team]:
    slot = resolve_slot(label, table)
    if not slot:
        thirds = candidate_thirds(label, table)
        slot = thirds[0] if thirds else None
    if not slot:
        return None
    return db.query(Team).filter(Team.id == slot["id"]).first()


@router.get("/knockout/matches")
def list_knockout_matches(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    phases = [p for p in MatchPhase if p != MatchPhase.group]
    matches = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
        .filter(Match.phase.in_(phases))
        .order_by(Match.match_number)
        .all()
    )
    return [_match_payload(m) for m in matches]


def _match_payload(m: Match) -> dict:
    phase_val = m.phase.value if hasattr(m.phase, "value") else str(m.phase)
    return {
        "id": m.id,
        "match_number": m.match_number,
        "phase": phase_val,
        "phase_label": PHASE_LABELS.get(phase_val, phase_val),
        "status": m.status.value if hasattr(m.status, "value") else str(m.status),
        "match_date": m.match_date,
        "venue": m.venue,
        "city": m.city,
        "team_a": {"id": m.team_a.id, "code": m.team_a.code, "name": m.team_a.name, "flag_url": m.team_a.flag_url} if m.team_a else None,
        "team_b": {"id": m.team_b.id, "code": m.team_b.code, "name": m.team_b.name, "flag_url": m.team_b.flag_url} if m.team_b else None,
        "result": {"score_a": m.result.score_a, "score_b": m.result.score_b} if m.result else None,
    }


@router.post("/knockout/sync")
def sync_knockout(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Fetch official Wikipedia knockout schedule and upsert matches."""
    try:
        schedule = fetch_official_knockout_schedule()
    except Exception as e:
        raise HTTPException(502, f"Falha ao buscar Wikipedia: {e}")

    table = _build_group_table(db)

    created = 0
    updated = 0
    pending = []  # matches where teams couldn't be resolved

    for entry in schedule:
        match_number = entry.get("match_number")
        phase_str = entry.get("phase", "r32")
        try:
            phase = MatchPhase(phase_str)
        except ValueError:
            phase = MatchPhase.r32

        team_a = _resolve_team(entry.get("team_a_label", ""), table, db)
        team_b = _resolve_team(entry.get("team_b_label", ""), table, db)

        # Try to find existing match by match_number OR by phase+teams
        existing = None
        if match_number:
            existing = db.query(Match).filter(Match.match_number == match_number).first()
        if not existing and team_a and team_b:
            existing = (
                db.query(Match)
                .filter(
                    Match.phase == phase,
                    Match.team_a_id == team_a.id,
                    Match.team_b_id == team_b.id,
                )
                .first()
            )

        if existing:
            # Update date/venue/teams if resolved
            if entry.get("match_date"):
                existing.match_date = entry["match_date"]
                existing.bet_deadline = entry["match_date"]
            if entry.get("venue"):
                existing.venue = entry["venue"]
            if entry.get("city"):
                existing.city = entry["city"]
            if team_a:
                existing.team_a_id = team_a.id
            if team_b:
                existing.team_b_id = team_b.id
            updated += 1
        else:
            if not team_a or not team_b:
                pending.append({
                    "section": entry.get("section"),
                    "phase": phase_str,
                    "team_a_label": entry.get("team_a_label"),
                    "team_b_label": entry.get("team_b_label"),
                })
                continue

            match = Match(
                phase=phase,
                team_a_id=team_a.id,
                team_b_id=team_b.id,
                match_date=entry.get("match_date"),
                bet_deadline=entry.get("match_date"),
                venue=entry.get("venue"),
                city=entry.get("city"),
                match_number=match_number,
                is_neutral=True,
                status=MatchStatus.scheduled,
            )
            db.add(match)
            created += 1

    db.commit()
    return {
        "created": created,
        "updated": updated,
        "pending": len(pending),
        "pending_matches": pending,
    }


class MatchCreate(BaseModel):
    phase: str
    team_a_id: int
    team_b_id: int
    match_date: Optional[datetime] = None
    venue: Optional[str] = None
    city: Optional[str] = None
    match_number: Optional[int] = None


class MatchUpdate(BaseModel):
    team_a_id: Optional[int] = None
    team_b_id: Optional[int] = None
    match_date: Optional[datetime] = None
    venue: Optional[str] = None
    city: Optional[str] = None
    status: Optional[str] = None
    match_number: Optional[int] = None


@router.post("/matches", status_code=201)
def create_match(
    payload: MatchCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    try:
        phase = MatchPhase(payload.phase)
    except ValueError:
        raise HTTPException(400, f"Fase inválida: {payload.phase}")

    team_a = db.query(Team).filter(Team.id == payload.team_a_id).first()
    team_b = db.query(Team).filter(Team.id == payload.team_b_id).first()
    if not team_a or not team_b:
        raise HTTPException(404, "Time não encontrado")

    match = Match(
        phase=phase,
        team_a_id=payload.team_a_id,
        team_b_id=payload.team_b_id,
        match_date=payload.match_date,
        bet_deadline=payload.match_date,
        venue=payload.venue,
        city=payload.city,
        match_number=payload.match_number,
        is_neutral=True,
        status=MatchStatus.scheduled,
    )
    db.add(match)
    db.commit()
    db.refresh(match)

    m = db.query(Match).options(joinedload(Match.team_a), joinedload(Match.team_b)).filter(Match.id == match.id).first()
    return _match_payload(m)


@router.patch("/matches/{match_id}")
def update_match(
    match_id: int,
    payload: MatchUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    match = db.query(Match).filter(Match.id == match_id).first()
    if not match:
        raise HTTPException(404, "Partida não encontrada")

    if payload.team_a_id is not None:
        if not db.query(Team).filter(Team.id == payload.team_a_id).first():
            raise HTTPException(404, "Time A não encontrado")
        match.team_a_id = payload.team_a_id
    if payload.team_b_id is not None:
        if not db.query(Team).filter(Team.id == payload.team_b_id).first():
            raise HTTPException(404, "Time B não encontrado")
        match.team_b_id = payload.team_b_id
    if payload.match_date is not None:
        match.match_date = payload.match_date
        match.bet_deadline = payload.match_date
    if payload.venue is not None:
        match.venue = payload.venue
    if payload.city is not None:
        match.city = payload.city
    if payload.match_number is not None:
        match.match_number = payload.match_number
    if payload.status is not None:
        try:
            match.status = MatchStatus(payload.status)
        except ValueError:
            raise HTTPException(400, f"Status inválido: {payload.status}")

    db.commit()
    m = db.query(Match).options(joinedload(Match.team_a), joinedload(Match.team_b)).filter(Match.id == match.id).first()
    return _match_payload(m)
