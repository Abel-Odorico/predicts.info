from datetime import datetime, timedelta, timezone
import json
import unicodedata
from zoneinfo import ZoneInfo

_BRT = ZoneInfo("America/Sao_Paulo")

import httpx
import redis as redis_lib
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from config import settings
from database import get_db
from models import Match, MatchPhase, Team

router = APIRouter(prefix="/live", tags=["live"])

LIVE_CACHE_KEY = "live:wc:games"
LIVE_CACHE_TTL = 4 * 3600  # 4h — covers longest possible match window

# Throttle: serve o feed computado por alguns segundos para não disparar um
# fetch externo (httpx ao fg, timeout 15s) a cada request de cada cliente.
FEED_CACHE_KEY = "live:wc:feed"
FEED_CACHE_TTL_OK = 45    # fetch bem-sucedido
FEED_CACHE_TTL_ERR = 15   # fonte fora do ar — evita pile-up de timeouts

TEAM_NAME_ALIASES = {
    "republica tcheca": "czech republic",
    "tchequia": "czech republic",
    "africa do sul": "south africa",
    "suica": "switzerland",
    "bosnia e herzegovina": "bosnia and herzegovina",
    "coreia do sul": "south korea",
    "corea do sul": "south korea",
    "catar": "qatar",
    "estados unidos": "united states",
    "eua": "united states",
    "arabia saudita": "saudi arabia",
    "cabo verde": "cape verde",
    "costa do marfim": "ivory coast",
    "holanda": "netherlands",
    "paises baixos": "netherlands",
    "marrocos": "morocco",
    "turquia": "turkey",
    # PT names missing aliases
    "brasil": "brazil",
    "escocia": "scotland",
    "alemanha": "germany",
    "espanha": "spain",
    "franca": "france",
    "belgica": "belgium",
    "suecia": "sweden",
    "japao": "japan",
    "jordania": "jordan",
    "uruguai": "uruguay",
    "equador": "ecuador",
    "croacia": "croatia",
    "nova zelandia": "new zealand",
    "nova zelândia": "new zealand",
    "uzbequistao": "uzbekistan",
    "uzbesquistao": "uzbekistan",
    "tunisia": "tunisia",
    "tunessia": "tunisia",
    "curacao": "curaçao",
    "rd congo": "dr congo",
    "republica democratica do congo": "dr congo",
    "rd do congo": "dr congo",
    "congo dr": "dr congo",
    "congo": "dr congo",
    "paraguai": "paraguay",
    "arabia": "saudi arabia",
    "iraque": "iraq",
    "ira": "iran",
    "egito": "egypt",
    "gana": "ghana",
    "colômbia": "colombia",
    "colombia": "colombia",
    "haiti": "haiti",
    "panama": "panama",
    "mexico": "mexico",
    "noruega": "norway",
    "austria": "austria",
    "irlanda do norte": "northern ireland",
    "portugal": "portugal",
    "senegal": "senegal",
    "australia": "australia",
    "canada": "canada",
    "argentina": "argentina",
    "argelia": "algeria",
    "inglaterra": "england",
    "gales": "wales",
    "irlanda": "ireland",
    "dinamarca": "denmark",
    "italia": "italy",
    "grecia": "greece",
    "polonia": "poland",
    "russia": "russia",
    "ucrania": "ukraine",
    "servia": "serbia",
    "eslovenia": "slovenia",
    "eslovaquia": "slovakia",
    "hungria": "hungary",
    "romenia": "romania",
    "finlandia": "finland",
    "islandia": "iceland",
    "republica da irlanda": "ireland",
    "coreia do norte": "north korea",
    "emirados arabes unidos": "united arab emirates",
    "nova caledonia": "new caledonia",
}


def _get_redis():
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


def _normalize_text(value: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_text.strip().lower().split())


def _normalize_team_name(value: str) -> str:
    normalized = _normalize_text(value)
    return TEAM_NAME_ALIASES.get(normalized, normalized)


