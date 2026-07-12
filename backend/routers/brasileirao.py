"""
Fase 3 Brasileirão — produto pontos corridos (público).

  GET /brasileirao/standings   — tabela real (pts, J, V, E, D, GP, GC, SG)
  GET /brasileirao/projection  — Monte Carlo da temporada: % título / G4 / Z4,
                                 pontos e posição esperados (cache Redis 3h)
  GET /brasileirao/rodada      — jogos de uma rodada (?n=; default rodada atual)

Aposta usa o fluxo existente (POST /bets) — jogo BR tem bet_deadline = kickoff
e o Bet é carimbado com competition_id do Brasileirão (Fase 1). Pontuação das
bets BR roda no sync (brasileirao_sync.evaluate_bets), mesma régua V2 da Copa.

Critério de desempate (CBF): pontos > vitórias > saldo > gols pró.
Monte Carlo usa o engine da Copa (compute_weighted_lambdas com is_neutral=False
— mando de campo entra via Elo) sobre os jogos restantes; partidas já
finalizadas entram como estão na tabela.
"""

from __future__ import annotations

import json

import numpy as np
import redis as redis_lib
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from config import settings
from database import get_db
from models import Match, MatchStatus, Team
from routers.brasileirao_sync import COMP_CODE
from competitions import get_competition_id
from fastapi import HTTPException

router = APIRouter(prefix="/brasileirao", tags=["brasileirao"])

PROJECTION_CACHE_KEY = "br:projection:v1"
PROJECTION_TTL = 3 * 3600
N_SIMS = 4000


def _redis():
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


def _comp_id(db: Session) -> int | None:
    return get_competition_id(db, COMP_CODE)


def _load_matches(db: Session, comp_id: int) -> list[Match]:
    return (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
        .filter(Match.competition_id == comp_id)
        .order_by(Match.match_number, Match.match_date)
        .all()
    )


def _build_table(clubs: list[Team], matches: list[Match]) -> dict[int, dict]:
    table = {
        c.id: {"pts": 0, "j": 0, "v": 0, "e": 0, "d": 0, "gp": 0, "gc": 0}
        for c in clubs
    }
    for m in matches:
        if not m.result or m.team_a_id not in table or m.team_b_id not in table:
            continue
        sa, sb = m.result.score_a, m.result.score_b
        h, a = table[m.team_a_id], table[m.team_b_id]
        h["j"] += 1; a["j"] += 1
        h["gp"] += sa; h["gc"] += sb
        a["gp"] += sb; a["gc"] += sa
        if sa > sb:
            h["v"] += 1; h["pts"] += 3; a["d"] += 1
        elif sb > sa:
            a["v"] += 1; a["pts"] += 3; h["d"] += 1
        else:
            h["e"] += 1; a["e"] += 1; h["pts"] += 1; a["pts"] += 1
    return table


def _sort_key(row: dict) -> tuple:
    return (-row["pts"], -row["v"], -(row["gp"] - row["gc"]), -row["gp"], row["name"])


@router.get("/standings")
def standings(db: Session = Depends(get_db)):
    comp_id = _comp_id(db)
    if not comp_id:
        return {"table": [], "current_rodada": None}
    clubs = db.query(Team).filter(Team.competition_id == comp_id).all()
    matches = _load_matches(db, comp_id)
    table = _build_table(clubs, matches)

    club_by_id = {c.id: c for c in clubs}
    rows = []
    for cid, r in table.items():
        c = club_by_id[cid]
        rows.append({
            "team_id": cid, "code": c.code, "name": c.name, "flag_url": c.flag_url,
            "pts": r["pts"], "j": r["j"], "v": r["v"], "e": r["e"], "d": r["d"],
            "gp": r["gp"], "gc": r["gc"], "sg": r["gp"] - r["gc"],
        })
    rows.sort(key=_sort_key)
    for i, r in enumerate(rows, start=1):
        r["pos"] = i

    return {"table": rows, "current_rodada": _current_rodada(matches)}


