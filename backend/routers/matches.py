from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
import json, hashlib, time
from datetime import datetime, timedelta, timezone
import redis as redis_lib

from database import get_db
from config import settings
from models import Match, Team, SimulationCache, MatchPhase, MatchStatus, Bet, User
from schemas import MatchSimulationResponse
from engine.weights import compute_weighted_lambdas, TeamInput
from engine.monte_carlo import simulate_match
from routers.live import fetch_world_cup_live_games, _normalize_team_name
from auth_utils import get_current_user
from world_cup_official import fetch_official_knockout_schedule

router = APIRouter(prefix="/matches", tags=["matches"])


def _live_match_key(team_a: str, team_b: str) -> tuple[str, str]:
    return (_normalize_team_name(team_a), _normalize_team_name(team_b))


def _build_live_lookup() -> tuple[dict, dict]:
    try:
        live_data = fetch_world_cup_live_games()
        live_lookup = {
            _live_match_key(item.get("team_a") or "", item.get("team_b") or ""): item
            for item in live_data.get("games", [])
        }
        return live_data, live_lookup
    except Exception:
        return {"games": []}, {}


def _is_bet_open(match: Match) -> bool:
    if match.status != MatchStatus.scheduled:
        return False
    deadline = match.bet_deadline or match.match_date
    if not deadline:
        return True
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return now < deadline


def _match_payload(match: Match, live: dict | None = None) -> dict:
    return {
        "id": match.id,
        "phase": match.phase,
        "group_name": match.group_name,
        "match_number": match.match_number,
        "status": live.get("status") if live else match.status,
        "status_raw": live.get("status_raw") if live else ("FIM DE JOGO" if match.result else ""),
        "venue": match.venue,
        "city": match.city,
        "match_date": match.match_date,
        "is_open": _is_bet_open(match),
        "team_a": {
            "id": match.team_a.id,
            "code": match.team_a.code,
            "name": match.team_a.name,
            "elo_rating": float(match.team_a.elo_rating),
            "flag_url": match.team_a.flag_url,
        },
        "team_b": {
            "id": match.team_b.id,
            "code": match.team_b.code,
            "name": match.team_b.name,
            "elo_rating": float(match.team_b.elo_rating),
            "flag_url": match.team_b.flag_url,
        },
        "result": {"score_a": match.result.score_a, "score_b": match.result.score_b} if match.result else None,
        "live_score_a": live.get("score_a") if live else None,
        "live_score_b": live.get("score_b") if live else None,
        "channels": live.get("channels", []) if live else [],
    }


def _get_redis():
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


def _team_to_input(t: Team) -> TeamInput:
    return TeamInput(
        id=t.id,
        code=t.code,
        name=t.name,
        elo_rating=float(t.elo_rating),
        avg_goals_for=float(t.avg_goals_for),
        avg_goals_against=float(t.avg_goals_against),
        xg_for=float(t.xg_for),
        xg_against=float(t.xg_against),
        form_10=float(t.form_10),
        market_value_eur=t.market_value_eur or 0,
        world_cup_appearances=t.world_cup_appearances or 0,
        best_wc_result=t.best_wc_result or "Groups",
    )


def _data_hash(ta: Team, tb: Team) -> str:
    key = f"{ta.code}{ta.elo_rating}{ta.avg_goals_for}{ta.xg_for}{ta.form_10}" \
          f"{tb.code}{tb.elo_rating}{tb.avg_goals_for}{tb.xg_for}{tb.form_10}"
    return hashlib.md5(key.encode()).hexdigest()