def _is_world_cup_game(item: dict) -> bool:
    competition = _normalize_text(str(item.get("competicao") or ""))
    return "copa do mundo" in competition or "world cup" in competition or "fifa wc" in competition


def _game_status_from_raw(raw_status: str, time_label: str, has_score: bool = False) -> str:
    raw = raw_status.strip()
    upper = raw.upper()
    if raw and ("FIM" in upper or "ENCERR" in upper or "FINALIZ" in upper or upper in {"FT", "AET", "PEN"}):
        return "finished"
    live_keywords = {"VIVO", "LIVE", "INT", "INTERVALO", "HT", "ET", "PRORROG", "PENALT", "1T", "2T", "1H", "2H"}
    if raw and (any(kw in upper for kw in live_keywords) or any(ch.isdigit() for ch in raw)):
        return "live"
    # placar presente + dentro da janela de jogo = ao vivo, mesmo sem status textual
    if has_score and _infer_status_from_time(time_label) in ("live", "finished"):
        return "live"
    if not raw:
        return _infer_status_from_time(time_label)
    return "scheduled"


def _infer_status_from_time(time_label: str) -> str:
    if not time_label:
        return "scheduled"
    try:
        kickoff = datetime.strptime(time_label.strip(), "%H:%M").time()
    except ValueError:
        return "scheduled"
    now_brt = datetime.now(_BRT).replace(tzinfo=None)
    kickoff_at = now_brt.replace(hour=kickoff.hour, minute=kickoff.minute, second=0, microsecond=0)
    # Janela generosa: 90' + intervalo + prorrogação (30') + intervalo + pênaltis,
    # mais folga pra acréscimos e atraso de transmissão. Sem isso, jogo que vai
    # pra prorrogação/pênaltis some do "ao vivo" antes de acabar de verdade.
    if kickoff_at <= now_brt <= kickoff_at + timedelta(hours=3, minutes=30):
        return "live"
    if now_brt > kickoff_at + timedelta(hours=3, minutes=30):
        return "finished"
    return "scheduled"


def _game_key(game: dict) -> str:
    a = _normalize_team_name(str(game.get("team_a") or game.get("time1") or ""))
    b = _normalize_team_name(str(game.get("team_b") or game.get("time2") or ""))
    return f"{a}_vs_{b}"


def _build_game(item: dict) -> dict:
    time_label = str(item.get("horario") or "").strip()
    raw_status = str(item.get("status") or "")
    has_score = item.get("placar_time1") not in (None, "") and item.get("placar_time2") not in (None, "")
    return {
        "competition": item.get("competicao"),
        "date_label": item.get("data_jogo"),
        "time_label": time_label,
        "status": _game_status_from_raw(raw_status, time_label, has_score),
        "status_raw": raw_status,
        "team_a": item.get("time1"),
        "team_b": item.get("time2"),
        "team_a_key": _normalize_team_name(str(item.get("time1") or "")),
        "team_b_key": _normalize_team_name(str(item.get("time2") or "")),
        "score_a": item.get("placar_time1") or None,
        "score_b": item.get("placar_time2") or None,
        "team_a_flag": item.get("img_time1_url"),
        "team_b_flag": item.get("img_time2_url"),
        "competition_logo": item.get("img_competicao_url"),
        "channels": item.get("canais") or [],
        "venue": item.get("estadio") or None,
        "city": item.get("cidade") or None,
    }


def _load_cached_games() -> list[dict]:
    try:
        r = _get_redis()
        raw = r.get(LIVE_CACHE_KEY)
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    return []


def _save_cached_games(games: list[dict]) -> None:
    try:
        r = _get_redis()
        r.setex(LIVE_CACHE_KEY, LIVE_CACHE_TTL, json.dumps(games, ensure_ascii=False))
    except Exception:
        pass


