"""
Apostador IA (Bot) — gera palpites automaticamente usando Monte Carlo + Elo.

Estratégia:
  - Por partida: usa top_scores[0] do SimulationCache (placar mais provável do Monte Carlo).
    Fallback: modo da distribuição de Poisson via lambda_a/lambda_b.
  - Campeão/Vice: sort por prob_title do TournamentSimulation mais recente.
    Fallback: Elo das seleções.
"""

import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth_utils import get_current_user
from database import get_db
from models import (
    Bet, Match, MatchPhase, MatchResult, MatchStatus,
    Ranking, SimulationCache, Team, TournamentSimulation, User, UserRole
)
from routers.champion import ChampionPick
from world_cup_sync import _score_points_v2

BOT_EMAIL = "bot@predicts.info"
BOT_NAME  = "🤖 Predictor IA"
BOT_USER  = "predictor_ia"

router = APIRouter(prefix="/admin/bot", tags=["bot"])


def _require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(403, "Admin only")
    return user


def _get_bot(db: Session) -> User | None:
    return db.query(User).filter(User.email == BOT_EMAIL).first()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Predição de placar ─────────────────────────────────────────────────────────

def _poisson_mode(lam: float) -> int:
    """Moda da distribuição de Poisson para lambda dado."""
    if lam <= 0:
        return 0
    return max(0, int(math.floor(lam)))


