"""
Router admin-only do Bot Squad — gestão das 20 personas, master switch, tick
manual (dry-run) e auditoria de apostas de bot.

GET   /admin/bot-squad/overview               painel (personas + reviews + flag)
PATCH /admin/bot-squad/personas/{persona_id}   editar bio/params/enabled/time
POST  /admin/bot-squad/toggle                  master switch (site_config)
POST  /admin/bot-squad/run                     tick manual (dry_run=true por padrão)
GET   /admin/bot-squad/bets                    apostas de bot com bot_reason

Nunca serializa `is_bot` — endpoints são admin-only, mas por padrão de casa
(consistência com o resto do payload) o campo simplesmente não aparece.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from auth_utils import require_admin
from bot_squad import place_pending_bets, preview_pending_bets, run_t3_reviews
from competitions import get_competition_id
from database import get_db
from models import (
    Bet, BotPersona, BotSquadReview, Match, MatchStatus, Ranking, SiteConfig,
    Team, User, UserGroup,
)

router = APIRouter(prefix="/admin/bot-squad", tags=["bot-squad"])

BOT_SQUAD_LEAGUE_NAME = "Boteco do Placar"  # busca por nome — NUNCA hardcode o id (ver skill predicts)
ALLOWED_PARAM_KEYS = {"risk", "draw_affinity", "goals_bias", "fav_boost", "stubbornness", "jitter_hours"}
UPCOMING_REVIEW_WINDOW = timedelta(hours=6)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _bot_squad_enabled(db: Session) -> bool:
    row = db.query(SiteConfig).filter(SiteConfig.key == "bot_squad_enabled").first()
    return bool(row and (row.value or "").strip().lower() == "true")


# ─── GET /overview ──────────────────────────────────────────────────────────

@router.get("/overview")
def overview(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    now = _utcnow()

    league_row = db.query(UserGroup).filter(UserGroup.name == BOT_SQUAD_LEAGUE_NAME).first()
    league = {"id": league_row.id, "name": league_row.name} if league_row else None

    copa_id = get_competition_id(db, "copa2026")
    br_id = get_competition_id(db, "brasileirao2026")
    comp_ids = [cid for cid in (copa_id, br_id) if cid is not None]

    persona_rows = (
        db.query(BotPersona, User.name, User.username)
        .join(User, User.id == BotPersona.user_id)
        .filter(User.is_bot.is_(True))
        .order_by(BotPersona.id)
        .all()
    )
    bot_user_ids = [p.user_id for p, _, _ in persona_rows]

    fav_codes = {p.favorite_team_code for p, _, _ in persona_rows if p.favorite_team_code}
    team_by_code = (
        {t.code: t for t in db.query(Team).filter(Team.code.in_(fav_codes)).all()}
        if fav_codes else {}
    )

    bets_total_map: dict[int, int] = {}
    last_bet_map: dict[int, datetime] = {}
    ranking_copa_map: dict[int, int] = {}
    ranking_br_map: dict[int, int] = {}
    exact_map: dict[int, int] = {}
    correct_map: dict[int, int] = {}
    if bot_user_ids:
        bets_total_map = dict(
            db.query(Bet.user_id, func.count(Bet.id))
            .filter(Bet.user_id.in_(bot_user_ids))
            .group_by(Bet.user_id)
            .all()
        )
        last_bet_map = dict(
            db.query(Bet.user_id, func.max(Bet.created_at))
            .filter(Bet.user_id.in_(bot_user_ids))
            .group_by(Bet.user_id)
            .all()
        )
        if copa_id is not None:
            ranking_copa_map = dict(
                db.query(Ranking.user_id, Ranking.total_points)
                .filter(Ranking.user_id.in_(bot_user_ids), Ranking.competition_id == copa_id)
                .all()
            )
        if br_id is not None:
            ranking_br_map = dict(
                db.query(Ranking.user_id, Ranking.total_points)
                .filter(Ranking.user_id.in_(bot_user_ids), Ranking.competition_id == br_id)
                .all()
            )
        # Cravados/acertos somados entre as 2 competições (mesma régua da Ranking, ver GET /ranking).
        for uid, exact, correct in (
            db.query(
                Ranking.user_id,
                func.coalesce(func.sum(Ranking.exact_scores), 0),
                func.coalesce(func.sum(Ranking.correct_results), 0),
            )
            .filter(Ranking.user_id.in_(bot_user_ids), Ranking.competition_id.in_(comp_ids))
            .group_by(Ranking.user_id)
            .all()
        ):
            exact_map[uid] = exact
            correct_map[uid] = correct

    personas = [
        {
            "id": persona.id,
            "user_id": persona.user_id,
            "name": name,
            "username": username,
            "archetype": persona.archetype,
            "bio": persona.bio,
            "favorite_team_code": persona.favorite_team_code,
            "favorite_team_name": team_by_code[persona.favorite_team_code].name if persona.favorite_team_code in team_by_code else None,
            "favorite_team_flag_url": team_by_code[persona.favorite_team_code].flag_url if persona.favorite_team_code in team_by_code else None,
            "params": persona.params or {},
            "enabled": persona.enabled,
            "bets_total": bets_total_map.get(persona.user_id, 0),
            "points_copa": ranking_copa_map.get(persona.user_id, 0),
            "points_br": ranking_br_map.get(persona.user_id, 0),
            "exact_scores": exact_map.get(persona.user_id, 0),
            "correct_results": correct_map.get(persona.user_id, 0),
            "last_bet_at": last_bet_map[persona.user_id].isoformat() if last_bet_map.get(persona.user_id) else None,
        }
        for persona, name, username in persona_rows
    ]

    # ── Próximas revisões T-3h: jogos scheduled das 2 comps nas próximas 6h,
    #    ainda sem BotSquadReview ────────────────────────────────────────────
    upcoming_reviews = []
    if comp_ids:
        reviewed_ids = {mid for (mid,) in db.query(BotSquadReview.match_id).all()}
        window_end = now + UPCOMING_REVIEW_WINDOW
        matches = (
            db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .filter(
                Match.competition_id.in_(comp_ids),
                Match.status == MatchStatus.scheduled,
                Match.match_date.isnot(None),
                Match.match_date > now,
                Match.match_date <= window_end,
            )
            .order_by(Match.match_date)
            .all()
        )
        matches = [m for m in matches if m.id not in reviewed_ids]
        match_ids = [m.id for m in matches]
        bots_per_match: dict[int, int] = {}
        if match_ids and bot_user_ids:
            bots_per_match = dict(
                db.query(Bet.match_id, func.count(Bet.id))
                .filter(Bet.match_id.in_(match_ids), Bet.user_id.in_(bot_user_ids))
                .group_by(Bet.match_id)
                .all()
            )
        upcoming_reviews = [
            {
                "match_id": m.id,
                "teams": f"{m.team_a.name} x {m.team_b.name}",
                "kickoff": m.match_date.isoformat() if m.match_date else None,
                "bots_com_aposta": bots_per_match.get(m.id, 0),
            }
            for m in matches
        ]

    # ── Últimas 10 revisões ─────────────────────────────────────────────────
    reviews = (
        db.query(BotSquadReview)
        .order_by(BotSquadReview.reviewed_at.desc())
        .limit(10)
        .all()
    )
    review_match_ids = [r.match_id for r in reviews]
    match_map = {}
    if review_match_ids:
        match_map = {
            m.id: m
            for m in db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .filter(Match.id.in_(review_match_ids))
            .all()
        }
    recent_reviews = [
        {
            "match_id": r.match_id,
            "teams": (
                f"{match_map[r.match_id].team_a.name} x {match_map[r.match_id].team_b.name}"
                if r.match_id in match_map else None
            ),
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "adjusted_count": r.adjusted_count,
            "kept_count": r.kept_count,
            "summary": r.summary,
            "telegram_sent": r.telegram_sent,
        }
        for r in reviews
    ]

    return {
        "enabled": _bot_squad_enabled(db),
        "league": league,
        "personas": personas,
        "upcoming_reviews": upcoming_reviews,
        "recent_reviews": recent_reviews,
    }


# ─── PATCH /personas/{persona_id} ───────────────────────────────────────────

class PersonaPatchIn(BaseModel):
    bio: str | None = None
    favorite_team_code: str | None = None
    enabled: bool | None = None
    params: dict | None = None


def _validate_params(incoming: dict, current: dict) -> dict:
    if not isinstance(incoming, dict):
        raise HTTPException(400, "params deve ser um objeto")
    unknown = set(incoming.keys()) - ALLOWED_PARAM_KEYS
    if unknown:
        raise HTTPException(400, f"chaves de params desconhecidas: {sorted(unknown)}")

    validated = {}
    for key, value in incoming.items():
        if key == "jitter_hours":
            try:
                ival = int(value)
            except (TypeError, ValueError):
                raise HTTPException(400, "jitter_hours deve ser inteiro")
            if not (1 <= ival <= 120):
                raise HTTPException(400, "jitter_hours deve estar entre 1 e 120")
            validated[key] = ival
            continue
        try:
            fval = float(value)
        except (TypeError, ValueError):
            raise HTTPException(400, f"{key} deve ser numérico")
        if key == "goals_bias":
            if not (-1.0 <= fval <= 1.0):
                raise HTTPException(400, "goals_bias deve estar entre -1 e 1")
        elif not (0.0 <= fval <= 1.0):
            raise HTTPException(400, f"{key} deve estar entre 0 e 1")
        validated[key] = fval

    merged = dict(current or {})
    merged.update(validated)
    return merged


@router.patch("/personas/{persona_id}")
def update_persona(
    persona_id: int,
    body: PersonaPatchIn,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    persona = db.query(BotPersona).filter(BotPersona.id == persona_id).first()
    if not persona:
        raise HTTPException(404, "Persona não encontrada")

    data = body.dict(exclude_unset=True)

    if "bio" in data:
        bio = data["bio"]
        persona.bio = bio.strip() if isinstance(bio, str) and bio.strip() else None

    if "favorite_team_code" in data:
        code = data["favorite_team_code"]
        if code is not None:
            code = code.strip().upper()
            if not code:
                code = None
            elif not db.query(Team.id).filter(Team.code == code).first():
                raise HTTPException(400, f"Time '{code}' não encontrado")
        persona.favorite_team_code = code

    if "enabled" in data:
        if not isinstance(data["enabled"], bool):
            raise HTTPException(400, "enabled deve ser booleano")
        persona.enabled = data["enabled"]

    if "params" in data:
        incoming = data["params"] or {}
        persona.params = _validate_params(incoming, persona.params or {})

    db.commit()
    db.refresh(persona)

    team = (
        db.query(Team).filter(Team.code == persona.favorite_team_code).first()
        if persona.favorite_team_code else None
    )

    return {
        "id": persona.id,
        "user_id": persona.user_id,
        "archetype": persona.archetype,
        "bio": persona.bio,
        "favorite_team_code": persona.favorite_team_code,
        "favorite_team_name": team.name if team else None,
        "favorite_team_flag_url": team.flag_url if team else None,
        "enabled": persona.enabled,
        "params": persona.params or {},
    }


# ─── POST /toggle ────────────────────────────────────────────────────────────

class ToggleIn(BaseModel):
    enabled: bool


@router.post("/toggle")
def toggle(body: ToggleIn, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    value = "true" if body.enabled else "false"
    row = db.query(SiteConfig).filter(SiteConfig.key == "bot_squad_enabled").first()
    if row:
        row.value = value
        row.updated_at = _utcnow()
    else:
        db.add(SiteConfig(key="bot_squad_enabled", value=value))
    db.commit()
    return {"enabled": body.enabled}


# ─── POST /run?dry_run= ─────────────────────────────────────────────────────

@router.post("/run")
def run(
    dry_run: bool = True,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Tick manual do worker. `dry_run=true` (padrão) SÓ LISTA o que
    `place_pending_bets` faria (mesma janela/jitter, sem gravar nada).
    `dry_run=false` roda `place_pending_bets` + `run_t3_reviews` de verdade."""
    if dry_run:
        preview = preview_pending_bets(db)
        return {"dry_run": True, **preview}

    placed = place_pending_bets(db)
    reviews = run_t3_reviews(db)
    return {"dry_run": False, "placed": placed, "reviews": reviews}