def fetch_world_cup_live_games() -> dict:
    # Cache curto do feed inteiro — throttle do fetch externo
    try:
        r = _get_redis()
        cached_feed = r.get(FEED_CACHE_KEY)
        if cached_feed:
            return json.loads(cached_feed)
    except Exception:
        pass

    try:
        response = httpx.get(settings.fg_sports_url, timeout=15.0, follow_redirects=True)
        response.raise_for_status()
        data = response.json()
        games_raw = data.get("jogos") if isinstance(data, dict) else []
        if not isinstance(games_raw, list):
            games_raw = []
        updated_at = data.get("updated_at") if isinstance(data, dict) else datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        fetch_ok = True
    except Exception:
        games_raw = []
        updated_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        fetch_ok = False

    # Build from API response
    api_games: list[dict] = []
    for item in games_raw:
        if not isinstance(item, dict) or not _is_world_cup_game(item):
            continue
        api_games.append(_build_game(item))

    api_keys = {_game_key(g) for g in api_games}

    # Restore games that vanished from API but are still in live/finished window
    cached = _load_cached_games()
    merged = list(api_games)
    for cached_game in cached:
        key = _game_key(cached_game)
        if key in api_keys:
            continue
        inferred = _infer_status_from_time(str(cached_game.get("time_label") or ""))
        if inferred in ("live", "finished"):
            restored = dict(cached_game)
            restored["status"] = inferred
            if inferred == "live" and not restored.get("status_raw"):
                restored["status_raw"] = "Ao vivo"
            merged.append(restored)

    # Persist merged state so restored games survive next call
    if fetch_ok:
        _save_cached_games(merged)

    result = {
        "source": "fg.peepstreaming.com",
        "updated_at": updated_at,
        "count": len(merged),
        "games": merged,
    }

    # Throttle: guarda o feed por alguns segundos (TTL menor se a fonte falhou)
    try:
        r = _get_redis()
        ttl = FEED_CACHE_TTL_OK if fetch_ok else FEED_CACHE_TTL_ERR
        r.setex(FEED_CACHE_KEY, ttl, json.dumps(result, ensure_ascii=False))
    except Exception:
        pass

    return result


@router.get("/world-cup")
def world_cup_live_feed(db: Session = Depends(get_db)):
    from sqlalchemy.orm import joinedload
    data = fetch_world_cup_live_games()

    db_matches = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .all()
    )
    match_lookup = {
        (_normalize_team_name(m.team_a.name), _normalize_team_name(m.team_b.name)): m.id
        for m in db_matches
        if m.team_a and m.team_b
    }

    for game in data.get("games", []):
        key = (game.get("team_a_key") or "", game.get("team_b_key") or "")
        game["match_id"] = match_lookup.get(key)

    return data


# ── Classificação projetada ao vivo ─────────────────────────────────────────
# Sobrepõe placares de jogos de grupo em andamento à tabela (só resultados
# encerrados) e recalcula posições + classificados (top 2 + 8 melhores 3ºs).

def _new_row(team: Team) -> dict:
    return {
        "id": team.id, "code": team.code, "name": team.name,
        "group_name": team.group_name, "elo_rating": float(team.elo_rating),
        "flag_url": team.flag_url,
        "points": 0, "played": 0, "wins": 0, "draws": 0, "losses": 0,
        "gf": 0, "ga": 0, "gd": 0,
    }


def _apply_score(a: dict, b: dict, sa: int, sb: int) -> None:
    a["played"] += 1; b["played"] += 1
    a["gf"] += sa; a["ga"] += sb; b["gf"] += sb; b["ga"] += sa
    if sa > sb:
        a["wins"] += 1; a["points"] += 3; b["losses"] += 1
    elif sb > sa:
        b["wins"] += 1; b["points"] += 3; a["losses"] += 1
    else:
        a["draws"] += 1; b["draws"] += 1; a["points"] += 1; b["points"] += 1


