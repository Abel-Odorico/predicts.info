from datetime import datetime, timedelta
import json
import unicodedata
from zoneinfo import ZoneInfo

_BRT = ZoneInfo("America/Sao_Paulo")

import httpx
import redis as redis_lib
from fastapi import APIRouter

from config import settings

router = APIRouter(prefix="/live", tags=["live"])

LIVE_CACHE_KEY = "live:wc:games"
LIVE_CACHE_TTL = 4 * 3600  # 4h — covers longest possible match window

TEAM_NAME_ALIASES = {
    "republica tcheca": "czech republic",
    "tchequia": "czech republic",
    "africa do sul": "south africa",
    "suica": "switzerland",
    "bosnia e herzegovina": "bosnia and herzegovina",
    "coreia do sul": "south korea",
    "catar": "qatar",
    "estados unidos": "united states",
    "eua": "united states",
    "arabia saudita": "saudi arabia",
    "cabo verde": "cape verde",
    "costa do marfim": "ivory coast",
    "holanda": "netherlands",
    "marrocos": "morocco",
    "turquia": "turkey",
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


def _game_status_from_raw(raw_status: str, time_label: str) -> str:
    raw = raw_status.strip()
    if not raw:
        return _infer_status_from_time(time_label)
    upper = raw.upper()
    if "FIM" in upper or "ENCERR" in upper or "FINALIZ" in upper or upper in {"FT", "AET", "PEN"}:
        return "finished"
    live_keywords = {"VIVO", "LIVE", "INTERVALO", "HT", "ET", "PRORROG", "PENALT", "1T", "2T", "1H", "2H"}
    if any(kw in upper for kw in live_keywords) or any(ch.isdigit() for ch in raw):
        return "live"
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
    if kickoff_at <= now_brt <= kickoff_at + timedelta(hours=2, minutes=45):
        return "live"
    if now_brt > kickoff_at + timedelta(hours=2, minutes=45):
        return "finished"
    return "scheduled"


def _game_key(game: dict) -> str:
    a = _normalize_team_name(str(game.get("team_a") or game.get("time1") or ""))
    b = _normalize_team_name(str(game.get("team_b") or game.get("time2") or ""))
    return f"{a}_vs_{b}"


def _build_game(item: dict) -> dict:
    time_label = str(item.get("horario") or "").strip()
    raw_status = str(item.get("status") or "")
    return {
        "competition": item.get("competicao"),
        "date_label": item.get("data_jogo"),
        "time_label": time_label,
        "status": _game_status_from_raw(raw_status, time_label),
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

    return {
        "source": "fg.peepstreaming.com",
        "updated_at": updated_at,
        "count": len(merged),
        "games": merged,
    }


@router.get("/world-cup")
def world_cup_live_feed():
    return fetch_world_cup_live_games()