@router.get("", tags=["matches"])
def list_matches(
    phase: str | None = Query(None),
    group_name: str | None = Query(None),
    group: str | None = Query(None),
    status: str | None = Query(None),
    limit: int | None = Query(None, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    q = db.query(Match).options(joinedload(Match.team_a), joinedload(Match.team_b))
    if phase:
        q = q.filter(Match.phase == phase)
    gn = group_name or group
    if gn:
        q = q.filter(Match.group_name == gn.upper())
    if status:
        q = q.filter(Match.status == status)
    q = q.order_by(Match.match_number)
    if limit:
        q = q.limit(limit)
    matches = q.all()
    _, live_lookup = _build_live_lookup()

    return [
        _match_payload(m, live_lookup.get(_live_match_key(m.team_a.name, m.team_b.name)))
        for m in matches
    ]


@router.get("/calendar", tags=["matches"])
def calendar_matches(db: Session = Depends(get_db)):
    matches = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
        .order_by(Match.match_date, Match.match_number)
        .all()
    )

    live_data, live_lookup = _build_live_lookup()
    matched_live_keys = set()

    grouped: dict[str, list[dict]] = {}
    for match in matches:
        date_key = match.match_date.date().isoformat() if match.match_date else "sem-data"
        key = _live_match_key(match.team_a.name, match.team_b.name)
        live = live_lookup.get(key)
        if live:
            matched_live_keys.add(key)
        row = _match_payload(match, live)
        row["phase"] = match.phase.value if hasattr(match.phase, "value") else str(match.phase)
        grouped.setdefault(date_key, []).append(row)

    for item in live_data.get("games", []):
        key = _live_match_key(item.get("team_a") or "", item.get("team_b") or "")
        if key in matched_live_keys:
            continue
        date_key = datetime.now().date().isoformat() if item.get("date_label") == "hoje" else "sem-data"
        grouped.setdefault(date_key, []).append(
            {
                "id": f"live-{item['team_a_key']}-{item['team_b_key']}",
                "phase": "live",
                "group_name": None,
                "match_number": None,
                "match_date": None,
                "venue": item.get("venue"),
                "city": item.get("city"),
                "status": item.get("status") or "scheduled",
                "status_raw": item.get("status_raw") or "",
                "team_a": {
                    "code": (item.get("team_a") or "")[:3].upper(),
                    "name": item.get("team_a"),
                    "flag_url": item.get("team_a_flag"),
                },
                "team_b": {
                    "code": (item.get("team_b") or "")[:3].upper(),
                    "name": item.get("team_b"),
                    "flag_url": item.get("team_b_flag"),
                },
                "result": None,
                "live_score_a": item.get("score_a"),
                "live_score_b": item.get("score_b"),
                "channels": item.get("channels", []),
            }
        )

    known_numbers = {
        match["match_number"]
        for rows in grouped.values()
        for match in rows
        if match.get("match_number") is not None
    }
    for item in fetch_official_knockout_schedule():
        if item.get("match_number") in known_numbers:
            continue
        date_key = item["match_date"].date().isoformat() if item.get("match_date") else "sem-data"
        grouped.setdefault(date_key, []).append(
            {
                "id": f"official-{item['section']}",
                "phase": item["phase"],
                "group_name": None,
                "match_number": item["match_number"],
                "match_date": item["match_date"],
                "venue": item["venue"],
                "city": item["city"],
                "status": "scheduled",
                "status_raw": "",
                "team_a": {"code": item["team_a_label"], "name": item["team_a_label"], "flag_url": None},
                "team_b": {"code": item["team_b_label"], "name": item["team_b_label"], "flag_url": None},
                "result": None,
                "live_score_a": None,
                "live_score_b": None,
                "channels": [],
            }
        )

    for rows in grouped.values():
        rows.sort(key=lambda item: (item.get("match_date") or datetime.max, item.get("match_number") or 999))

    return {
        "updated_at": live_data.get("updated_at"),
        "days": [{"date": date, "matches": rows} for date, rows in sorted(grouped.items())],
    }


@router.get("/{match_id}", tags=["matches"])
def get_match(match_id: int, db: Session = Depends(get_db)):
    m = db.query(Match).options(
        joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result)
    ).filter(Match.id == match_id).first()
    if not m:
        raise HTTPException(404, "Match not found")
    _, live_lookup = _build_live_lookup()
    payload = _match_payload(m, live_lookup.get(_live_match_key(m.team_a.name, m.team_b.name)))
    payload["team_a"]["confederation"] = m.team_a.confederation.value if hasattr(m.team_a.confederation, "value") else str(m.team_a.confederation)
    payload["team_b"]["confederation"] = m.team_b.confederation.value if hasattr(m.team_b.confederation, "value") else str(m.team_b.confederation)
    if m.result:
        payload["result"] = {
            "score_a": m.result.score_a,
            "score_b": m.result.score_b,
            "xg_a": float(m.result.xg_a or 0),
            "xg_b": float(m.result.xg_b or 0),
        }
    return payload


