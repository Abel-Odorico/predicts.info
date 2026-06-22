"""
GET /api/tournament/simulate — full Copa 2026 Monte Carlo simulation.
Results cached in Redis (invalidated when a real result is inserted).
"""

import json
import time
from collections import defaultdict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
import redis as redis_lib
from database import get_db
from config import settings
from models import Match, MatchPhase, Team, TournamentSimulation
from engine.monte_carlo import simulate_tournament
from world_cup_official import candidate_thirds, compute_group_tables, fetch_official_knockout_schedule, resolve_slot

router = APIRouter(prefix="/tournament", tags=["tournament"])

CACHE_KEY = "tournament:latest"
CACHE_TTL = 3600 * 12  # 12h — invalidated immediately on new result


def _redis():
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


def _build_teams(db: Session) -> tuple[list[dict], dict[str, list[int]], list[dict]]:
    teams_db = db.query(Team).filter(Team.group_name.isnot(None)).all()
    teams = []
    groups: dict[str, list[int]] = {}
    for t in teams_db:
        teams.append({
            "id": t.id,
            "code": t.code,
            "name": t.name,
            "elo_rating": float(t.elo_rating),
            "avg_goals_for": float(t.avg_goals_for),
            "avg_goals_against": float(t.avg_goals_against),
            "flag_url": t.flag_url or "",
            "confederation": t.confederation.value if hasattr(t.confederation, "value") else str(t.confederation),
        })
        g = t.group_name
        if g not in groups:
            groups[g] = []
        groups[g].append(t.id)

    # Ensure exactly 4 teams per group — skip incomplete groups
    groups = {g: ids for g, ids in groups.items() if len(ids) == 4}
    played_matches = []
    for match in db.query(Match).filter(Match.phase == MatchPhase.group).all():
        if not match.result or not match.group_name:
            continue
        played_matches.append(
            {
                "group_name": match.group_name,
                "team_a_id": match.team_a_id,
                "team_b_id": match.team_b_id,
                "score_a": match.result.score_a,
                "score_b": match.result.score_b,
            }
        )
    return teams, groups, played_matches


