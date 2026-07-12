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
from engine.monte_carlo import simulate_tournament, simulate_final_four
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
    from competitions import get_competition_id
    for match in db.query(Match).filter(
        Match.phase == MatchPhase.group, Match.competition_id == get_competition_id(db)
    ).all():
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


def _final_four_teams(db: Session) -> list[dict] | None:
    """
    Detecta chaveamento reduzido às 2 semifinais reais (sem jogo de 'final'
    ainda criado) — nesse estágio só 4 seleções podem de fato ser campeãs.
    `simulate_tournament` reconstrói o chaveamento inteiro a partir da fase
    de grupos e não sabe quem já foi eliminado no mata-mata real (r32/r16/
    qf) — mostrava chance de título pra seleção já fora da Copa (achado
    2026-07-12). Retorna [team_a1, team_b1, team_a2, team_b2] (dicts no
    formato de `_build_teams`) se o estágio bater, senão None (mantém o
    comportamento antigo pra fases anteriores).
    """
    from competitions import get_competition_id
    comp_id = get_competition_id(db)
    sf_matches = (
        db.query(Match)
        .filter(Match.competition_id == comp_id, Match.phase == MatchPhase.sf)
        .all()
    )
    has_final = (
        db.query(Match)
        .filter(Match.competition_id == comp_id, Match.phase == MatchPhase.final)
        .first()
    )
    if len(sf_matches) != 2 or has_final:
        return None

    team_ids = []
    for m in sf_matches:
        team_ids.extend([m.team_a_id, m.team_b_id])
    if len(set(team_ids)) != 4:
        return None

    teams_by_id = {
        t.id: {
            "id": t.id, "code": t.code, "name": t.name,
            "elo_rating": float(t.elo_rating),
            "avg_goals_for": float(t.avg_goals_for),
            "avg_goals_against": float(t.avg_goals_against),
            "flag_url": t.flag_url or "",
        }
        for t in db.query(Team).filter(Team.id.in_(team_ids)).all()
    }
    ordered = []
    for m in sf_matches:
        ordered.append(teams_by_id[m.team_a_id])
        ordered.append(teams_by_id[m.team_b_id])
    return ordered


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

    # Reta final (só 2 semis reais restando, sem 'final' criada ainda):
    # zera o título de quem já foi eliminado de verdade e substitui a
    # probabilidade dos 4 que restam pelo cálculo exato do chaveamento real.
    final_four = _final_four_teams(db)
    if final_four:
        exact = simulate_final_four(final_four[0], final_four[1], final_four[2], final_four[3], n=n)
        for tid, r in results.items():
            if tid in exact:
                r["prob_final"] = exact[tid]["prob_final"]
                r["prob_title"] = exact[tid]["prob_title"]
            else:
                r["prob_final"] = 0.0
                r["prob_title"] = 0.0

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


