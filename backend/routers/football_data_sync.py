"""
Sync de resultados e partidas via football-data.org (substitui Wikipedia para resultados).

Endpoints admin:
  POST /admin/football-data/sync-results    — atualiza resultados FINISHED
  POST /admin/football-data/sync-knockout   — corrige/cria partidas do mata-mata
  GET  /admin/football-data/status          — quota e última execução

Limite free: 10 req/min. Cada sync usa 1-2 requisições.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Callable

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth_utils import require_admin
from database import get_db
from models import Match, MatchPhase, MatchResult, Team, User

router = APIRouter(tags=["football-data-sync"])

BASE_URL   = "https://api.football-data.org/v4"
WC_CODE    = "WC"
WC_SEASON  = "2026"

_last_run: dict = {}

# football-data.org stage → nosso MatchPhase
STAGE_MAP = {
    "GROUP_STAGE":    MatchPhase.group,
    "LAST_32":        MatchPhase.r32,
    "LAST_16":        MatchPhase.r16,
    "QUARTER_FINALS": MatchPhase.qf,
    "SEMI_FINALS":    MatchPhase.sf,
    "THIRD_PLACE":    MatchPhase.third,
    "FINAL":          MatchPhase.final,
}

# Diferenças de nome entre API e nosso banco (fallback: usa TLA)
NAME_FIX = {
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "Cape Verde Islands":  "Cape Verde",
    "Czechia":            "Czech Republic",
    "Congo DR":           "DR Congo",
    "Turkey":             "Türkiye",
}


def _api_key(db: Session) -> str:
    row = db.execute(
        text("SELECT value FROM site_config WHERE key = 'football_data_api_key'")
    ).fetchone()
    key = (row[0] if row else "") or ""
    if not key:
        from config import settings
        key = getattr(settings, "football_data_api_key", "")
    if not key:
        raise HTTPException(503, "football_data_api_key não configurada")
    return key


def _fetch_matches(api_key: str, stage: str | None = None) -> list[dict]:
    url = f"{BASE_URL}/competitions/{WC_CODE}/matches?season={WC_SEASON}"
    if stage:
        url += f"&stage={stage}"
    headers = {"X-Auth-Token": api_key}
    resp = httpx.get(url, headers=headers, timeout=20)
    if resp.status_code == 429:
        time.sleep(6)
        resp = httpx.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    remaining = resp.headers.get("X-Requests-Available-Minute", "?")
    _last_run["quota_remaining"] = remaining
    return data.get("matches", [])


def _team_by_tla(db: Session, tla: str) -> Team | None:
    return db.query(Team).filter(Team.code == tla.upper()).first()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_date(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).replace(tzinfo=None)


# ── Sync resultados ────────────────────────────────────────────────────────────

def sync_results(db: Session) -> dict:
    """Busca todos os jogos FINISHED e atualiza match_results no banco."""
    api_key = _api_key(db)
    matches_api = _fetch_matches(api_key)

    updated = created = skipped = errors = 0

    for m in matches_api:
        if m["status"] != "FINISHED":
            continue
        score = m["score"]["fullTime"]
        if score["home"] is None or score["away"] is None:
            continue

        tla_a = m["homeTeam"].get("tla", "")
        tla_b = m["awayTeam"].get("tla", "")
        if not tla_a or not tla_b:
            skipped += 1
            continue

        team_a = _team_by_tla(db, tla_a)
        team_b = _team_by_tla(db, tla_b)
        if not team_a or not team_b:
            skipped += 1
            continue

        match_date = _parse_date(m["utcDate"])
        phase = STAGE_MAP.get(m.get("stage", ""), MatchPhase.group)

        # Localiza partida no banco por times (qualquer ordem) + fase + data próxima
        db_match = db.execute(text("""
            SELECT id FROM matches
            WHERE phase = :phase
              AND match_date::date = :dt
              AND (
                (team_a_id = :ta AND team_b_id = :tb)
                OR (team_a_id = :tb AND team_b_id = :ta)
              )
            LIMIT 1
        """), {
            "phase": phase.value,
            "dt": match_date.date(),
            "ta": team_a.id,
            "tb": team_b.id,
        }).fetchone()

        if not db_match:
            # Fallback: só por times (data pode diferir por fuso)
            db_match = db.execute(text("""
                SELECT id FROM matches WHERE
                  (team_a_id = :ta AND team_b_id = :tb)
                  OR (team_a_id = :tb AND team_b_id = :ta)
                LIMIT 1
            """), {"ta": team_a.id, "tb": team_b.id}).fetchone()

        if not db_match:
            skipped += 1
            continue

        match_id = db_match[0]

        # Orientar placar conforme ordem no nosso banco
        our_match = db.query(Match).filter(Match.id == match_id).first()
        if our_match.team_a_id == team_a.id:
            sa, sb = score["home"], score["away"]
        else:
            sa, sb = score["away"], score["home"]

        result_str = "a" if sa > sb else ("b" if sb > sa else "draw")

        existing = db.query(MatchResult).filter(MatchResult.match_id == match_id).first()
        if existing:
            if existing.score_a == sa and existing.score_b == sb:
                skipped += 1
                continue
            existing.score_a = sa
            existing.score_b = sb
            existing.result = result_str
            updated += 1
        else:
            db.add(MatchResult(
                match_id=match_id, score_a=sa, score_b=sb,
                result=result_str, recorded_at=_utcnow(),
            ))
            created += 1

        # Marcar partida como finished
        our_match.status = "finished"
        db.commit()

    _last_run["results"] = {"updated": updated, "created": created, "skipped": skipped, "errors": errors, "at": _utcnow().isoformat()}
    return _last_run["results"]


# ── Sync mata-mata ─────────────────────────────────────────────────────────────

def sync_knockout(db: Session) -> dict:
    """
    Cria/corrige partidas de mata-mata usando dados da API.
    Só processa partidas com times já definidos (não-None).
    """
    api_key = _api_key(db)
    knockout_stages = ["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"]
    all_matches = _fetch_matches(api_key)

    created = updated = skipped = 0

    for m in all_matches:
        if m.get("stage") not in knockout_stages:
            continue

        tla_a = m["homeTeam"].get("tla") if m["homeTeam"].get("id") else None
        tla_b = m["awayTeam"].get("tla") if m["awayTeam"].get("id") else None
        if not tla_a or not tla_b:
            skipped += 1
            continue

        team_a = _team_by_tla(db, tla_a)
        team_b = _team_by_tla(db, tla_b)
        if not team_a or not team_b:
            skipped += 1
            continue

        phase = STAGE_MAP.get(m["stage"], MatchPhase.r32)
        match_date = _parse_date(m["utcDate"])
        match_number = m.get("id")  # usa ID da API como match_number temporário

        # Procura partida exata (ambos times)
        existing = db.execute(text("""
            SELECT id FROM matches WHERE
              ((team_a_id = :ta AND team_b_id = :tb) OR (team_a_id = :tb AND team_b_id = :ta))
              AND phase = :phase
            LIMIT 1
        """), {"ta": team_a.id, "tb": team_b.id, "phase": phase.value}).fetchone()

        status_val = "scheduled" if m["status"] in ("TIMED", "SCHEDULED") else m["status"].lower()

        if existing:
            db.execute(text("""
                UPDATE matches SET match_date = :dt, status = :st WHERE id = :id
            """), {"dt": match_date, "st": status_val, "id": existing[0]})
            updated += 1
        else:
            # Remove entradas conflitantes (mesmo time, mesma fase, oponente diferente)
            # → duplicatas do Wikipedia sync
            for team_id in [team_a.id, team_b.id]:
                conflicts = db.execute(text("""
                    SELECT id FROM matches
                    WHERE phase = :phase
                      AND (team_a_id = :t OR team_b_id = :t)
                      AND NOT (team_a_id = :ta AND team_b_id = :tb)
                      AND NOT (team_a_id = :tb AND team_b_id = :ta)
                """), {"phase": phase.value, "t": team_id, "ta": team_a.id, "tb": team_b.id}).fetchall()
                for (cid,) in conflicts:
                    db.execute(text("DELETE FROM matches WHERE id = :id"), {"id": cid})

            db.execute(text("""
                INSERT INTO matches (team_a_id, team_b_id, phase, match_date, status, is_neutral, match_number)
                VALUES (:ta, :tb, :phase, :dt, :status, true, :mn)
            """), {
                "ta": team_a.id, "tb": team_b.id,
                "phase": phase.value, "dt": match_date,
                "status": status_val, "mn": match_number,
            })
            created += 1

        db.commit()

    _last_run["knockout"] = {"created": created, "updated": updated, "skipped": skipped, "at": _utcnow().isoformat()}
    return _last_run["knockout"]


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/admin/football-data/sync-results")
def endpoint_sync_results(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return sync_results(db)


@router.post("/admin/football-data/sync-knockout")
def endpoint_sync_knockout(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return sync_knockout(db)


@router.get("/admin/football-data/status")
def endpoint_status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    key = _api_key(db)
    # Testa quota com chamada leve
    try:
        headers = {"X-Auth-Token": key}
        resp = httpx.get(f"{BASE_URL}/competitions/{WC_CODE}", headers=headers, timeout=10)
        quota = resp.headers.get("X-Requests-Available-Minute", "?")
    except Exception as e:
        quota = f"erro: {e}"
    return {"quota_remaining_this_minute": quota, "last_run": _last_run}