def _current_rodada(matches: list[Match]) -> int | None:
    """Rodada do próximo jogo pendente POR DATA (não pelo menor número — jogo
    adiado de rodada antiga sem resultado travaria a 'atual' no passado)."""
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=6)
    upcoming = [
        m for m in matches
        if m.match_number and not m.result and m.match_date and m.match_date >= now
    ]
    if upcoming:
        return min(upcoming, key=lambda m: m.match_date).match_number
    pending = [m.match_number for m in matches if m.match_number and not m.result]
    return min(pending) if pending else (max((m.match_number or 0) for m in matches) if matches else None)


@router.get("/rodada")
def rodada(n: int | None = Query(None, ge=1, le=38), db: Session = Depends(get_db)):
    comp_id = _comp_id(db)
    if not comp_id:
        return {"rodada": None, "matches": []}
    matches = _load_matches(db, comp_id)
    cur = _current_rodada(matches)
    n = n or cur
    sel = [m for m in matches if m.match_number == n]
    sel.sort(key=lambda m: (m.match_date or 0, m.id))
    return {
        "rodada": n,
        "current_rodada": cur,
        "total_rodadas": 38,
        "matches": [{
            "id": m.id,
            "team_a": {"id": m.team_a.id, "code": m.team_a.code, "name": m.team_a.name, "flag_url": m.team_a.flag_url},
            "team_b": {"id": m.team_b.id, "code": m.team_b.code, "name": m.team_b.name, "flag_url": m.team_b.flag_url},
            "match_date": m.match_date.isoformat() if m.match_date else None,
            "status": m.status.value if hasattr(m.status, "value") else str(m.status),
            "result": {"score_a": m.result.score_a, "score_b": m.result.score_b} if m.result else None,
        } for m in sel],
    }


# ── Projeção Monte Carlo da temporada ─────────────────────────────────────────

def compute_projection(db: Session, n_sims: int = N_SIMS) -> dict:
    from routers.matches import _team_to_input
    from engine.weights import compute_weighted_lambdas

    comp_id = _comp_id(db)
    if not comp_id:
        return {"clubs": [], "n_sims": 0}

    clubs = db.query(Team).filter(Team.competition_id == comp_id).all()
    matches = _load_matches(db, comp_id)
    base = _build_table(clubs, matches)

    idx = {c.id: i for i, c in enumerate(clubs)}
    nc = len(clubs)
    rng = np.random.default_rng()

    pts = np.zeros((n_sims, nc), dtype=np.int32)
    wins = np.zeros((n_sims, nc), dtype=np.int32)
    gp = np.zeros((n_sims, nc), dtype=np.int32)
    gc = np.zeros((n_sims, nc), dtype=np.int32)
    for c in clubs:
        i = idx[c.id]
        b = base[c.id]
        pts[:, i] = b["pts"]; wins[:, i] = b["v"]; gp[:, i] = b["gp"]; gc[:, i] = b["gc"]

    inputs = {c.id: _team_to_input(c) for c in clubs}
    remaining = [m for m in matches if not m.result and m.team_a_id in idx and m.team_b_id in idx]

    for m in remaining:
        la, lb, _ = compute_weighted_lambdas(
            inputs[m.team_a_id], inputs[m.team_b_id], is_neutral=False, phase="group",
        )
        ga = rng.poisson(la, n_sims)
        gb = rng.poisson(lb, n_sims)
        ia, ib = idx[m.team_a_id], idx[m.team_b_id]
        home_win = ga > gb
        away_win = gb > ga
        draw = ~home_win & ~away_win
        pts[:, ia] += home_win * 3 + draw
        pts[:, ib] += away_win * 3 + draw
        wins[:, ia] += home_win
        wins[:, ib] += away_win
        gp[:, ia] += ga; gc[:, ia] += gb
        gp[:, ib] += gb; gc[:, ib] += ga

    # Composite de desempate CBF: pts > vitórias > saldo > gols pró.
    sg = gp - gc
    composite = (
        pts.astype(np.int64) * 10**9
        + wins.astype(np.int64) * 10**6
        + (sg.astype(np.int64) + 1000) * 10**3
        + gp.astype(np.int64)
    )
    # posição 1 = maior composite
    order = np.argsort(-composite, axis=1)
    pos = np.empty_like(order)
    rows_idx = np.arange(n_sims)[:, None]
    pos[rows_idx, order] = np.arange(1, nc + 1)[None, :]

    out = []
    for c in clubs:
        i = idx[c.id]
        p = pos[:, i]
        out.append({
            "team_id": c.id, "code": c.code, "name": c.name, "flag_url": c.flag_url,
            "title_pct": round(float((p == 1).mean() * 100), 1),
            "g4_pct": round(float((p <= 4).mean() * 100), 1),
            "z4_pct": round(float((p >= nc - 3).mean() * 100), 1),
            "avg_pts": round(float(pts[:, i].mean()), 1),
            "avg_pos": round(float(p.mean()), 1),
        })
    out.sort(key=lambda r: r["avg_pos"])
    return {"clubs": out, "n_sims": n_sims, "remaining_matches": len(remaining)}


