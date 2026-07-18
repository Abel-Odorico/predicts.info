"""
Apostador IA (Bot) — gera palpites automaticamente usando Monte Carlo + Elo.

Estratégia:
  - Por partida: usa top_scores[0] do SimulationCache (placar mais provável do Monte Carlo).
    Fallback: modo da distribuição de Poisson via lambda_a/lambda_b.
  - Campeão/Vice: sort por prob_title do TournamentSimulation mais recente.
    Fallback: Elo das seleções.
"""

import html as _html
import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from auth_utils import get_current_user
from database import get_db
from models import (
    Bet, BotDecisionLog, Match, MatchPhase, MatchResult, MatchStatus,
    Ranking, SimulationCache, Team, TournamentSimulation, User, UserRole
)
from engine.poisson import pick_recommended_score
from routers.champion import ChampionPick
from competitions import get_competition_id
from world_cup_sync import _score_points_v2

BOT_EMAIL = "bot@predicts.info"
BOT_NAME  = "🔮 Oráculo Predictor"
BOT_USER  = "predictor_ia"

# Extensão pro Brasileirão (2026-07-18): Oráculo passa a cobrir brasileirao2026
# além de copa2026. copa2026 nunca precisou de janela de data no /bet em lote
# porque suas partidas só existem no banco progressivamente (mata-mata é criado
# conforme a fase anterior termina). O Brasileirão já tem as 380 partidas da
# temporada inteira pré-carregadas — sem essa janela, "apostar em lote" faria
# o bot apostar em rodadas distantes de uma vez. Só se aplica a competições
# kind="league" (Copa é "cup", fica intocada).
BOT_BATCH_LEAGUE_WINDOW_DAYS = 3

router = APIRouter(prefix="/admin/bot", tags=["bot"])


def _bot_competition_ids(db: Session) -> list[int]:
    """IDs das competições que o Oráculo cobre hoje: copa2026 + brasileirao2026."""
    copa_id = get_competition_id(db)
    br_id = get_competition_id(db, "brasileirao2026")
    return [c for c in (copa_id, br_id) if c is not None]


