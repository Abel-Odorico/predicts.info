"""
Fase 2 Brasileirão — ingestão de dados via football-data.org (código BSA, free tier).

Endpoints admin:
  POST /admin/brasileirao/sync          — teams + fixtures/resultados + stats (2 req na API)
  POST /admin/brasileirao/recompute     — só recalcula Elo/forma/gols (0 req, usa banco)
  GET  /admin/brasileirao/status        — contagens e última execução

Fontes:
  - Clubes e fixtures: football-data.org /competitions/BSA (mesma API key da Copa).
  - Elo: REPLAY próprio da temporada (clubelo.com NÃO cobre Brasil — só Europa).
    Todos os jogos finalizados em ordem cronológica, base 1500, K=24 com
    multiplicador de saldo de gols e +70 Elo de vantagem de casa (is_neutral=False).
    Idempotente: cada recompute refaz o replay do zero.
  - xG: proxy = média de gols (plano Fase 2 — sem fonte de xG de clube no free tier).

Identidade de linha: teams.external_id / matches.external_id = id da football-data.
Resolve TLA duplicado dentro da BSA (Corinthians e Coritiba = "COR" → Coritiba vira CTB).
Nunca deleta — só insere/atualiza, e SÓ linhas com competition_id do Brasileirão.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth_utils import require_admin
from database import get_db
from models import Competition, Match, MatchPhase, MatchResult, MatchStatus, Team, User
from routers.football_data_sync import _api_key, _parse_date, _utcnow

router = APIRouter(tags=["brasileirao-sync"])

BASE_URL   = "https://api.football-data.org/v4"
BSA_CODE   = "BSA"
BSA_SEASON = "2026"

COMP_CODE = "brasileirao2026"
COMP_NAME = "Brasileirão Série A 2026"

# TLA da football-data colide dentro da própria BSA (Corinthians × Coritiba, ambos COR).
# Override por external_id do clube. teams.code é UNIQUE global.
TLA_FIX = {4241: "CTB"}  # Coritiba FBC

# Replay de Elo
ELO_BASE     = 1500.0
ELO_K        = 24.0
ELO_HOME_ADV = 70.0

_last_run: dict = {}

_STATUS_MAP = {
    "TIMED": MatchStatus.scheduled, "SCHEDULED": MatchStatus.scheduled,
    "POSTPONED": MatchStatus.scheduled,
    "IN_PLAY": MatchStatus.live, "PAUSED": MatchStatus.live,
    "FINISHED": MatchStatus.finished,
}


def _fetch(api_key: str, path: str) -> dict:
    url = f"{BASE_URL}/competitions/{BSA_CODE}/{path}?season={BSA_SEASON}"
    headers = {"X-Auth-Token": api_key}
    resp = httpx.get(url, headers=headers, timeout=25)
    if resp.status_code == 429:
        time.sleep(6)
        resp = httpx.get(url, headers=headers, timeout=25)
    resp.raise_for_status()
    _last_run["quota_remaining"] = resp.headers.get("X-Requests-Available-Minute", "?")
    return resp.json()


def ensure_competition(db: Session) -> int:
    comp = db.query(Competition).filter(Competition.code == COMP_CODE).first()
    if not comp:
        comp = Competition(
            code=COMP_CODE, name=COMP_NAME, kind="league",
            season="2026", status="upcoming",
            starts_at=datetime(2026, 1, 28), ends_at=datetime(2026, 12, 2),
        )
        db.add(comp)
        db.commit()
        db.refresh(comp)
    return comp.id


# ── Clubes ─────────────────────────────────────────────────────────────────────

def sync_teams(db: Session, api_key: str | None = None) -> dict:
    api_key = api_key or _api_key(db)
    comp_id = ensure_competition(db)
    data = _fetch(api_key, "teams")

    created = updated = 0
    errors: list[str] = []

    for t in data.get("teams", []):
        ext_id = t["id"]
        code = TLA_FIX.get(ext_id, (t.get("tla") or "")[:3].upper())
        name = t.get("shortName") or t.get("name") or code
        if not code:
            errors.append(f"{name}: sem TLA")
            continue

        existing = db.query(Team).filter(Team.external_id == ext_id).first()
        if not existing:
            # code é UNIQUE global — colisão com seleção da Copa ou outro clube
            # sem external_id ainda: não sobrescrever, reportar.
            clash = db.query(Team).filter(Team.code == code).first()
            if clash and clash.external_id not in (None, ext_id):
                errors.append(f"{name}: código {code} já usado por {clash.name}")
                continue
            if clash and clash.competition_id != comp_id:
                errors.append(f"{name}: código {code} pertence a outra competição ({clash.name})")
                continue
            existing = clash

        if existing:
            existing.external_id = ext_id
            existing.name = name
            existing.code = code
            existing.flag_url = t.get("crest")
            existing.competition_id = comp_id
            updated += 1
        else:
            db.add(Team(
                external_id=ext_id, code=code, name=name,
                confederation="CONMEBOL", group_name=None,
                competition_id=comp_id, flag_url=t.get("crest"),
                elo_rating=ELO_BASE,
            ))
            created += 1

    db.commit()
    out = {"created": created, "updated": updated, "errors": errors, "at": _utcnow().isoformat()}
    _last_run["teams"] = out
    return out


# ── Fixtures + resultados ──────────────────────────────────────────────────────

def sync_matches(db: Session, api_key: str | None = None) -> dict:
    api_key = api_key or _api_key(db)
    comp_id = ensure_competition(db)
    data = _fetch(api_key, "matches")

    team_by_ext = {
        t.external_id: t
        for t in db.query(Team).filter(Team.competition_id == comp_id).all()
        if t.external_id
    }

    created = updated = results = skipped = 0

    for m in data.get("matches", []):
        home_ext = (m.get("homeTeam") or {}).get("id")
        away_ext = (m.get("awayTeam") or {}).get("id")
        home = team_by_ext.get(home_ext)
        away = team_by_ext.get(away_ext)
        if not home or not away:
            skipped += 1
            continue

        match_date = _parse_date(m["utcDate"])
        status = _STATUS_MAP.get(m["status"], MatchStatus.scheduled)

        row = db.query(Match).filter(Match.external_id == m["id"]).first()
        if row:
            row.team_a_id = home.id
            row.team_b_id = away.id
            row.match_date = match_date
            row.bet_deadline = match_date
            row.match_number = m.get("matchday")
            # status live/finished do fallback ao vivo nunca é rebaixado pela API
            if not (row.status == MatchStatus.finished and status == MatchStatus.scheduled):
                row.status = status
            updated += 1
        else:
            row = Match(
                external_id=m["id"], competition_id=comp_id,
                phase=MatchPhase.group, group_name=None,
                team_a_id=home.id, team_b_id=away.id,
                match_date=match_date, bet_deadline=match_date,
                match_number=m.get("matchday"),
                status=status, is_neutral=False,
            )
            db.add(row)
            created += 1
        db.flush()

        ft = (m.get("score") or {}).get("fullTime") or {}
        if m["status"] == "FINISHED" and ft.get("home") is not None and ft.get("away") is not None:
            sa, sb = ft["home"], ft["away"]
            result_str = "a" if sa > sb else ("b" if sb > sa else "draw")
            res = db.query(MatchResult).filter(MatchResult.match_id == row.id).first()
            if res:
                if res.score_a != sa or res.score_b != sb:
                    res.score_a, res.score_b, res.result = sa, sb, result_str
                    results += 1
            else:
                db.add(MatchResult(
                    match_id=row.id, score_a=sa, score_b=sb,
                    result=result_str, recorded_at=_utcnow(),
                ))
                results += 1
            row.status = MatchStatus.finished

    db.commit()
    out = {"created": created, "updated": updated, "results": results,
           "skipped": skipped, "at": _utcnow().isoformat()}
    _last_run["matches"] = out
    return out


# ── Elo replay + forma + gols/xG ───────────────────────────────────────────────

def _goal_diff_mult(diff: int) -> float:
    """Multiplicador de K por saldo de gols (padrão World Football Elo)."""
    d = abs(diff)
    if d <= 1:
        return 1.0
    if d == 2:
        return 1.5
    return (11 + d) / 8.0


def recompute_stats(db: Session) -> dict:
    """Replay completo da temporada: Elo, forma (5/10/20), média de gols e xG-proxy.
    Idempotente — sempre parte de ELO_BASE e reprocessa todos os finalizados em ordem."""
    comp_id = ensure_competition(db)
    clubs = db.query(Team).filter(Team.competition_id == comp_id).all()
    club_ids = {c.id for c in clubs}

    finished = (
        db.query(Match, MatchResult)
        .join(MatchResult, MatchResult.match_id == Match.id)
        .filter(Match.competition_id == comp_id)
        .order_by(Match.match_date)
        .all()
    )

    elo = {cid: ELO_BASE for cid in club_ids}
    history: dict[int, list[tuple[float, int, int]]] = {cid: [] for cid in club_ids}  # (pts, gf, ga)

    for match, res in finished:
        h, a = match.team_a_id, match.team_b_id
        if h not in club_ids or a not in club_ids:
            continue
        exp_home = 1.0 / (1.0 + 10 ** (-((elo[h] + ELO_HOME_ADV) - elo[a]) / 400.0))
        score_home = 1.0 if res.score_a > res.score_b else (0.0 if res.score_a < res.score_b else 0.5)
        delta = ELO_K * _goal_diff_mult(res.score_a - res.score_b) * (score_home - exp_home)
        elo[h] += delta
        elo[a] -= delta
        history[h].append((score_home, res.score_a, res.score_b))
        history[a].append((1.0 - score_home, res.score_b, res.score_a))

    def _form(games: list, n: int) -> float:
        last = games[-n:]
        if not last:
            return 0.5
        return sum(g[0] for g in last) / len(last)

    for c in clubs:
        games = history.get(c.id, [])
        c.elo_rating = round(elo.get(c.id, ELO_BASE), 2)
        c.form_5 = round(_form(games, 5), 3)
        c.form_10 = round(_form(games, 10), 3)
        c.form_20 = round(_form(games, 20), 3)
        if games:
            gf = sum(g[1] for g in games) / len(games)
            ga = sum(g[2] for g in games) / len(games)
            c.avg_goals_for = round(gf, 2)
            c.avg_goals_against = round(ga, 2)
            # xG-proxy: média de gols (Fase 2 — sem fonte de xG de clube)
            c.xg_for = round(gf, 2)
            c.xg_against = round(ga, 2)

    db.commit()
    out = {"clubs": len(clubs), "finished_matches": len(finished), "at": _utcnow().isoformat()}
    _last_run["stats"] = out
    return out


def sync_all(db: Session) -> dict:
    api_key = _api_key(db)
    teams = sync_teams(db, api_key)
    matches = sync_matches(db, api_key)
    stats = recompute_stats(db)
    return {"teams": teams, "matches": matches, "stats": stats}


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/admin/brasileirao/sync")
def endpoint_sync(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return sync_all(db)


@router.post("/admin/brasileirao/recompute")
def endpoint_recompute(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return recompute_stats(db)


@router.get("/admin/brasileirao/status")
def endpoint_status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    comp = db.query(Competition).filter(Competition.code == COMP_CODE).first()
    if not comp:
        return {"competition": None, "last_run": _last_run}
    counts = db.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM teams WHERE competition_id = :c)   AS clubs,
          (SELECT COUNT(*) FROM matches WHERE competition_id = :c) AS matches,
          (SELECT COUNT(*) FROM matches m JOIN match_results r ON r.match_id = m.id
            WHERE m.competition_id = :c)                           AS results
    """), {"c": comp.id}).fetchone()
    return {
        "competition": {"id": comp.id, "code": comp.code, "status": comp.status},
        "clubs": counts.clubs, "matches": counts.matches, "results": counts.results,
        "last_run": _last_run,
    }