# ─── GET /bets ───────────────────────────────────────────────────────────────

@router.get("/bets")
def list_bets(
    match_id: int | None = None,
    persona_id: int | None = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    q = (
        db.query(Bet, User.name.label("persona_name"), Match)
        .join(User, User.id == Bet.user_id)
        .join(Match, Match.id == Bet.match_id)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
        .filter(User.is_bot.is_(True))
    )
    if match_id is not None:
        q = q.filter(Bet.match_id == match_id)
    if persona_id is not None:
        persona = db.query(BotPersona).filter(BotPersona.id == persona_id).first()
        if not persona:
            raise HTTPException(404, "Persona não encontrada")
        q = q.filter(Bet.user_id == persona.user_id)

    rows = q.order_by(Bet.created_at.desc()).limit(limit).all()

    items = []
    for bet, persona_name, match in rows:
        result = match.result
        items.append({
            "bet_id": bet.id,
            "match_id": bet.match_id,
            "teams": f"{match.team_a.name} x {match.team_b.name}",
            "persona_name": persona_name,
            "user_id": bet.user_id,
            "score": f"{bet.score_a}x{bet.score_b}",
            "et_winner_pick": bet.et_winner_pick,
            "bot_reason": bet.bot_reason,
            "points_earned": bet.points_earned if bet.evaluated_at else None,
            "result_score": f"{result.score_a}x{result.score_b}" if result else None,
            "created_at": bet.created_at.isoformat() if bet.created_at else None,
        })

    return {"total": len(items), "bets": items}