def _bot_competition_stats(db: Session, bot_id: int, comp_id: int | None) -> dict:
    """Stats do bot (apostas/pontos/posição) escopados numa única competição."""
    empty = {
        "total_bets": 0, "evaluated": 0, "pending": 0,
        "exatos": 0, "certos": 0, "erros": 0,
        "total_points": 0, "ranking_position": None,
    }
    if comp_id is None:
        return empty
    ranking = db.query(Ranking).filter(
        Ranking.user_id == bot_id, Ranking.competition_id == comp_id
    ).first()
    bets_q = db.query(Bet).filter(Bet.user_id == bot_id, Bet.competition_id == comp_id)
    total_bets = bets_q.count()
    evaluated = bets_q.filter(Bet.evaluated_at.isnot(None)).all()

    exatos = sum(1 for b in evaluated if b.points_earned == 25)
    certos = sum(1 for b in evaluated if b.points_earned in (10, 12, 15, 18))
    erros  = sum(1 for b in evaluated if b.points_earned == 0)
    total_pts = ranking.total_points if ranking else 0

    pos = None
    if ranking:
        pos = db.query(func.count(Ranking.user_id)).filter(
            Ranking.competition_id == comp_id,
            Ranking.total_points > total_pts,
        ).scalar()
        pos = (pos or 0) + 1

    return {
        "total_bets": total_bets, "evaluated": len(evaluated),
        "pending": total_bets - len(evaluated),
        "exatos": exatos, "certos": certos, "erros": erros,
        "total_points": total_pts, "ranking_position": pos,
    }


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
    Prioridade: placar recomendado (condicionado ao resultado mais provável
    do Monte Carlo) > modo Poisson > Elo raw.
    """
    if sim and sim.top_scores:
        top = pick_recommended_score(
            sim.top_scores, float(sim.prob_a or 0), float(sim.prob_draw or 0), float(sim.prob_b or 0)
        )
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

    copa_id = get_competition_id(db)
    copa_stats = _bot_competition_stats(db, bot.id, copa_id)

    # Bloco Brasileirão — aditivo, nunca derruba o status da Copa se falhar.
    br_stats = None
    try:
        br_id = get_competition_id(db, "brasileirao2026")
        if br_id is not None:
            br_stats = _bot_competition_stats(db, bot.id, br_id)
    except Exception as e:
        print(f"[bot_status] stats Brasileirão falharam (ignorado): {e}", flush=True)

    # Champion pick
    pick = db.query(ChampionPick).filter(ChampionPick.user_id == bot.id).first()
    champ_team = db.query(Team).filter(Team.id == pick.team_id).first() if pick else None
    vice_team  = db.query(Team).filter(Team.id == pick.runner_up_team_id).first() if (pick and pick.runner_up_team_id) else None

    return {
        "exists": True,
        "user_id": bot.id,
        "name": bot.name,
        **copa_stats,
        "brasileirao": br_stats,
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

    comp_ids = _bot_competition_ids(db)
    q = db.query(Match).filter(
        Match.status == MatchStatus.scheduled,
        Match.competition_id.in_(comp_ids),
    )
    if phase:
        try:
            q = q.filter(Match.phase == MatchPhase(phase))
        except ValueError:
            raise HTTPException(400, f"Fase inválida: {phase}")

    matches = q.all()

    # Competições "league" (Brasileirão) já têm a temporada inteira no banco —
    # sem essa janela, apostar em lote bateria em rodadas bem distantes de uma
    # vez só. Copa é "cup" (não afetada — bracket só existe conforme avança).
    from models import Competition
    league_ids = {
        cid for (cid,) in db.query(Competition.id)
        .filter(Competition.kind == "league", Competition.id.in_(comp_ids))
        .all()
    }
    if league_ids:
        horizon_batch = now + timedelta(days=BOT_BATCH_LEAGUE_WINDOW_DAYS)
        matches = [
            m for m in matches
            if m.competition_id not in league_ids or (m.match_date and m.match_date <= horizon_batch)
        ]

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
            competition_id=match.competition_id,
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
        pick.team_id           = champion_id
        pick.runner_up_team_id = vice_id
    else:
        pick = ChampionPick(
            user_id=bot.id,
            team_id=champion_id,
            runner_up_team_id=vice_id,
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
        .order_by(Match.match_date.asc().nullslast(), Match.id.asc())
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

    br_id = get_competition_id(db, "brasileirao2026")

    rows = []
    by_phase: dict[str, dict] = {}

    for b in bets:
        m = b.match
        r = m.result if m else None
        outcome = _outcome(b)
        phase = (m.phase.value if m and m.phase else "group")
        # Brasileirão é sempre phase=group — sem isso, o balde "group" agregado
        # aqui embaixo misturaria fase de grupos da Copa com rodadas do
        # Brasileirão (times/pontos diferentes, mesma chave). Balde próprio.
        phase_key = "brasileirao" if (br_id is not None and b.competition_id == br_id) else phase

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

        if phase_key not in by_phase:
            by_phase[phase_key] = {"total": 0, "evaluated": 0, "exatos": 0, "certos": 0, "erros": 0, "points": 0}
        bp = by_phase[phase_key]
        bp["total"] += 1
        if outcome is not None:
            bp["evaluated"] += 1
            bp["points"] += b.points_earned or 0
            if outcome == "exact":   bp["exatos"] += 1
            elif outcome == "correct": bp["certos"] += 1
            else: bp["erros"] += 1

    return {"bets": rows, "by_phase": by_phase}


# ── Oráculo Predictor — IA dedicada + re-análise pré-jogo ────────────────────────

# Config própria do Oráculo (site_config, prefixo oracle_*), independente da
# análise de partidas. Fallback: herda a config de análise geral se nada definido.
ORACLE_CONFIG_KEYS = (
    "oracle_provider",
    "oracle_gemini_key", "oracle_gemini_model",
    "oracle_openrouter_key", "oracle_openrouter_model",
    "oracle_openai_key", "oracle_openai_model",
    "oracle_fallback_enabled",
)

ORACLE_DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
ORACLE_DEFAULT_OR_MODEL     = "meta-llama/llama-3.3-70b-instruct:free"

# Gate de confiança: LLM só pode divergir do baseline estatístico (Monte Carlo/Elo)
# se tiver confiança >= threshold OU houver desfalque relevante (lesão/suspensão).
# Motivo: dados reais mostram que divergências do baseline sem esse filtro derrubam
# a taxa de acerto de placar exato pela metade (11% -> 3.8% no histórico do Oráculo).
ORACLE_CONFIDENCE_GATE = 85


def _oracle_raw_config(db: Session) -> dict:
    from sqlalchemy import text
    rows = db.execute(
        text("SELECT key, value FROM site_config WHERE key = ANY(:keys)"),
        {"keys": list(ORACLE_CONFIG_KEYS)},
    ).fetchall()
    return {r[0]: r[1] for r in rows}


def _oracle_llm_cfg(db: Session) -> tuple[dict, str]:
    """
    Monta o cfg (formato esperado por analysis._call_llm) para a IA DEDICADA do
    Oráculo. Se nenhuma chave própria existir, herda a IA de análise geral.
    Retorna (cfg, origem).
    """
    from routers.analysis import _get_config
    raw = _oracle_raw_config(db)
    has_own = any(raw.get(k) for k in ("oracle_gemini_key", "oracle_openrouter_key", "oracle_openai_key"))
    if not has_own:
        return _get_config(db), "herdado (análise geral)"
    cfg = {
        "provider":         raw.get("oracle_provider", "gemini"),
        "gemini_key":       raw.get("oracle_gemini_key", ""),
        "gemini_key_2":     "",
        "gemini_model":     raw.get("oracle_gemini_model", ORACLE_DEFAULT_GEMINI_MODEL),
        "openai_key":       raw.get("oracle_openai_key", ""),
        "openai_model":     raw.get("oracle_openai_model", "gpt-4o-mini"),
        "openrouter_key":   raw.get("oracle_openrouter_key", ""),
        "openrouter_model": raw.get("oracle_openrouter_model", ORACLE_DEFAULT_OR_MODEL),
        "prompt_template":  "",
    }
    return cfg, "dedicada"


def pick_oracle_llm(db: Session) -> tuple[dict | None, str | None, str]:
    """
    Escolhe a melhor IA disponível para o Oráculo (1ª da cadeia de fallback).
    Retorna (cfg, label_do_modelo, origem). cfg=None se nada configurado.
    """
    from routers.analysis import _get_provider_chain
    cfg, origin = _oracle_llm_cfg(db)
    chain = _get_provider_chain(cfg)
    if not chain:
        return None, None, origin
    return cfg, chain[0]["label"], origin


def _build_oracle_prompt(db: Session, match: Match, base: tuple[int, int]) -> str:
    from routers.analysis import _get_mc_prob, _get_recent_results
    from models import Player
    ta, tb = match.team_a, match.team_b

    mc = _get_mc_prob(db, match.id)
    # Busca mais resultados recentes para contexto mais rico
    ra = _get_recent_results(db, ta.code, limit=7) if ta else []
    rb = _get_recent_results(db, tb.code, limit=7) if tb else []

    # Convocados ordenados por posição (igual ao prompt de análise)
    pos_order  = {"FW": 0, "MF": 1, "DF": 2, "GK": 3}
    pos_label  = {"FW": "ATA", "MF": "MEI", "DF": "DEF", "GK": "GOL"}

    def fmt_players(team_id: int) -> str:
        players = db.query(Player).filter_by(team_id=team_id).all()
        if not players:
            return "  (sem dados de convocados)"
        priority = [p for p in players if p.is_injured or p.is_suspended]
        rest     = [p for p in players if not p.is_injured and not p.is_suspended]
        selected = sorted(priority + rest, key=lambda p: pos_order.get(p.position, 9))[:15]
        lines, cur = [], None
        for p in selected:
            lbl = pos_label.get(p.position, p.position or "?")
            if lbl != cur:
                lines.append(f"  [{lbl}]")
                cur = lbl
            suffix = " ⚠️" if p.is_injured else " 🚫" if p.is_suspended else ""
            lines.append(f"    • {p.name}{suffix}")
        return "\n".join(lines)

    def fmt_results(results) -> str:
        if not results:
            return "  Sem dados desta Copa"
        return "\n".join(
            f"  {r['date']}: {r['team_a']} {r['score_a']}–{r['score_b']} {r['team_b']}"
            for r in results
        )

    # Confronto direto nesta Copa
    def fmt_h2h() -> str:
        codes = {ta.code, tb.code}
        h2h = [r for r in (ra + rb) if r["team_a"] in codes and r["team_b"] in codes]
        seen, uniq = set(), []
        for r in h2h:
            k = (r["team_a"], r["team_b"], r["date"])
            if k not in seen:
                seen.add(k)
                uniq.append(r)
        if not uniq:
            return "  Não se enfrentaram ainda nesta Copa"
        return "\n".join(
            f"  {r['date']}: {r['team_a']} {r['score_a']}–{r['score_b']} {r['team_b']}"
            for r in uniq[:3]
        )

    # Bloco Monte Carlo enriquecido (top 8 placares)
    mc_block = "indisponível"
    if mc:
        top = "  |  ".join(
            f"{s['score']} ({s['prob']:.1f}%)" for s in mc.get("top_scores", [])[:8]
        )
        mc_block = (
            f"Vitória {ta.name}: {mc['prob_a']:.1f}% | Empate: {mc['prob_draw']:.1f}% | Vitória {tb.name}: {mc['prob_b']:.1f}%\n"
            f"xG esperado: {ta.name} {mc['lambda_a']:.2f} gols × {tb.name} {mc['lambda_b']:.2f} gols\n"
            f"Top placares (Monte Carlo 50k sims): {top}"
        )

    phase = match.phase.value if match.phase else "grupo"
    is_knockout = phase not in ("group", "grupo")
    phase_hint = (
        "MATA-MATA: preveja o placar no tempo regulamentar (90 min), pênaltis não contam pro bolão. "
        "NÃO reduza gols automaticamente por ser eliminatória — dados reais desta Copa mostram jogos "
        "com tantos gols quanto na fase de grupos. Só preveja placar baixo se xG/forma indicarem defesas fortes de fato."
        if is_knockout else
        "FASE DE GRUPOS: times buscam vitória, mais gols esperados. "
        "Favoritos claros (ELO >150 pts acima) vencem ~70% das vezes."
    )

    return (
        "Você é o ORÁCULO PREDICTOR — IA especialista em prever placares EXATOS de futebol.\n"
        "Seu objetivo é maximizar acertos de RESULTADO e PLACAR EXATO na Copa do Mundo 2026.\n\n"
        f"## Partida\n"
        f"{ta.name} ({ta.code}) x {tb.name} ({tb.code}) — {phase_hint}\n\n"
        f"## Modelo Estatístico (Dixon-Coles + Monte Carlo 50k simulações)\n"
        f"Baseline atual: {base[0]}×{base[1]}\n"
        f"{mc_block}\n\n"
        f"## {ta.name} ({ta.code})\n"
        f"ELO: {ta.elo_rating or 'N/D'} | Forma (5j): {ta.form_5 or 'N/D'} | Forma (10j): {ta.form_10 or 'N/D'}\n"
        f"Ataque: {ta.avg_goals_for or 'N/D'} gols/jogo | xG {ta.xg_for or 'N/D'} | Defesa: {ta.avg_goals_against or 'N/D'} sofridos | xGA {ta.xg_against or 'N/D'}\n"
        f"Mundiais: {ta.world_cup_appearances or 'N/D'} participações | Melhor resultado: {ta.best_wc_result or 'N/D'}\n"
        f"Convocados:\n{fmt_players(ta.id)}\n"
        f"Últimos jogos nesta Copa:\n{fmt_results(ra)}\n\n"
        f"## {tb.name} ({tb.code})\n"
        f"ELO: {tb.elo_rating or 'N/D'} | Forma (5j): {tb.form_5 or 'N/D'} | Forma (10j): {tb.form_10 or 'N/D'}\n"
        f"Ataque: {tb.avg_goals_for or 'N/D'} gols/jogo | xG {tb.xg_for or 'N/D'} | Defesa: {tb.avg_goals_against or 'N/D'} sofridos | xGA {tb.xg_against or 'N/D'}\n"
        f"Mundiais: {tb.world_cup_appearances or 'N/D'} participações | Melhor resultado: {tb.best_wc_result or 'N/D'}\n"
        f"Convocados:\n{fmt_players(tb.id)}\n"
        f"Últimos jogos nesta Copa:\n{fmt_results(rb)}\n\n"
        f"## Confronto direto (nesta Copa)\n{fmt_h2h()}\n\n"
        "## Decisão\n"
        "Analise TODOS os dados acima. Prioridade de decisão:\n"
        "1. Se o favorito do ELO (>100 pts acima) tem xG > 1.5 e forma positiva → aposte na vitória do favorito.\n"
        "2. Use os top-placares do Monte Carlo como âncora — desvie só se dados de forma/lesões justificarem.\n"
        "3. NÃO chute placar baixo só por ser mata-mata ou times parecerem equilibrados — isso historicamente "
        "faz o modelo subestimar gols. Baseie o total de gols em xG e Monte Carlo, não em intuição de jogo truncado.\n"
        "4. Lesionados/suspensos (⚠️/🚫) nos convocados podem reduzir o poder ofensivo — ajuste os gols.\n"
        "5. Só se afaste do baseline com convicção real (lesão/suspensão de titular decisivo, forma "
        "muito destoante). Divergência sem motivo forte derruba a taxa de acerto de placar exato — "
        "na dúvida, confirme o baseline.\n\n"
        "Responda em JSON PURO (sem markdown, sem ```):\n"
        "{\n"
        f'  "score_a": <int gols {ta.code}>,\n'
        f'  "score_b": <int gols {tb.code}>,\n'
        '  "confidence": <int 0-100>,\n'
        '  "reason": "3-5 frases em PT-BR: qual dado foi decisivo, por que confirma ou altera o baseline, lesões consideradas"\n'
        "}"
    )


def _is_br_match(db: Session, match: Match) -> bool:
    """True se a partida é do Brasileirão (clube, não seleção)."""
    br_id = get_competition_id(db, "brasileirao2026")
    return br_id is not None and match.competition_id == br_id


def _build_oracle_prompt_br(db: Session, match: Match, base: tuple[int, int]) -> str:
    """Prompt do Oráculo pra jogo de CLUBE (Brasileirão) — sem convocados/Mundiais
    (não fazem sentido pra clube), com tabela/pontos/Elo/forma/títulos e confronto
    direto NESTA temporada. Reusa _get_br_context/BR_TITLES de routers/analysis.py
    (mesmo padrão do BR_PROMPT_TEMPLATE da análise, ver commit 9be0dd8)."""
    from routers.analysis import _get_mc_prob, _get_recent_results, _get_br_context

    ta, tb = match.team_a, match.team_b
    mc = _get_mc_prob(db, match.id)
    ra = _get_recent_results(db, ta.code, limit=5) if ta else []
    rb = _get_recent_results(db, tb.code, limit=5) if tb else []
    ctx_a, ctx_b, h2h_season = _get_br_context(db, match.competition_id, match.team_a_id, match.team_b_id)

    def fmt_results(results) -> str:
        if not results:
            return "  Sem dados disponíveis nesta temporada"
        return "\n".join(
            f"  {r['date']}: {r['team_a']} {r['score_a']}–{r['score_b']} {r['team_b']}"
            for r in results
        )

    def fmt_h2h() -> str:
        if not h2h_season:
            return "  Times ainda não se enfrentaram nesta temporada"
        return "\n".join(
            f"  {g['home']} {g['score_home']}–{g['score_away']} {g['away']}" for g in h2h_season[:3]
        )

    mc_block = "indisponível"
    if mc:
        top = "  |  ".join(
            f"{s['score']} ({s['prob']:.1f}%)" for s in mc.get("top_scores", [])[:8]
        )
        mc_block = (
            f"Vitória {ta.name}: {mc['prob_a']:.1f}% | Empate: {mc['prob_draw']:.1f}% | Vitória {tb.name}: {mc['prob_b']:.1f}%\n"
            f"xG esperado: {ta.name} {mc['lambda_a']:.2f} gols × {tb.name} {mc['lambda_b']:.2f} gols\n"
            f"Top placares (Monte Carlo): {top}"
        )

    rodada = match.match_number or "?"

    return (
        "Você é o ORÁCULO PREDICTOR — IA especialista em prever placares EXATOS de futebol.\n"
        "Seu objetivo é maximizar acertos de RESULTADO e PLACAR EXATO no Campeonato Brasileiro Série A 2026.\n\n"
        f"## Partida\n"
        f"{ta.name} ({ta.code}) x {tb.name} ({tb.code}) — rodada {rodada} de 38. "
        "NÃO é mata-mata: preveja só o placar do jogo (sem prorrogação/pênaltis).\n\n"
        f"## Modelo Estatístico (Dixon-Coles + Monte Carlo)\n"
        f"Baseline atual: {base[0]}×{base[1]}\n"
        f"{mc_block}\n\n"
        f"## {ta.name} ({ta.code})\n"
        f"Posição: {ctx_a['pos']}º lugar | {ctx_a['pts']} pts (V{ctx_a['v']} E{ctx_a['e']} D{ctx_a['d']}) | Saldo de gols: {ctx_a['sg']}\n"
        f"Elo (replay da temporada): {ta.elo_rating or 'N/D'} | Forma (10j): {ta.form_10 or 'N/D'}\n"
        f"Ataque: {ta.avg_goals_for or 'N/D'} gols/jogo | Defesa: {ta.avg_goals_against or 'N/D'} sofridos/jogo\n"
        f"Títulos do Brasileirão: {ctx_a['titles']}\n"
        f"Últimos jogos na temporada:\n{fmt_results(ra)}\n\n"
        f"## {tb.name} ({tb.code})\n"
        f"Posição: {ctx_b['pos']}º lugar | {ctx_b['pts']} pts (V{ctx_b['v']} E{ctx_b['e']} D{ctx_b['d']}) | Saldo de gols: {ctx_b['sg']}\n"
        f"Elo (replay da temporada): {tb.elo_rating or 'N/D'} | Forma (10j): {tb.form_10 or 'N/D'}\n"
        f"Ataque: {tb.avg_goals_for or 'N/D'} gols/jogo | Defesa: {tb.avg_goals_against or 'N/D'} sofridos/jogo\n"
        f"Títulos do Brasileirão: {ctx_b['titles']}\n"
        f"Últimos jogos na temporada:\n{fmt_results(rb)}\n\n"
        f"## Confronto direto (nesta temporada)\n{fmt_h2h()}\n\n"
        "## Decisão\n"
        "Analise TODOS os dados acima. Prioridade de decisão:\n"
        "1. Se o favorito do Elo (>100 pts acima) tem ataque forte e forma positiva → aposte na vitória do favorito.\n"
        "2. Use os top-placares do Monte Carlo como âncora — desvie só se forma/posição na tabela justificarem.\n"
        "3. Considere o que está em jogo na tabela (briga por título/G4/Libertadores ou risco de rebaixamento) "
        "como motivação extra, mas não substitua os dados estatísticos por isso.\n"
        "4. NÃO temos boletim médico de clube (sem convocação oficial) — NÃO cite lesão/suspensão específica; "
        "se for considerar desfalque, fale em termos genéricos de 'força do elenco'.\n"
        "5. Só se afaste do baseline com convicção real (forma muito destoante, mando de campo decisivo). "
        "Divergência sem motivo forte derruba a taxa de acerto de placar exato — na dúvida, confirme o baseline.\n\n"
        "Responda em JSON PURO (sem markdown, sem ```):\n"
        "{\n"
        f'  "score_a": <int gols {ta.code}>,\n'
        f'  "score_b": <int gols {tb.code}>,\n'
        '  "confidence": <int 0-100>,\n'
        '  "reason": "3-5 frases em PT-BR: qual dado foi decisivo, por que confirma ou altera o baseline"\n'
        "}"
    )


def _has_relevant_absence(db: Session, match: Match) -> bool:
    """True se algum convocado das duas equipes está lesionado/suspenso."""
    from models import Player
    team_ids = [t for t in (match.team_a_id, match.team_b_id) if t]
    if not team_ids:
        return False
    return db.query(Player.id).filter(
        Player.team_id.in_(team_ids),
        or_(Player.is_injured.is_(True), Player.is_suspended.is_(True)),
    ).first() is not None


def _oracle_decide(db: Session, match: Match, cfg: dict | None) -> dict:
    """Decide o placar via IA dedicada. Fallback: baseline Monte Carlo/Elo."""
    sim = db.query(SimulationCache).filter(SimulationCache.match_id == match.id).first()
    base_a, base_b = _predict_score(sim, match)
    base_source = "monte_carlo" if (sim and sim.top_scores) else ("poisson" if (sim and sim.lambda_a) else "elo")
    probs = None
    if sim:
        probs = (
            round(float(sim.prob_a or 0) * 100, 2) if sim.prob_a is not None else None,
            round(float(sim.prob_draw or 0) * 100, 2) if sim.prob_draw is not None else None,
            round(float(sim.prob_b or 0) * 100, 2) if sim.prob_b is not None else None,
        )
    result = {
        "score_a": base_a, "score_b": base_b, "source": base_source,
        "model_tag": None, "confidence": None, "reason": None,
        "probs": probs, "baseline": (base_a, base_b),
    }
    if not cfg:
        result["reason"] = "IA não configurada — usado o modelo estatístico."
        return result
    from routers.analysis import _call_llm, _get_provider_chain, _build_slot_entries
    try:
        if _is_br_match(db, match):
            prompt = _build_oracle_prompt_br(db, match, (base_a, base_b))
        else:
            prompt = _build_oracle_prompt(db, match, (base_a, base_b))
        # "oracle_fallback_enabled"="false": só o provider PRIMÁRIO (oracle_provider),
        # sem cair pros outros — nem reordenar, nem tentar mais nada na cadeia.
        oracle_fallback_on = str(
            _oracle_raw_config(db).get("oracle_fallback_enabled", "true")
        ).strip().lower() != "false"
        if not oracle_fallback_on:
            primary_slot = cfg.get("provider") or "gemini"
            entries = _build_slot_entries(primary_slot, cfg)
            ordered_chain = [entries[0]] if entries else []
        else:
            # Monta cadeia na ordem preferida: OpenRouter → Gemini (ao contrário do default Gemini→OR).
            # cfg["fallback_enabled"] aqui pode ter vindo HERDADO da config de Análise (_get_config)
            # quando o Oráculo não tem chave própria — é o toggle de OUTRA feature (aba Análises) e
            # não pode vazar pro Oráculo: se o toggle do Oráculo pediu fallback (chegamos no else),
            # força fallback_enabled=true só pra esta chamada, sem mexer no cfg herdado de verdade.
            full_chain = _get_provider_chain({**cfg, "fallback_enabled": "true"})
            or_entries  = [p for p in full_chain if p["type"] == "openrouter"]
            gem_entries = [p for p in full_chain if p["type"] == "gemini"]
            oai_entries = [p for p in full_chain if p["type"] == "openai"]
            ordered_chain = or_entries + oai_entries + gem_entries or full_chain
        content, model_tag, usage = _call_llm(cfg, prompt, chain=ordered_chain)
        try:
            from routers.analysis import log_llm_usage
            log_llm_usage(db, trigger="oracle", model_tag=model_tag, usage=usage, match_id=match.id)
        except Exception as log_exc:
            print(f"[oracle] log_llm_usage falhou (ignorado): {log_exc}", flush=True)
        sa, sb = int(content.get("score_a")), int(content.get("score_b"))
        if not (0 <= sa <= 20 and 0 <= sb <= 20):
            raise ValueError("placar fora de faixa")
        conf = content.get("confidence")
        conf_int = int(conf) if conf is not None else None
        reason = str(content.get("reason") or "").strip()[:1000] or None

        deviated = (sa, sb) != (base_a, base_b)
        gate_ok = (conf_int is not None and conf_int >= ORACLE_CONFIDENCE_GATE) or _has_relevant_absence(db, match)
        if deviated and not gate_ok:
            # Baixa confiança e sem desfalque relevante: divergir do baseline aqui
            # historicamente derruba a taxa de acerto de placar exato — mantém o baseline.
            result.update({
                "score_a": base_a, "score_b": base_b,
                "source": f"llm/{model_tag}/gated", "model_tag": model_tag,
                "confidence": conf_int,
                "reason": (
                    f"IA sugeriu {sa}x{sb} (confiança {conf_int}) mas ficou abaixo do gate "
                    f"({ORACLE_CONFIDENCE_GATE}) sem desfalque relevante — mantido baseline {base_a}x{base_b}. "
                    + (reason or "")
                )[:1000],
            })
        else:
            result.update({
                "score_a": sa, "score_b": sb,
                "source": f"llm/{model_tag}", "model_tag": model_tag,
                "confidence": conf_int,
                "reason": reason,
            })
    except Exception as e:
        result["reason"] = f"IA indisponível ({str(e)[:120]}) — mantido modelo estatístico {base_a}x{base_b}."
    return result


def _oracle_telegram(db: Session, match: Match, decision: dict, action: str, old) -> bool:
    """Dispara a análise do Oráculo no Telegram. Best-effort, nunca levanta."""
    try:
        import httpx
        from routers.report import _telegram_config
        token, chat = _telegram_config(db)
        if not token or not chat:
            return False
        ta, tb = match.team_a, match.team_b
        act_label = {
            "created": "🆕 Novo palpite",
            "changed": "🔁 Palpite ALTERADO",
            "kept":    "✅ Palpite mantido",
        }.get(action, action)
        sa, sb = decision["score_a"], decision["score_b"]
        lines = [
            "🔮 <b>ORÁCULO PREDICTOR</b> — análise pré-jogo",
            f"<b>{_html.escape(ta.name if ta else '?')}</b> x <b>{_html.escape(tb.name if tb else '?')}</b>",
            "",
            f"{act_label}: <b>{sa} x {sb}</b>",
        ]
        if action == "changed" and old:
            lines.append(f"<i>Palpite anterior: {old[0]} x {old[1]}</i>")
        if decision.get("confidence") is not None:
            lines.append(f"🎯 Confiança: <b>{decision['confidence']}%</b>")

        # Mesma fundamentação (probabilidades/xG/Elo/forma/campanha/H2H) da
        # Projeção automática — reusa build_analysis_body pra não duplicar o
        # cálculo de lambdas/Monte Carlo/H2H em dois lugares.
        # cache_only=True em jogo do Brasileirão: team_head_to_head é histórico
        # de SELEÇÕES (prompt da busca via LLM pede "seleções principais"), não
        # existe cache de clube — sem isso, chamaria o LLM síncrono com prompt
        # errado pra clube. Cache vazio pra clube = seção H2H simplesmente não entra.
        try:
            from projections import build_analysis_body
            body = build_analysis_body(db, match, cache_only=_is_br_match(db, match))
            if body:
                lines += [""] + body
        except Exception as e:
            print(f"[oracle_telegram] fundamentação indisponível: {e}", flush=True)

        if decision.get("reason"):
            lines += ["", f"💬 {_html.escape(decision['reason'])}"]
        if decision.get("model_tag"):
            lines += ["", f"<i>IA: {_html.escape(decision['model_tag'])}</i>"]
        httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": "\n".join(lines),
                  "parse_mode": "HTML", "disable_web_page_preview": True},
            timeout=10,
        )
        return True
    except Exception:
        return False


def _oracle_push(db: Session, match: Match, decision: dict, action: str) -> int:
    """Envia Web Push para todos os subscribers com análise do Oráculo. Retorna enviados."""
    try:
        from routers.push import send_push_to_all
        ta = match.team_a.code if match.team_a else "?"
        tb = match.team_b.code if match.team_b else "?"
        sa, sb = decision["score_a"], decision["score_b"]
        action_label = {
            "created": "🔮 Oráculo prevê",
            "changed": "🔮 Oráculo atualizou",
            "kept":    "🔮 Oráculo confirma",
        }.get(action, "🔮 Oráculo")
        title = f"{action_label}: {ta} {sa}x{sb} {tb}"
        conf = decision.get("confidence")
        conf_str = f" (confiança {conf}%)" if conf is not None else ""
        reason = decision.get("reason", "")
        body = f"{reason[:100]}{conf_str}" if reason else f"Análise pré-jogo disponível{conf_str}"
        match_url = f"/partida/{match.id}"
        return send_push_to_all(db, title, body, match_url)
    except Exception:
        return 0


# ── Slack (Incoming Webhook) ────────────────────────────────────────────────────

def _slack_config(db: Session) -> str:
    """URL do Incoming Webhook do Slack (site_config tem prioridade sobre .env)."""
    from sqlalchemy import text
    row = db.execute(
        text("SELECT value FROM site_config WHERE key = 'slack_webhook_url'")
    ).fetchone()
    url = (row[0] if row else "") or ""
    from config import settings
    return url or settings.slack_webhook_url


def _slack_enabled(db: Session) -> bool:
    from sqlalchemy import text
    row = db.execute(
        text("SELECT value FROM site_config WHERE key = 'oracle_slack_enabled'")
    ).fetchone()
    if row and row[0] is not None:
        return str(row[0]).lower() in ("1", "true", "yes", "on")
    from config import settings
    return settings.oracle_slack_enabled


def _build_slack_blocks(match: Match, decision: dict, action: str, old) -> list:
    """Monta os Block Kit do Slack para a análise do Oráculo."""
    ta, tb = match.team_a, match.team_b
    sa, sb = decision["score_a"], decision["score_b"]
    act = {
        "created": "🆕 Novo palpite",
        "changed": "🔁 Palpite ALTERADO",
        "kept":    "✅ Palpite mantido",
    }.get(action, action)

    name_a = ta.name if ta else "?"
    name_b = tb.name if tb else "?"
    header = f"🔮 Oráculo Predictor · {name_a} x {name_b}"

    fields = [{"type": "mrkdwn", "text": f"*{act}*\n`{sa} x {sb}`"}]
    if action == "changed" and old:
        fields.append({"type": "mrkdwn", "text": f"*Anterior*\n~`{old[0]} x {old[1]}`~"})
    if decision.get("confidence") is not None:
        fields.append({"type": "mrkdwn", "text": f"*🎯 Confiança*\n{decision['confidence']}%"})
    if decision.get("probs") and decision["probs"][0] is not None:
        pa, pd, pb = decision["probs"]
        fields.append({"type": "mrkdwn", "text": f"*📊 Probabilidades*\n{pa:.0f}% / {pd:.0f}% / {pb:.0f}%"})

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": header[:150], "emoji": True}},
        {"type": "section", "fields": fields},
    ]
    if decision.get("reason"):
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"💬 {decision['reason'][:2900]}"},
        })
    ctx = []
    if decision.get("model_tag"):
        ctx.append(f"IA: {decision['model_tag']}")
    ctx.append(f"fonte: {decision.get('source', '?')}")
    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": " · ".join(ctx)}],
    })
    return blocks


def _oracle_slack(db: Session, match: Match, decision: dict, action: str, old,
                  webhook: str | None = None) -> bool:
    """Dispara a análise do Oráculo no Slack. Best-effort, nunca levanta."""
    try:
        import httpx
        url = webhook if webhook is not None else _slack_config(db)
        if not url:
            return False
        ta, tb = match.team_a, match.team_b
        sa, sb = decision["score_a"], decision["score_b"]
        fallback = f"🔮 Oráculo: {ta.name if ta else '?'} x {tb.name if tb else '?'} → {sa} x {sb}"
        r = httpx.post(
            url,
            json={"text": fallback, "blocks": _build_slack_blocks(match, decision, action, old)},
            timeout=10,
        )
        return r.status_code == 200
    except Exception:
        return False


def run_oracle_prediction(db: Session, trigger: str = "pre_match",
                          window_minutes: int = 60, force: bool = False,
                          telegram: bool = True, match_id: int | None = None,
                          push: bool = True) -> dict:
    """
    Re-analisa partidas que começam dentro de `window_minutes` (≈1h antes),
    deixando a IA dedicada confirmar ou alterar o palpite do Oráculo.
    `pre_match`: dedupe por partida (1x na janela). `manual`: sempre roda.

    `match_id`: restringe a UMA partida específica (ignora a janela de data) —
    útil pra testar/reenviar telegram/push de um jogo só sem processar (e
    notificar de novo) todo mundo que também estivesse dentro da janela.

    `push`: Web Push vai pra TODOS os inscritos reais do site (`send_push_to_all`),
    independente do trigger ser teste manual ou o loop automático — default True
    (comportamento de sempre), mas testes/dry-runs devem passar `push=False` pra
    não fazer fan-out real durante verificação manual (regra: nunca notificar
    usuário real sem necessidade).
    """
    bot = _get_bot(db)
    if not bot:
        return {"error": "bot_not_created", "processed": 0}

    cfg, llm_label, origin = pick_oracle_llm(db)
    slack_url = _slack_config(db) if _slack_enabled(db) else ""
    now = _utcnow()
    horizon = now + timedelta(minutes=window_minutes)

    if match_id is not None:
        matches = (
            db.query(Match)
            .filter(
                Match.id == match_id,
                Match.status == MatchStatus.scheduled,
                Match.competition_id.in_(_bot_competition_ids(db)),
            )
            .all()
        )
    else:
        matches = (
            db.query(Match)
            .filter(
                Match.status == MatchStatus.scheduled,
                Match.match_date.isnot(None),
                Match.match_date > now,
                Match.match_date <= horizon,
                Match.competition_id.in_(_bot_competition_ids(db)),
            )
            .order_by(Match.match_date.asc())
            .all()
        )

    summary = {
        "trigger": trigger, "llm": llm_label, "llm_origin": origin,
        "window_minutes": window_minutes, "processed": 0,
        "created": 0, "changed": 0, "kept": 0, "skipped": 0,
        "telegram_sent": 0, "slack_sent": 0, "items": [],
    }

    for match in matches:
        if trigger == "pre_match" and not force:
            already = db.query(BotDecisionLog.id).filter(
                BotDecisionLog.match_id == match.id,
                BotDecisionLog.trigger == "pre_match",
            ).first()
            if already:
                continue

        bet = db.query(Bet).filter(Bet.user_id == bot.id, Bet.match_id == match.id).first()
        deadline = match.bet_deadline or match.match_date
        closed = bool(deadline and now >= deadline)

        decision = _oracle_decide(db, match, cfg)
        sa, sb = decision["score_a"], decision["score_b"]
        old = (bet.score_a, bet.score_b) if bet else None

        if bet is None:
            if closed:
                action = "skipped"
                decision["reason"] = (decision.get("reason") or "") + " (aposta fechada — não criada)"
            else:
                bet = Bet(user_id=bot.id, match_id=match.id, competition_id=match.competition_id, score_a=sa, score_b=sb, locked_at=match.match_date)
                db.add(bet)
                db.flush()
                action = "created"
        else:
            if (bet.score_a, bet.score_b) == (sa, sb):
                action = "kept"
            elif closed:
                action = "skipped"
                decision["reason"] = (decision.get("reason") or "") + " (aposta já fechada — palpite mantido)"
            else:
                bet.score_a, bet.score_b = sa, sb
                action = "changed"

        probs = decision.get("probs") or (None, None, None)
        notify = action in ("created", "changed", "kept")
        sent = False
        slack_ok = False
        push_sent = 0
        if notify and telegram:
            sent = _oracle_telegram(db, match, decision, action, old)
            if sent:
                summary["telegram_sent"] += 1
        if notify and slack_url:
            slack_ok = _oracle_slack(db, match, decision, action, old, webhook=slack_url)
            if slack_ok:
                summary["slack_sent"] += 1
        if notify and push:
            push_sent = _oracle_push(db, match, decision, action)
            if push_sent:
                summary["push_sent"] = summary.get("push_sent", 0) + push_sent

        log = BotDecisionLog(
            match_id=match.id,
            bet_id=bet.id if bet else None,
            action=action, trigger=trigger,
            old_a=old[0] if old else None, old_b=old[1] if old else None,
            new_a=sa, new_b=sb,
            source=decision["source"], confidence=decision.get("confidence"),
            prob_a=probs[0], prob_draw=probs[1], prob_b=probs[2],
            reason=decision.get("reason"), telegram_sent=sent, slack_sent=slack_ok, push_sent=push_sent,
            meta={
                "baseline": list(decision["baseline"]),
                "model": decision.get("model_tag"),
                "team_a": match.team_a.code if match.team_a else None,
                "team_b": match.team_b.code if match.team_b else None,
            },
        )
        db.add(log)

        summary["processed"] += 1
        summary[action] = summary.get(action, 0) + 1
        summary["items"].append({
            "match_id": match.id,
            "teams": f"{match.team_a.code if match.team_a else '?'}x{match.team_b.code if match.team_b else '?'}",
            "action": action, "score": f"{sa}x{sb}",
            "old": f"{old[0]}x{old[1]}" if old else None,
            "baseline": f"{decision['baseline'][0]}x{decision['baseline'][1]}",
            "ai_overrode": tuple(decision["baseline"]) != (sa, sb),
            "source": decision["source"], "telegram": sent, "slack": slack_ok,
        })

    db.commit()
    return summary


@router.post("/run-prediction")
def bot_run_prediction(
    window: int | None = None,
    telegram: bool = True,
    match_id: int | None = None,
    push: bool = True,
    db: Session = Depends(get_db),
    _admin: User = Depends(_require_admin),
):
    """Dispara manualmente a re-análise do Oráculo (ignora dedupe da janela).
    `match_id`: restringe a uma partida só (não notifica as demais candidatas).
    `push=false`: dry-run seguro pra teste — não manda Web Push real pros inscritos."""
    from config import settings
    win = window or settings.oracle_window_minutes
    return run_oracle_prediction(db, trigger="manual", window_minutes=win, force=True, telegram=telegram, match_id=match_id, push=push)


@router.get("/logs")
def bot_logs(limit: int = 50, db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    rows = (
        db.query(BotDecisionLog)
        .order_by(BotDecisionLog.created_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    items = []
    for l in rows:
        m = db.query(Match).get(l.match_id) if l.match_id else None
        ta = m.team_a if m else None
        tb = m.team_b if m else None
        meta = l.meta or {}
        items.append({
            "id": l.id, "match_id": l.match_id,
            "team_a_code": ta.code if ta else meta.get("team_a"),
            "team_b_code": tb.code if tb else meta.get("team_b"),
            "team_a_flag": ta.flag_url if ta else None,
            "team_b_flag": tb.flag_url if tb else None,
            "action": l.action, "trigger": l.trigger,
            "old": f"{l.old_a}x{l.old_b}" if l.old_a is not None else None,
            "new": f"{l.new_a}x{l.new_b}" if l.new_a is not None else None,
            "baseline": (lambda b: f"{b[0]}x{b[1]}" if b and len(b) == 2 else None)(meta.get("baseline")),
            "ai_overrode": (lambda b, n: bool(b) and len(b) == 2 and (b[0], b[1]) != (l.new_a, l.new_b))(meta.get("baseline"), None),
            "source": l.source, "confidence": l.confidence,
            "prob_a": float(l.prob_a) if l.prob_a is not None else None,
            "prob_draw": float(l.prob_draw) if l.prob_draw is not None else None,
            "prob_b": float(l.prob_b) if l.prob_b is not None else None,
            "reason": l.reason, "telegram_sent": l.telegram_sent, "slack_sent": l.slack_sent,
            "created_at": str(l.created_at),
        })
    return {"items": items}


@router.get("/oracle-config")
def get_oracle_config(db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    from routers.analysis import (
        _mask, GEMINI_MODELS, OPENROUTER_FREE_MODELS,
        OPENROUTER_PAID_MODELS, OPENAI_DIRECT_MODELS,
    )
    raw = _oracle_raw_config(db)
    _cfg, llm_label, origin = pick_oracle_llm(db)
    return {
        "provider":              raw.get("oracle_provider", "gemini"),
        "gemini_model":          raw.get("oracle_gemini_model", ORACLE_DEFAULT_GEMINI_MODEL),
        "gemini_key_masked":     _mask(raw.get("oracle_gemini_key", "")),
        "gemini_has_key":        bool(raw.get("oracle_gemini_key")),
        "openrouter_model":      raw.get("oracle_openrouter_model", ORACLE_DEFAULT_OR_MODEL),
        "openrouter_key_masked": _mask(raw.get("oracle_openrouter_key", "")),
        "openrouter_has_key":    bool(raw.get("oracle_openrouter_key")),
        "openai_model":          raw.get("oracle_openai_model", "gpt-4o-mini"),
        "openai_key_masked":     _mask(raw.get("oracle_openai_key", "")),
        "openai_has_key":        bool(raw.get("oracle_openai_key")),
        "gemini_models":         GEMINI_MODELS,
        "openrouter_free_models": OPENROUTER_FREE_MODELS,
        "openrouter_paid_models": OPENROUTER_PAID_MODELS,
        "openai_models":         OPENAI_DIRECT_MODELS,
        "active_llm":            llm_label,
        "llm_origin":            origin,
        "fallback_enabled":      str(raw.get("oracle_fallback_enabled", "true")).strip().lower() != "false",
        # Slack
        "slack_webhook_masked":  _mask(_slack_config(db)),
        "slack_has_webhook":     bool(_slack_config(db)),
        "slack_enabled":         _slack_enabled(db),
    }


class OracleConfigIn(BaseModel):
    provider: str = "gemini"
    gemini_key: str = ""
    gemini_model: str = ORACLE_DEFAULT_GEMINI_MODEL
    openrouter_key: str = ""
    openrouter_model: str = ORACLE_DEFAULT_OR_MODEL
    openai_key: str = ""
    openai_model: str = "gpt-4o-mini"
    slack_webhook: str | None = None
    slack_enabled: bool | None = None
    fallback_enabled: bool = True


@router.post("/oracle-config")
def save_oracle_config(body: OracleConfigIn, db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    from sqlalchemy import text
    pairs = [
        ("oracle_provider",         body.provider),
        ("oracle_gemini_model",     body.gemini_model),
        ("oracle_openrouter_model", body.openrouter_model),
        ("oracle_openai_model",     body.openai_model),
        ("oracle_fallback_enabled", "true" if body.fallback_enabled else "false"),
    ]
    if body.gemini_key and not body.gemini_key.startswith("•"):
        pairs.append(("oracle_gemini_key", body.gemini_key))
    if body.openrouter_key and not body.openrouter_key.startswith("•"):
        pairs.append(("oracle_openrouter_key", body.openrouter_key))
    if body.openai_key and not body.openai_key.startswith("•"):
        pairs.append(("oracle_openai_key", body.openai_key))
    # Slack: webhook só sobrescreve se não estiver mascarado
    if body.slack_webhook is not None and body.slack_webhook and not body.slack_webhook.startswith("•"):
        pairs.append(("slack_webhook_url", body.slack_webhook.strip()))
    if body.slack_enabled is not None:
        pairs.append(("oracle_slack_enabled", "true" if body.slack_enabled else "false"))
    for k, v in pairs:
        db.execute(
            text("INSERT INTO site_config (key,value) VALUES (:k,:v) ON CONFLICT (key) DO UPDATE SET value=:v"),
            {"k": k, "v": v},
        )
    db.commit()
    return {"ok": True}


@router.post("/test-slack")
def test_slack(db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    """Envia uma mensagem de teste ao webhook do Slack configurado."""
    url = _slack_config(db)
    if not url:
        raise HTTPException(400, "Webhook do Slack não configurado")
    try:
        import httpx
        r = httpx.post(url, json={
            "text": "🔮 Oráculo Predictor — teste de conexão",
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": "🔮 Oráculo Predictor", "emoji": True}},
                {"type": "section", "text": {"type": "mrkdwn", "text": "✅ Webhook do Slack conectado com sucesso. As análises pré-jogo chegarão aqui."}},
            ],
        }, timeout=10)
        if r.status_code != 200:
            raise HTTPException(502, f"Slack retornou {r.status_code}: {r.text[:200]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Falha ao enviar: {str(e)[:200]}")
    return {"ok": True}


# ── Endpoint público (sem autenticação) ────────────────────────────────────────

public_router = APIRouter(prefix="/bot", tags=["bot-public"])


@public_router.get("/public")
def bot_public(db: Session = Depends(get_db)):
    """Performance pública do Apostador IA — acessível a todos os usuários."""
    bot = _get_bot(db)
    if not bot:
        return {"exists": False}

    copa_id = get_competition_id(db)
    copa_stats = _bot_competition_stats(db, bot.id, copa_id)
    total_bets, evaluated_n = copa_stats["total_bets"], copa_stats["evaluated"]
    exatos, certos, erros = copa_stats["exatos"], copa_stats["certos"], copa_stats["erros"]
    total_pts, pos = copa_stats["total_points"], copa_stats["ranking_position"]

    # Bloco Brasileirão — aditivo, nunca derruba o público se falhar.
    br_stats = None
    try:
        br_id = get_competition_id(db, "brasileirao2026")
        if br_id is not None:
            br_stats = _bot_competition_stats(db, bot.id, br_id)
    except Exception as e:
        print(f"[bot_public] stats Brasileirão falharam (ignorado): {e}", flush=True)

    pick = db.query(ChampionPick).filter(ChampionPick.user_id == bot.id).first()
    champ_team = db.query(Team).filter(Team.id == pick.team_id).first() if pick else None
    vice_team  = db.query(Team).filter(Team.id == pick.runner_up_team_id).first() if (pick and pick.runner_up_team_id) else None

    # Bets com resultado (últimas 20 avaliadas) — escopado em Copa: "by_phase"
    # agrupa por MatchPhase e o Brasileirão é sempre phase=group, conflitaria
    # com a fase de grupos da Copa no mesmo balde se não filtrasse aqui.
    recent_bets = (
        db.query(Bet)
        .filter(Bet.user_id == bot.id, Bet.evaluated_at.isnot(None), Bet.competition_id == copa_id)
        .join(Bet.match)
        .order_by(Match.match_date.asc().nullslast())
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
        "evaluated": evaluated_n,
        "exatos": exatos,
        "certos": certos,
        "erros": erros,
        "total_points": total_pts,
        "ranking_position": pos,
        "brasileirao": br_stats,
        "champion": {"name": champ_team.name, "code": champ_team.code, "flag": champ_team.flag_url} if champ_team else None,
        "vice": {"name": vice_team.name, "code": vice_team.code, "flag": vice_team.flag_url} if vice_team else None,
        "recent_bets": recent_rows,
        "by_phase": by_phase,
    }