@router.post("/{match_id}/simulate", response_model=MatchSimulationResponse)
def simulate_match_endpoint(
    match_id: int,
    n: int = Query(default=None, ge=10_000, le=2_000_000),
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    m = db.query(Match).options(joinedload(Match.team_a), joinedload(Match.team_b)).filter(
        Match.id == match_id
    ).first()
    if not m:
        raise HTTPException(404, "Match not found")

    simulations = n or settings.mc_simulations
    data_hash = _data_hash(m.team_a, m.team_b)
    cache_key = f"sim:{match_id}:{data_hash}:{simulations}"

    # Try Redis cache first (skip if force=true)
    if not force:
        try:
            r = _get_redis()
            cached_raw = r.get(cache_key)
            if cached_raw:
                result = json.loads(cached_raw)
                result["cached"] = True
                return result
        except Exception:
            pass

    ta = _team_to_input(m.team_a)
    tb = _team_to_input(m.team_b)

    lambda_a, lambda_b, weights_used = compute_weighted_lambdas(ta, tb, is_neutral=m.is_neutral)

    start = time.time()
    sim = simulate_match(lambda_a, lambda_b, n=simulations)
    elapsed = time.time() - start

    response = {
        "match_id": match_id,
        "team_a": m.team_a.code,
        "team_b": m.team_b.code,
        "prob_a": sim["prob_a"],
        "prob_draw": sim["prob_draw"],
        "prob_b": sim["prob_b"],
        "lambda_a": lambda_a,
        "lambda_b": lambda_b,
        "xg_a": lambda_a,
        "xg_b": lambda_b,
        "top_scores": sim["top_scores"],
        "model_weights": weights_used,
        "simulations": simulations,
        "elapsed_ms": round(elapsed * 1000),
        "cached": False,
    }

    # Persist in DB cache
    existing = db.query(SimulationCache).filter(SimulationCache.match_id == match_id).first()
    cache_obj = existing or SimulationCache(match_id=match_id)
    cache_obj.data_hash = data_hash
    cache_obj.prob_a = sim["prob_a"] / 100
    cache_obj.prob_draw = sim["prob_draw"] / 100
    cache_obj.prob_b = sim["prob_b"] / 100
    cache_obj.lambda_a = lambda_a
    cache_obj.lambda_b = lambda_b
    cache_obj.xg_a = lambda_a
    cache_obj.xg_b = lambda_b
    cache_obj.top_scores = sim["top_scores"]
    cache_obj.model_weights = weights_used
    cache_obj.simulations_count = simulations
    cache_obj.computed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    cache_obj.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=6)
    if not existing:
        db.add(cache_obj)
    db.commit()

    # Store in Redis (TTL 6h)
    try:
        r = _get_redis()
        r.setex(cache_key, 21600, json.dumps(response))
    except Exception:
        pass

    return response


@router.get("/{match_id}/live-bets")
def match_live_bets(
    match_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    match = db.query(Match).filter(Match.id == match_id).first()
    if not match:
        raise HTTPException(404, "Partida não encontrada")

    # Só expõe palpites alheios após o fechamento das apostas — evita copiar
    # picks de jogos ainda abertos (integridade do bolão).
    if _is_bet_open(match):
        raise HTTPException(403, "Palpites liberados só após o fechamento das apostas")

    bets = (
        db.query(Bet, User.name.label("user_name"))
        .join(User, Bet.user_id == User.id)
        .filter(Bet.match_id == match_id)
        .all()
    )

    rows = [
        {"user_name": user_name, "score_a": bet.score_a, "score_b": bet.score_b}
        for bet, user_name in bets
    ]
    rows.sort(key=lambda r: r["user_name"])

    return {"match_id": match_id, "total_bets": len(rows), "bets": rows}