def _predict_score(sim: SimulationCache | None, match: Match) -> tuple[int, int]:
    """
    Retorna (score_a, score_b) previsto pelo modelo.
    Prioridade: top_scores[0] do Monte Carlo > modo Poisson > Elo raw.
    """
    if sim and sim.top_scores:
        top = sim.top_scores[0]  # {"score": "1x0", "prob": 12.5}
        try:
            parts = str(top.get("score", "1x0")).split("x")
            return int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            pass

    if sim and sim.lambda_a is not None and sim.lambda_b is not None:
        return _poisson_mode(float(sim.lambda_a)), _poisson_mode(float(sim.lambda_b))

    # Fallback Elo puro
    ta = match.team_a
    tb = match.team_b
    if ta and tb:
        elo_a = float(ta.elo_rating or 1500)
        elo_b = float(tb.elo_rating or 1500)
        avg_a = float(ta.avg_goals_for or 1.35)
        avg_b = float(tb.avg_goals_for or 1.35)
        elo_factor = elo_a / max(elo_b, 1)
        la = avg_a * elo_factor / 1.35
        lb = avg_b / max(elo_factor, 0.01) / 1.35
        return _poisson_mode(la), _poisson_mode(lb)

    return 1, 0


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/create", status_code=201)
def create_bot(db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    existing = _get_bot(db)
    if existing:
        return {"status": "already_exists", "user_id": existing.id, "name": existing.name}

    from auth_utils import get_password_hash
    import secrets
    pw = secrets.token_urlsafe(32)
    bot = User(
        email=BOT_EMAIL,
        name=BOT_NAME,
        username=BOT_USER,
        password_hash=get_password_hash(pw),
        role=UserRole.user,
        theme="dark",
    )
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return {"status": "created", "user_id": bot.id, "name": bot.name}


@router.get("/status")
def bot_status(db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    bot = _get_bot(db)
    if not bot:
        return {"exists": False}

    ranking = db.query(Ranking).filter(Ranking.user_id == bot.id).first()
    total_bets = db.query(func.count(Bet.id)).filter(Bet.user_id == bot.id).scalar() or 0
    evaluated = db.query(Bet).filter(Bet.user_id == bot.id, Bet.evaluated_at.isnot(None)).all()

    exatos    = sum(1 for b in evaluated if b.points_earned == 25)
    certos    = sum(1 for b in evaluated if b.points_earned in (10, 12, 15, 18))
    erros     = sum(1 for b in evaluated if b.points_earned == 0)
    total_pts = ranking.total_points if ranking else 0

    # Posição no ranking
    pos = None
    if ranking:
        pos = db.query(func.count(Ranking.user_id)).filter(
            Ranking.total_points > total_pts
        ).scalar()
        pos = (pos or 0) + 1

    # Champion pick
    pick = db.query(ChampionPick).filter(ChampionPick.user_id == bot.id).first()
    champ_team = db.query(Team).filter(Team.id == pick.team_id).first() if pick else None
    vice_team  = db.query(Team).filter(Team.id == pick.runner_up_team_id).first() if (pick and pick.runner_up_team_id) else None

    return {
        "exists": True,
        "user_id": bot.id,
        "name": bot.name,
        "total_bets": total_bets,
        "evaluated": len(evaluated),
        "pending": total_bets - len(evaluated),
        "exatos": exatos,
        "certos": certos,
        "erros": erros,
        "total_points": total_pts,
        "ranking_position": pos,
        "champion": {"id": champ_team.id, "name": champ_team.name, "code": champ_team.code, "flag": champ_team.flag_url} if champ_team else None,
        "vice": {"id": vice_team.id, "name": vice_team.name, "code": vice_team.code, "flag": vice_team.flag_url} if vice_team else None,
    }


@router.post("/bet")
def bot_bet(
    phase: str | None = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(_require_admin),
):
    """
    Gera palpites para todas as partidas abertas sem aposta do bot.
    Se phase informado, filtra só essa fase (ex: 'group', 'r16').
    """
    bot = _get_bot(db)
    if not bot:
        raise HTTPException(400, "Bot não criado. Use POST /admin/bot/create primeiro.")

    now = _utcnow()

    q = db.query(Match).filter(Match.status == MatchStatus.scheduled)
    if phase:
        try:
            q = q.filter(Match.phase == MatchPhase(phase))
        except ValueError:
            raise HTTPException(400, f"Fase inválida: {phase}")

    matches = q.all()

    existing_ids = {
        b.match_id
        for b in db.query(Bet.match_id).filter(Bet.user_id == bot.id).all()
    }

    created = []
    skipped_closed = 0
    skipped_exists = 0

    for match in matches:
        if match.id in existing_ids:
            skipped_exists += 1
            continue

        # Verifica se aposta ainda está aberta
        deadline = match.bet_deadline or match.match_date
        if deadline and now >= deadline:
            skipped_closed += 1
            continue

        sim = (
            db.query(SimulationCache)
            .filter(SimulationCache.match_id == match.id)
            .first()
        )
        sa, sb = _predict_score(sim, match)

        bet = Bet(
            user_id=bot.id,
            match_id=match.id,
            score_a=sa,
            score_b=sb,
            locked_at=match.match_date,
        )
        db.add(bet)
        created.append({
            "match_id": match.id,
            "team_a": match.team_a.code if match.team_a else "?",
            "team_b": match.team_b.code if match.team_b else "?",
            "predicted": f"{sa}x{sb}",
            "source": "monte_carlo" if (sim and sim.top_scores) else ("poisson" if (sim and sim.lambda_a) else "elo"),
        })

    db.commit()

    return {
        "created": len(created),
        "skipped_exists": skipped_exists,
        "skipped_closed": skipped_closed,
        "bets": created,
    }


@router.post("/pick-champion")
def bot_pick_champion(db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    """
    Escolhe campeão e vice via TournamentSimulation (prob_title).
    Fallback: Elo das seleções ainda ativas.
    """
    bot = _get_bot(db)
    if not bot:
        raise HTTPException(400, "Bot não criado.")

    champion_id = None
    vice_id     = None

    # Tenta TournamentSimulation
    latest_sim = (
        db.query(TournamentSimulation)
        .order_by(TournamentSimulation.computed_at.desc())
        .first()
    )
    if latest_sim and latest_sim.results:
        sorted_teams = sorted(
            latest_sim.results.items(),
            key=lambda kv: float(kv[1].get("prob_title", 0)),
            reverse=True,
        )
        if len(sorted_teams) >= 1:
            champion_id = int(sorted_teams[0][0])
        if len(sorted_teams) >= 2:
            vice_id = int(sorted_teams[1][0])

    # Fallback: Elo
    if not champion_id or not vice_id:
        top_teams = (
            db.query(Team)
            .order_by(Team.elo_rating.desc())
            .limit(2)
            .all()
        )
        if len(top_teams) >= 1:
            champion_id = top_teams[0].id
        if len(top_teams) >= 2:
            vice_id = top_teams[1].id

    if not champion_id:
        raise HTTPException(500, "Não foi possível determinar campeão.")

    pick = db.query(ChampionPick).filter(ChampionPick.user_id == bot.id).first()
    if pick:
        pick.team_id          = champion_id
        pick.runner_up_team_id = vice_id
        pick.picked_at        = _utcnow()
    else:
        pick = ChampionPick(
            user_id=bot.id,
            team_id=champion_id,
            runner_up_team_id=vice_id,
            picked_at=_utcnow(),
        )
        db.add(pick)

    db.commit()

    champ = db.query(Team).filter(Team.id == champion_id).first()
    vice  = db.query(Team).filter(Team.id == vice_id).first() if vice_id else None

    return {
        "champion": {"id": champ.id, "name": champ.name, "code": champ.code} if champ else None,
        "vice":     {"id": vice.id,  "name": vice.name,  "code": vice.code } if vice  else None,
        "source":   "simulation" if latest_sim else "elo",
    }


@router.get("/bets")
def bot_bets(db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    """Lista todas as apostas do bot com resultado e performance por rodada."""
    bot = _get_bot(db)
    if not bot:
        return {"bets": [], "by_phase": {}}

    bets = (
        db.query(Bet)
        .filter(Bet.user_id == bot.id)
        .join(Bet.match)
        .order_by(Match.match_date.desc().nullslast(), Match.id.desc())
        .all()
    )

    def _outcome(b: Bet) -> str | None:
        if b.evaluated_at is None:
            return None
        if b.points_earned == 25:
            return "exact"
        if b.points_earned and b.points_earned > 0:
            return "correct"
        return "wrong"

    rows = []
    by_phase: dict[str, dict] = {}

    for b in bets:
        m = b.match
        r = m.result if m else None
        outcome = _outcome(b)
        phase = (m.phase.value if m and m.phase else "group")

        row = {
            "id": b.id,
            "match_id": b.match_id,
            "phase": phase,
            "match_date": m.match_date if m else None,
            "team_a_code": m.team_a.code if m and m.team_a else "?",
            "team_b_code": m.team_b.code if m and m.team_b else "?",
            "team_a_flag": m.team_a.flag_url if m and m.team_a else None,
            "team_b_flag": m.team_b.flag_url if m and m.team_b else None,
            "predicted_a": b.score_a,
            "predicted_b": b.score_b,
            "official_a": r.score_a if r else None,
            "official_b": r.score_b if r else None,
            "points": b.points_earned,
            "outcome": outcome,
        }
        rows.append(row)

        if phase not in by_phase:
            by_phase[phase] = {"total": 0, "evaluated": 0, "exatos": 0, "certos": 0, "erros": 0, "points": 0}
        bp = by_phase[phase]
        bp["total"] += 1
        if outcome is not None:
            bp["evaluated"] += 1
            bp["points"] += b.points_earned or 0
            if outcome == "exact":   bp["exatos"] += 1
            elif outcome == "correct": bp["certos"] += 1
            else: bp["erros"] += 1

    return {"bets": rows, "by_phase": by_phase}


# ── Endpoint público (sem autenticação) ────────────────────────────────────────

public_router = APIRouter(prefix="/bot", tags=["bot-public"])


@public_router.get("/public")
def bot_public(db: Session = Depends(get_db)):
    """Performance pública do Apostador IA — acessível a todos os usuários."""
    bot = _get_bot(db)
    if not bot:
        return {"exists": False}

    ranking = db.query(Ranking).filter(Ranking.user_id == bot.id).first()
    total_bets = db.query(func.count(Bet.id)).filter(Bet.user_id == bot.id).scalar() or 0
    evaluated = db.query(Bet).filter(Bet.user_id == bot.id, Bet.evaluated_at.isnot(None)).all()

    exatos    = sum(1 for b in evaluated if b.points_earned == 25)
    certos    = sum(1 for b in evaluated if b.points_earned in (10, 12, 15, 18))
    erros     = sum(1 for b in evaluated if b.points_earned == 0)
    total_pts = ranking.total_points if ranking else 0

    pos = None
    if ranking:
        pos = db.query(func.count(Ranking.user_id)).filter(
            Ranking.total_points > total_pts
        ).scalar()
        pos = (pos or 0) + 1

    pick = db.query(ChampionPick).filter(ChampionPick.user_id == bot.id).first()
    champ_team = db.query(Team).filter(Team.id == pick.team_id).first() if pick else None
    vice_team  = db.query(Team).filter(Team.id == pick.runner_up_team_id).first() if (pick and pick.runner_up_team_id) else None

    # Bets com resultado (últimas 20 avaliadas)
    recent_bets = (
        db.query(Bet)
        .filter(Bet.user_id == bot.id, Bet.evaluated_at.isnot(None))
        .join(Bet.match)
        .order_by(Match.match_date.desc().nullslast())
        .limit(20)
        .all()
    )

    def _outcome(b: Bet) -> str | None:
        if b.evaluated_at is None: return None
        if b.points_earned == 25: return "exact"
        if b.points_earned and b.points_earned > 0: return "correct"
        return "wrong"

    by_phase: dict[str, dict] = {}
    recent_rows = []
    for b in recent_bets:
        m = b.match
        r = m.result if m else None
        outcome = _outcome(b)
        phase = m.phase.value if m and m.phase else "group"
        if phase not in by_phase:
            by_phase[phase] = {"total": 0, "evaluated": 0, "exatos": 0, "certos": 0, "erros": 0, "points": 0}
        bp = by_phase[phase]
        bp["total"] += 1
        if outcome is not None:
            bp["evaluated"] += 1
            bp["points"] += b.points_earned or 0
            if outcome == "exact": bp["exatos"] += 1
            elif outcome == "correct": bp["certos"] += 1
            else: bp["erros"] += 1
        recent_rows.append({
            "match_date": m.match_date if m else None,
            "team_a_code": m.team_a.code if m and m.team_a else "?",
            "team_b_code": m.team_b.code if m and m.team_b else "?",
            "team_a_flag": m.team_a.flag_url if m and m.team_a else None,
            "team_b_flag": m.team_b.flag_url if m and m.team_b else None,
            "predicted_a": b.score_a, "predicted_b": b.score_b,
            "official_a": r.score_a if r else None,
            "official_b": r.score_b if r else None,
            "points": b.points_earned, "outcome": outcome,
        })

    return {
        "exists": True,
        "name": bot.name,
        "total_bets": total_bets,
        "evaluated": len(evaluated),
        "exatos": exatos,
        "certos": certos,
        "erros": erros,
        "total_points": total_pts,
        "ranking_position": pos,
        "champion": {"name": champ_team.name, "code": champ_team.code, "flag": champ_team.flag_url} if champ_team else None,
        "vice": {"name": vice_team.name, "code": vice_team.code, "flag": vice_team.flag_url} if vice_team else None,
        "recent_bets": recent_rows,
        "by_phase": by_phase,
    }