@router.get("/phases")
def knockout_phases(db: Session = Depends(get_db)):
    """
    Consolidated view of all knockout matches with next-round info.
    R32: resolved from DB (has real team data).
    R16+: from official schedule, com fallback pro banco (join por match_date)
    quando a Wikipedia ainda não editou o rótulo do time.
    Each match includes `next_match_number` so the UI can draw the path.
    """
    from sqlalchemy.orm import joinedload
    import re

    table = compute_group_tables(db)
    db_by_date = {
        m.match_date: m
        for m in db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
            .filter(Match.phase != MatchPhase.group, Match.match_date.isnot(None))
            .all()
    }

    # ── Build next-match map from schedule labels ─────────────────────────────
    # e.g. "Winner Match 73" → extract 73 → that match feeds into this schedule entry
    schedule = fetch_official_knockout_schedule()
    for entry in schedule:
        slot_a = resolve_slot(entry["team_a_label"], table)
        slot_b = resolve_slot(entry["team_b_label"], table)
        db_match = db_by_date.get(entry.get("match_date"))
        if db_match:
            if not slot_a and db_match.team_a:
                slot_a = _team_min(db_match.team_a)
            if not slot_b and db_match.team_b:
                slot_b = _team_min(db_match.team_b)
        entry["resolved_team_a"] = slot_a
        entry["resolved_team_b"] = slot_b
        entry["status"] = db_match.status.value if db_match and hasattr(db_match.status, "value") else None
        entry["score_a"] = db_match.result.score_a if db_match and db_match.result else None
        entry["score_b"] = db_match.result.score_b if db_match and db_match.result else None
    # map: source_match_number → schedule_entry (the next match)
    feeds_into: dict[int, dict] = {}
    for entry in schedule:
        for label in [entry.get("team_a_label", ""), entry.get("team_b_label", "")]:
            m = re.search(r"Match (\d+)", label or "")
            if m:
                feeds_into[int(m.group(1))] = entry

    # ── R32 matches from DB ───────────────────────────────────────────────────
    def _team(t: Team | None) -> dict | None:
        if not t:
            return None
        return {"id": t.id, "code": t.code, "name": t.name, "flag_url": t.flag_url}

    r32_matches = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
        .filter(Match.phase == MatchPhase.r32)
        .order_by(Match.match_date, Match.match_number)
        .all()
    )

    r32 = []
    for m in r32_matches:
        next_entry = feeds_into.get(m.match_number)
        r32.append({
            "id": m.id,
            "match_number": m.match_number,
            "match_date": m.match_date.isoformat() if m.match_date else None,
            "venue": m.venue,
            "city": m.city,
            "status": m.status.value if hasattr(m.status, "value") else str(m.status),
            "team_a": _team(m.team_a),
            "team_b": _team(m.team_b),
            "score_a": m.result.score_a if m.result else None,
            "score_b": m.result.score_b if m.result else None,
            "half": "A" if m.match_number in HALF_A_R32 else ("B" if m.match_number in HALF_B_R32 else None),
            "next_match_number": next_entry["match_number"] if next_entry else None,
            "next_match_date": next_entry["match_date"] if next_entry else None,
            "next_venue": next_entry.get("venue") if next_entry else None,
            "next_city": next_entry.get("city") if next_entry else None,
            "next_phase": next_entry.get("phase") if next_entry else None,
        })

    # ── R16+ from schedule, enriched with feeds_into ─────────────────────────
    def _enrich_schedule(phase_key: str) -> list[dict]:
        out = []
        for entry in schedule:
            if entry["phase"] != phase_key:
                continue
            next_e = feeds_into.get(entry["match_number"])
            out.append({
                "match_number": entry["match_number"],
                "match_date": str(entry["match_date"]) if entry.get("match_date") else None,
                "venue": entry.get("venue"),
                "city": entry.get("city"),
                "phase": entry["phase"],
                "section": entry.get("section"),
                "team_a_label": entry.get("team_a_label"),
                "team_b_label": entry.get("team_b_label"),
                "resolved_team_a": entry.get("resolved_team_a"),
                "resolved_team_b": entry.get("resolved_team_b"),
                "status": entry.get("status"),
                "score_a": entry.get("score_a"),
                "score_b": entry.get("score_b"),
                "next_match_number": next_e["match_number"] if next_e else None,
                "next_match_date": str(next_e["match_date"]) if next_e and next_e.get("match_date") else None,
                "next_venue": next_e.get("venue") if next_e else None,
                "next_city": next_e.get("city") if next_e else None,
                "next_phase": next_e.get("phase") if next_e else None,
            })
        out.sort(key=lambda x: (x["match_date"] or "", x["match_number"] or 0))
        return out

    # Final (match 104 if exists, else derive from SF)
    sf_entries = _enrich_schedule("sf")
    final_label_a = None
    final_label_b = None
    if len(sf_entries) >= 2:
        final_label_a = f"Winner Match {sf_entries[0]['match_number']}"
        final_label_b = f"Winner Match {sf_entries[1]['match_number']}"

    final_entry = {
        "match_number": 104,
        "match_date": "2026-07-19T19:00:00",
        "venue": "MetLife Stadium",
        "city": "East Rutherford",
        "phase": "final",
        "section": "FINAL",
        "team_a_label": final_label_a or "Winner SF1",
        "team_b_label": final_label_b or "Winner SF2",
        "resolved_team_a": None,
        "resolved_team_b": None,
        "next_match_number": None,
        "next_match_date": None,
        "next_venue": None,
        "next_city": None,
        "next_phase": None,
    }
    # Wire SF into Final
    for e in sf_entries:
        e["next_match_number"] = 104
        e["next_match_date"] = final_entry["match_date"]
        e["next_venue"] = final_entry["venue"]
        e["next_city"] = final_entry["city"]
        e["next_phase"] = "final"

    return {
        "r32": r32,
        "r16": _enrich_schedule("r16"),
        "qf":  _enrich_schedule("qf"),
        "sf":  sf_entries,
        "final": [final_entry],
    }


def _team_min(t: Team | None) -> dict | None:
    if not t:
        return None
    return {"id": t.id, "code": t.code, "name": t.name, "group_name": t.group_name, "flag_url": t.flag_url}


@router.get("/official-bracket")
def official_bracket(db: Session = Depends(get_db)):
    table = compute_group_tables(db)

    # nosso banco (sincronizado por hora via football-data.org) resolve R16+
    # mais rápido e de forma mais confiável que o scraping da Wikipedia, que só
    # atualiza o rótulo de time quando um editor voluntário edita a página.
    # Join por match_date: o `match_number` da Wikipedia (1-104, numeração oficial
    # FIFA) não é o mesmo `match_number` gravado no banco (ID da API football-data),
    # mas o horário do jogo é o mesmo em ambas as fontes.
    from sqlalchemy.orm import joinedload
    db_by_date = {
        m.match_date: m
        for m in db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
            .filter(Match.phase != MatchPhase.group, Match.match_date.isnot(None))
            .all()
    }

    schedule = []
    for item in fetch_official_knockout_schedule():
        slot_a = resolve_slot(item["team_a_label"], table)
        slot_b = resolve_slot(item["team_b_label"], table)
        db_match = db_by_date.get(item.get("match_date"))
        if db_match:
            if not slot_a and db_match.team_a:
                slot_a = _team_min(db_match.team_a)
            if not slot_b and db_match.team_b:
                slot_b = _team_min(db_match.team_b)
        schedule.append(
            {
                **item,
                "resolved_team_a": slot_a,
                "resolved_team_b": slot_b,
                "candidate_thirds_a": candidate_thirds(item["team_a_label"], table),
                "candidate_thirds_b": candidate_thirds(item["team_b_label"], table),
                "status": db_match.status.value if db_match and hasattr(db_match.status, "value") else None,
                "score_a": db_match.result.score_a if db_match and db_match.result else None,
                "score_b": db_match.result.score_b if db_match and db_match.result else None,
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