def _recent_form(matches: list[Match], team_id: int, limit: int = 5) -> list[dict]:
    played = [m for m in matches if m.result and (m.team_a_id == team_id or m.team_b_id == team_id)]
    played.sort(key=lambda m: m.match_date or 0, reverse=True)
    out = []
    for m in played[:limit]:
        is_home = m.team_a_id == team_id
        opp = m.team_b if is_home else m.team_a
        gf = m.result.score_a if is_home else m.result.score_b
        ga = m.result.score_b if is_home else m.result.score_a
        result = "V" if gf > ga else ("D" if gf < ga else "E")
        out.append({
            "opponent": opp.name, "opponent_code": opp.code,
            "score_for": gf, "score_against": ga, "result": result,
            "home": is_home,
            "match_date": m.match_date.isoformat() if m.match_date else None,
        })
    return out


@router.get("/matchup")
def matchup(a: int = Query(...), b: int = Query(...), db: Session = Depends(get_db)):
    """Forma recente (últimos 5) de cada time + confronto direto NESTA temporada
    (só temos dados sincronizados de 2026 — sem histórico multi-temporada)."""
    comp_id = _comp_id(db)
    if not comp_id:
        raise HTTPException(404, "Competição Brasileirão não encontrada")

    clubs = {c.id: c for c in db.query(Team).filter(Team.competition_id == comp_id).all()}
    if a not in clubs or b not in clubs:
        raise HTTPException(404, "Time não encontrado nesta competição")

    matches = _load_matches(db, comp_id)
    table = _build_table(list(clubs.values()), matches)
    rows = []
    for cid, r in table.items():
        rows.append({"team_id": cid, "name": clubs[cid].name, **r})
    rows.sort(key=lambda r: (-r["pts"], -r["v"], -(r["gp"] - r["gc"]), -r["gp"], r["name"]))
    pos_by_id = {r["team_id"]: i for i, r in enumerate(rows, start=1)}

    h2h_season = [
        {
            "match_date": m.match_date.isoformat() if m.match_date else None,
            "home": clubs[m.team_a_id].code, "away": clubs[m.team_b_id].code,
            "score_home": m.result.score_a, "score_away": m.result.score_b,
        }
        for m in matches
        if m.result and {m.team_a_id, m.team_b_id} == {a, b}
    ]

    def _team_block(team_id: int) -> dict:
        c = clubs[team_id]
        return {
            "team_id": team_id, "code": c.code, "name": c.name,
            "position": pos_by_id.get(team_id),
            "recent": _recent_form(matches, team_id),
        }

    return {"team_a": _team_block(a), "team_b": _team_block(b), "h2h_season": h2h_season}


@router.get("/projection")
def projection(db: Session = Depends(get_db)):
    try:
        r = _redis()
        cached = r.get(PROJECTION_CACHE_KEY)
        if cached:
            return json.loads(cached)
    except Exception:
        r = None
    data = compute_projection(db)
    if r is not None:
        try:
            r.setex(PROJECTION_CACHE_KEY, PROJECTION_TTL, json.dumps(data))
        except Exception:
            pass
    return data