def _build_tables(teams: list[Team], scored: list[tuple]) -> dict:
    """scored = list of (team_a_id, team_b_id, score_a, score_b)."""
    rows: dict[int, dict] = {t.id: _new_row(t) for t in teams}
    groups: dict[str, list] = {}
    for t in teams:
        groups.setdefault(t.group_name, []).append(rows[t.id])

    for a_id, b_id, sa, sb in scored:
        a, b = rows.get(a_id), rows.get(b_id)
        if a and b:
            _apply_score(a, b, sa, sb)

    thirds = []
    for rws in groups.values():
        for r in rws:
            r["gd"] = r["gf"] - r["ga"]
        rws.sort(key=lambda x: (-x["points"], -x["gd"], -x["gf"], -x["elo_rating"], x["name"]))
        for i, r in enumerate(rws, start=1):
            r["position"] = i
        if len(rws) >= 3:
            thirds.append(rws[2])

    thirds.sort(key=lambda x: (-x["points"], -x["gd"], -x["gf"], -x["elo_rating"], x["name"]))
    best_third_ids = {r["id"] for r in thirds[:8]}
    qual_ids = set()
    for rws in groups.values():
        for r in rws[:2]:
            qual_ids.add(r["id"])
    qual_ids |= best_third_ids
    return {"groups": groups, "rows": rows, "thirds": thirds,
            "best_third_ids": best_third_ids, "qual_ids": qual_ids}