@router.get("/simulate")
def simulate(
    n: int = Query(default=100_000, ge=10_000, le=500_000),
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    cache_key = f"{CACHE_KEY}:{n}"
    # Try Redis cache
    if not force:
        try:
            r = _redis()
            cached = r.get(cache_key)
            if cached:
                data = json.loads(cached)
                data["cached"] = True
                return data
        except Exception:
            pass

    teams, groups, played_matches = _build_teams(db)

    start = time.time()
    results, top_finals_raw, top_sf_raw, team_by_id = simulate_tournament(
        teams, groups, played_matches=played_matches, n=n
    )
    elapsed = time.time() - start

    def _enrich_final(entry: dict) -> dict:
        ta = team_by_id.get(entry["team_a_id"], {})
        tb = team_by_id.get(entry["team_b_id"], {})
        return {
            "team_a": ta.get("code", "?"),
            "team_b": tb.get("code", "?"),
            "name_a": ta.get("name", ""),
            "name_b": tb.get("name", ""),
            "flag_a": ta.get("flag_url", ""),
            "flag_b": tb.get("flag_url", ""),
            "prob": entry["prob"],
            "prob_a_wins": entry["prob_a_wins"],
            "prob_b_wins": entry["prob_b_wins"],
        }

    def _enrich_sf(entry: dict) -> dict:
        teams_info = []
        for tid in entry["team_ids"]:
            t = team_by_id.get(tid, {})
            teams_info.append({
                "code": t.get("code", "?"),
                "name": t.get("name", ""),
                "flag_url": t.get("flag_url", ""),
            })
        return {"teams": teams_info, "prob": entry["prob"]}

    # Sort by title probability descending
    sorted_teams = sorted(results.values(), key=lambda x: -x["prob_title"])

    response = {
        "simulations": n,
        "elapsed_ms": round(elapsed * 1000),
        "computed_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "teams": sorted_teams,
        "top_finals": [_enrich_final(e) for e in top_finals_raw],
        "top_sf": [_enrich_sf(e) for e in top_sf_raw],
        "cached": False,
    }

    # Persist in DB
    last = db.query(TournamentSimulation).order_by(TournamentSimulation.computed_at.desc()).first()
    sim_record = TournamentSimulation(
        simulations_count=n,
        results={str(k): v for k, v in results.items()},
        round_number=(last.round_number + 1) if last else 0,
    )
    db.add(sim_record)
    db.commit()

    # Cache in Redis
    try:
        r = _redis()
        r.setex(cache_key, CACHE_TTL, json.dumps(response))
    except Exception:
        pass

    return response


@router.get("/history")
def history(limit: int = Query(default=5, le=20), db: Session = Depends(get_db)):
    sims = (
        db.query(TournamentSimulation)
        .order_by(TournamentSimulation.computed_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": s.id,
            "computed_at": s.computed_at,
            "simulations_count": s.simulations_count,
            "round_number": s.round_number,
        }
        for s in sims
    ]


@router.get("/bracket")
def bracket(db: Session = Depends(get_db)):
    table = compute_group_tables(db)
    knockout = defaultdict(list)
    for match in db.query(Match).filter(Match.phase != MatchPhase.group).order_by(Match.match_number).all():
        phase_key = match.phase.value if hasattr(match.phase, "value") else str(match.phase)
        knockout[phase_key].append(
            {
                "id": match.id,
                "match_number": match.match_number,
                "match_date": match.match_date,
                "venue": match.venue,
                "city": match.city,
                "status": match.status.value if hasattr(match.status, "value") else str(match.status),
                "team_a_id": match.team_a_id,
                "team_b_id": match.team_b_id,
            }
        )

    return {
        "groups": table["groups"],
        "qualified_picture": {
            "winners": table["winners"],
            "runners_up": table["runners_up"],
            "best_thirds": table["best_thirds"],
        },
        "knockout_matches": dict(knockout),
    }


HALF_A_R32 = {73, 74, 75, 77, 81, 82, 83, 84}
HALF_B_R32 = {76, 78, 79, 80, 85, 86, 87, 88}


@router.get("/bracket-sides")
def bracket_sides(db: Session = Depends(get_db)):
    """Returns which bracket half (A or B) each team belongs to."""
    from sqlalchemy.orm import joinedload
    half_a, half_b = [], []
    seen_a, seen_b = set(), set()

    def _add(team_dict, half):
        tid = team_dict.get("id")
        if not tid:
            return
        if half == "A" and tid not in seen_a:
            seen_a.add(tid)
            half_a.append(team_dict)
        elif half == "B" and tid not in seen_b:
            seen_b.add(tid)
            half_b.append(team_dict)

    r32_db = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.phase == MatchPhase.r32, Match.match_number.isnot(None))
        .all()
    )
    for m in r32_db:
        half = "A" if m.match_number in HALF_A_R32 else "B" if m.match_number in HALF_B_R32 else None
        if not half:
            continue
        for t in [m.team_a, m.team_b]:
            if t:
                _add({"id": t.id, "code": t.code, "name": t.name, "flag_url": t.flag_url}, half)

    if not r32_db:
        table = compute_group_tables(db)
        schedule = fetch_official_knockout_schedule()
        for item in schedule:
            if item.get("phase") != "r32":
                continue
            mn = item.get("match_number")
            half = "A" if mn in HALF_A_R32 else "B" if mn in HALF_B_R32 else None
            if not half:
                continue
            for label in [item.get("team_a_label", ""), item.get("team_b_label", "")]:
                slot = resolve_slot(label, table) if label else None
                if slot:
                    _add({"id": slot["id"], "code": slot["code"], "name": slot["name"], "flag_url": slot.get("flag_url")}, half)

    return {"half_a": half_a, "half_b": half_b}


@router.get("/official-bracket")
def official_bracket(db: Session = Depends(get_db)):
    table = compute_group_tables(db)
    schedule = []
    for item in fetch_official_knockout_schedule():
        slot_a = resolve_slot(item["team_a_label"], table)
        slot_b = resolve_slot(item["team_b_label"], table)
        schedule.append(
            {
                **item,
                "resolved_team_a": slot_a,
                "resolved_team_b": slot_b,
                "candidate_thirds_a": candidate_thirds(item["team_a_label"], table),
                "candidate_thirds_b": candidate_thirds(item["team_b_label"], table),
            }
        )

    return {
        "updated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "qualified_picture": {
            "winners": table["winners"],
            "runners_up": table["runners_up"],
            "best_thirds": table["best_thirds"],
        },
        "schedule": schedule,
    }