@router.get("/classification")
def live_classification(db: Session = Depends(get_db)):
    teams = db.query(Team).filter(Team.group_name.isnot(None)).all()
    matches = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
        .filter(Match.phase == MatchPhase.group)
        .all()
    )

    # Placares encerrados (baseline)
    finished = [
        (m.team_a_id, m.team_b_id, m.result.score_a, m.result.score_b)
        for m in matches if m.result
    ]

    # Feed ao vivo → lookup por par de chaves normalizadas
    feed = fetch_world_cup_live_games()
    live_by_key: dict[tuple, dict] = {}
    for g in feed.get("games", []):
        if g.get("status") != "live":
            continue
        if g.get("score_a") is None or g.get("score_b") is None:
            continue
        live_by_key[(g.get("team_a_key") or "", g.get("team_b_key") or "")] = g

    # Casa jogos de grupo (sem resultado) ao feed ao vivo
    live_overlay: list[tuple] = []
    live_team_ids: set[int] = set()
    live_match_ids: set[int] = set()
    for m in matches:
        if m.result or not m.team_a or not m.team_b:
            continue
        ka = _normalize_team_name(m.team_a.name)
        kb = _normalize_team_name(m.team_b.name)
        g = live_by_key.get((ka, kb)) or live_by_key.get((kb, ka))
        if not g:
            continue
        sa, sb = int(g["score_a"]), int(g["score_b"])
        # se feed inverteu mando, alinha pelo par
        if live_by_key.get((kb, ka)) and not live_by_key.get((ka, kb)):
            sa, sb = sb, sa
        live_overlay.append((m.team_a_id, m.team_b_id, sa, sb))
        live_team_ids.update({m.team_a_id, m.team_b_id})
        live_match_ids.add(m.id)

    baseline = _build_tables(teams, finished)
    projected = _build_tables(teams, finished + live_overlay)

    base_qual = baseline["qual_ids"]
    proj_qual = projected["qual_ids"]

    def _status(r: dict) -> str:
        if r["position"] <= 2:
            return "top2"
        if r["id"] in projected["best_third_ids"]:
            return "third"
        return "out"

    def _delta(team_id: int):
        if team_id in proj_qual and team_id not in base_qual:
            return "in"
        if team_id in base_qual and team_id not in proj_qual:
            return "out"
        return None

    def _row_out(r: dict) -> dict:
        return {
            **{k: r[k] for k in ("id", "code", "name", "group_name", "flag_url",
                                 "points", "played", "wins", "draws", "losses",
                                 "gf", "ga", "gd", "position")},
            "qualifying": r["id"] in proj_qual,
            "status": _status(r),
            "delta": _delta(r["id"]),
            "live": r["id"] in live_team_ids,
        }

    out_groups = {
        g: [_row_out(r) for r in rows]
        for g, rows in sorted(projected["groups"].items())
    }

    # Jogos decisivos: ao vivo OU 3ª rodada (ambos times já jogaram 2 e jogo não encerrado)
    proj_rows = projected["rows"]
    base_rows = baseline["rows"]
    decisive = []
    for m in matches:
        if m.result or not m.team_a or not m.team_b:
            continue
        is_live = m.id in live_match_ids
        ba = base_rows.get(m.team_a_id, {}).get("played", 0)
        bb = base_rows.get(m.team_b_id, {}).get("played", 0)
        is_md3 = ba >= 2 and bb >= 2
        if not (is_live or is_md3):
            continue
        live_g = None
        if is_live:
            ka = _normalize_team_name(m.team_a.name)
            kb = _normalize_team_name(m.team_b.name)
            live_g = live_by_key.get((ka, kb)) or live_by_key.get((kb, ka))

        def _team_brief(team_id: int, team: Team) -> dict:
            pr = proj_rows.get(team_id, {})
            return {
                "id": team.id, "code": team.code, "name": team.name,
                "flag_url": team.flag_url,
                "group_name": team.group_name,
                "position": pr.get("position"),
                "points": pr.get("points", 0),
                "qualifying": team_id in proj_qual,
                "delta": _delta(team_id),
            }

        decisive.append({
            "match_id": m.id,
            "group_name": m.team_a.group_name,
            "live": is_live,
            "status_raw": (live_g or {}).get("status_raw") if is_live else "",
            "time_label": (live_g or {}).get("time_label") if is_live else None,
            "match_date": m.match_date.isoformat() if m.match_date else None,
            "score_a": (live_g or {}).get("score_a") if is_live else None,
            "score_b": (live_g or {}).get("score_b") if is_live else None,
            "team_a": _team_brief(m.team_a_id, m.team_a),
            "team_b": _team_brief(m.team_b_id, m.team_b),
        })

    decisive.sort(key=lambda d: (not d["live"], d["match_date"] or "9999"))

    qp = projected["rows"]

    def _qual_list(ids):
        return sorted(
            ({**{k: qp[i][k] for k in ("id", "code", "name", "group_name", "flag_url", "points")},
              "delta": _delta(i)} for i in ids),
            key=lambda x: (x["group_name"] or "", -x["points"]),
        )

    winners_ids = [rows[0]["id"] for rows in projected["groups"].values()]
    runners_ids = [rows[1]["id"] for rows in projected["groups"].values() if len(rows) > 1]

    # Confrontos projetados das Oitavas (R32) — resolvidos pela tabela ao vivo
    bracket = []
    try:
        from world_cup_official import fetch_official_knockout_schedule, resolve_slot, candidate_thirds
        table_compat = {"groups": projected["groups"], "thirds": projected["thirds"]}

        def _slot_brief(label):
            slot = resolve_slot(label, table_compat)
            if not slot:
                cands = candidate_thirds(label, table_compat)
                slot = cands[0] if cands else None
            if not slot:
                return None
            return {"id": slot["id"], "code": slot["code"], "name": slot["name"],
                    "flag_url": slot["flag_url"], "group_name": slot["group_name"]}

        for item in fetch_official_knockout_schedule():
            if item.get("phase") != "r32":
                continue
            bracket.append({
                "section": item.get("section"),
                "team_a_label": item.get("team_a_label"),
                "team_b_label": item.get("team_b_label"),
                "team_a": _slot_brief(item.get("team_a_label", "")),
                "team_b": _slot_brief(item.get("team_b_label", "")),
            })
    except Exception:
        bracket = []

    return {
        "updated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "has_live": len(live_overlay) > 0,
        "live_count": len(live_overlay),
        "groups": out_groups,
        "decisive_games": decisive,
        "bracket": bracket,
        "qualified_picture": {
            "winners": _qual_list(winners_ids),
            "runners_up": _qual_list(runners_ids),
            "best_thirds": _qual_list(projected["best_third_ids"]),
        },
    }
