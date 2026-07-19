"""
Motor de apostas do Bot Squad — 20 usuários-persona (`bot_personas`) apostando
sozinhos nos jogos de Copa2026 + Brasileirão2026, cada um com placar e
justificativa própria. Módulo não-router (padrão `projections.py`).

Não é worker/cron — isso é o passo 3 (`bot_squad_worker.py`). Aqui só a lógica:
  - `persona_sample_score`: reponderação da distribuição Dixon-Coles por
    persona + amostragem determinística (seed = sha256(user_id:match_id:v1)).
  - `place_pending_bets`: varre jogos scheduled das 2 competições dentro da
    janela rolante de 7 dias e cria as apostas de bot pendentes (jitter
    anti-robótico por persona/jogo).
  - `generate_reasons` / `fallback_reason`: justificativa curta por aposta —
    1 chamada LLM por JOGO (não por persona), com fallback determinístico se
    a IA falhar por qualquer motivo (nunca bloqueia a aposta).

Import circular: este módulo importa de `routers.matches` (`_team_to_input`,
mesmo padrão de `projections.py`) — `routers/matches.py` NUNCA deve importar
de `bot_squad.py`.
"""
import hashlib
import random
import time
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np
from sqlalchemy.orm import Session, joinedload

from competitions import get_competition_id
from config import settings
from database import SessionLocal
from engine.elo import elo_win_probabilities
from engine.monte_carlo import simulate_match
from engine.poisson import dc_score_weights
from engine.weights import compute_weighted_lambdas
from h2h_lookup import get_h2h_cached
from models import Bet, BotPersona, BotSquadReview, Match, MatchPhase, MatchStatus, User
from routers.matches import _team_to_input

BOT_SEED_VERSION = "v1"
BOT_SQUAD_WINDOW_DAYS = 7
BOT_SQUAD_MODEL_OVERRIDE = "gpt-5.4-mini"  # mesmo modelo validado pro Oráculo (barato, mar/2026)
BOT_SQUAD_REVIEW_SEED_VERSION = "v2"
BOT_SQUAD_REVIEW_WINDOW_START = timedelta(hours=2, minutes=30)
BOT_SQUAD_REVIEW_WINDOW_END = timedelta(hours=3, minutes=30)
BOT_SQUAD_STUBBORNNESS_THRESHOLD = 0.6


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _sha_int(seed_str: str) -> int:
    return int(hashlib.sha256(seed_str.encode()).hexdigest(), 16)


# ─── Reponderação + amostragem por persona ────────────────────────────────────

def persona_sample_score(
    db_weights: tuple[np.ndarray, np.ndarray, np.ndarray],
    params: dict,
    is_fav_a: bool,
    is_fav_b: bool,
    seed_str: str,
) -> tuple[int, int]:
    """
    Reponderaa a distribuição Dixon-Coles (`engine.poisson.dc_score_weights`)
    pelos parâmetros da persona e amostra 1 placar determinístico.

    db_weights: (scores_a, scores_b, weights) — retorno cru de dc_score_weights.
    params: dict da persona (risk, draw_affinity, goals_bias, fav_boost — 0-1
        exceto goals_bias que é -1..1; ausentes caem no neutro).
    is_fav_a/is_fav_b: True se o time do coração da persona é team_a/team_b
        desta partida (False/False se a persona não tem time ou ele não joga).
    seed_str: "{user_id}:{match_id}:v1" — mesma seed = mesmo placar sempre.
    """
    sa, sb, w = db_weights
    weights = np.array(w, dtype=np.float64)  # cópia — nunca muta o array do caller

    risk = float(params.get("risk", 0.5))
    draw_affinity = float(params.get("draw_affinity", 0.5))
    goals_bias = float(params.get("goals_bias", 0.0))
    fav_boost = float(params.get("fav_boost", 0.0))

    goal_sum = sa + sb
    is_draw = sa == sb

    # Empates × (0.5 + draw_affinity) — 0.5x a 1.5x
    weights = np.where(is_draw, weights * (0.5 + draw_affinity), weights)

    # Placares de muitos gols (soma >= 4) × (1 + max(0, goals_bias))
    high_mult = 1.0 + max(0.0, goals_bias)
    weights = np.where(goal_sum >= 4, weights * high_mult, weights)

    # Placares de poucos gols (soma <= 1) × (1 + max(0, -goals_bias))
    low_mult = 1.0 + max(0.0, -goals_bias)
    weights = np.where(goal_sum <= 1, weights * low_mult, weights)

    # Time do coração jogando e vencendo × (1 + fav_boost)
    if is_fav_a:
        weights = np.where(sa > sb, weights * (1.0 + fav_boost), weights)
    elif is_fav_b:
        weights = np.where(sb > sa, weights * (1.0 + fav_boost), weights)

    # Cauda (placares fora do top-10 da distribuição ORIGINAL) × (0.3 + risk)
    top10_idx = set(np.argsort(-w)[:10].tolist())
    tail_mask = np.array([i not in top10_idx for i in range(len(w))], dtype=bool)
    tail_mult = 0.3 + risk
    weights = np.where(tail_mask, weights * tail_mult, weights)

    weights = np.clip(weights, 0.0, None)
    total = float(weights.sum())
    if total <= 0:
        # Salvaguarda — nunca deveria zerar, mas se zerar cai na distribuição crua
        weights = np.array(w, dtype=np.float64)
        total = float(weights.sum())
    weights = weights / total

    rng = random.Random(_sha_int(seed_str))
    idx = rng.choices(range(len(weights)), weights=weights.tolist(), k=1)[0]
    return int(sa[idx]), int(sb[idx])


def _et_winner_pick(prob_a: float, prob_b: float, is_fav_a: bool, is_fav_b: bool) -> str:
    """Lado com maior probabilidade Elo; viés: time do coração da persona
    escolhido se está no jogo e a prob dele é >= 0.35 (mesmo com o outro lado
    mais provável)."""
    pick = "a" if prob_a >= prob_b else "b"
    if is_fav_a and prob_a >= 0.35:
        pick = "a"
    elif is_fav_b and prob_b >= 0.35:
        pick = "b"
    return pick


# ─── Geração de apostas ────────────────────────────────────────────────────────

def place_pending_bets(db: Session | None = None) -> dict:
    """
    Varre jogos `scheduled` das 2 competições (copa2026 + brasileirao2026) com
    `match_date` na janela rolante [now, now+7d] e cria a aposta de cada
    persona `enabled` que ainda não apostou nesse jogo e cujo `place_after`
    já venceu. Commit por JOGO (não por aposta) — 1 chamada LLM por jogo pra
    justificativa (`generate_reasons`), nunca bloqueia a aposta se falhar.

    Retorna {"placed": int, "skipped_jitter": int, "matches": int}.
    """
    own_session = db is None
    db = db or SessionLocal()
    summary = {"placed": 0, "skipped_jitter": 0, "matches": 0}
    try:
        now = _utcnow()
        window_end = now + timedelta(days=BOT_SQUAD_WINDOW_DAYS)

        copa_id = get_competition_id(db, "copa2026")
        br_id = get_competition_id(db, "brasileirao2026")
        comp_ids = [cid for cid in (copa_id, br_id) if cid is not None]
        if not comp_ids:
            print("[bot_squad] nenhuma competição encontrada (copa2026/brasileirao2026) — abortando", flush=True)
            return summary

        matches = (
            db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .filter(
                Match.competition_id.in_(comp_ids),
                Match.status == MatchStatus.scheduled,
                Match.match_date.isnot(None),
                Match.match_date > now,
                Match.match_date <= window_end,
                ~Match.result.has(),
            )
            .order_by(Match.match_date)
            .all()
        )
        if not matches:
            print("[bot_squad] nenhum jogo scheduled na janela de 7 dias", flush=True)
            return summary

        persona_rows = (
            db.query(BotPersona, User.name)
            .join(User, User.id == BotPersona.user_id)
            .filter(BotPersona.enabled.is_(True), User.is_bot.is_(True))
            .all()
        )
        if not persona_rows:
            print("[bot_squad] nenhuma bot_persona enabled encontrada", flush=True)
            return summary

        for match in matches:
            try:
                placed_now = _place_bets_for_match(db, match, persona_rows, br_id, now, summary)
                if placed_now:
                    db.commit()
                    summary["placed"] += placed_now
                    summary["matches"] += 1
                    print(
                        f"[bot_squad] jogo {match.id} ({match.team_a.code} x {match.team_b.code}, "
                        f"{match.match_date}): {placed_now} apostas de bot criadas",
                        flush=True,
                    )
                else:
                    db.rollback()
            except Exception as e:
                db.rollback()
                print(f"[bot_squad] erro no jogo {match.id}: {e}", flush=True)

        return summary
    finally:
        if own_session:
            db.close()


def _compute_place_after(persona: BotPersona, match: Match, now: datetime) -> datetime:
    """`place_after` determinístico (jitter anti-robótico) por (persona, jogo):
    abertura da janela de 7 dias + hash%jitter_hours, clamped pra `now` se isso
    deixaria menos de 2h pro deadline. Extraído pra ser reusado tanto por
    `_place_bets_for_match` (grava de verdade) quanto por `preview_pending_bets`
    (dry-run do endpoint admin `POST /admin/bot-squad/run`) — mesma regra,
    sem duplicar."""
    params = persona.params or {}
    jitter_hours = max(1, int(params.get("jitter_hours", 24)))
    jit_seed = f"{persona.user_id}:{match.id}:jit"
    offset_hours = _sha_int(jit_seed) % jitter_hours
    place_after = (match.match_date - timedelta(days=BOT_SQUAD_WINDOW_DAYS)) + timedelta(hours=offset_hours)
    if place_after > match.match_date - timedelta(hours=2):
        place_after = now  # clamp — garante que a aposta sempre entra a tempo
    return place_after


def preview_pending_bets(db: Session) -> dict:
    """Dry-run de `place_pending_bets`: MESMA query de janela rolante (7 dias)
    + MESMO cálculo de `place_after`/jitter por (persona, jogo), mas só monta a
    lista do que seria feito — não cria `Bet`, não commita, não chama LLM.
    Usado por `POST /admin/bot-squad/run?dry_run=true`.

    Retorna {"matches": [{"match_id", "teams", "match_date",
    "personas_prontas": [...], "personas_jitter_futuro": [...]}]}.
    """
    now = _utcnow()
    window_end = now + timedelta(days=BOT_SQUAD_WINDOW_DAYS)
    result: dict = {"matches": []}

    copa_id = get_competition_id(db, "copa2026")
    br_id = get_competition_id(db, "brasileirao2026")
    comp_ids = [cid for cid in (copa_id, br_id) if cid is not None]
    if not comp_ids:
        return result

    matches = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(
            Match.competition_id.in_(comp_ids),
            Match.status == MatchStatus.scheduled,
            Match.match_date.isnot(None),
            Match.match_date > now,
            Match.match_date <= window_end,
            ~Match.result.has(),
        )
        .order_by(Match.match_date)
        .all()
    )
    if not matches:
        return result

    persona_rows = (
        db.query(BotPersona, User.name)
        .join(User, User.id == BotPersona.user_id)
        .filter(BotPersona.enabled.is_(True), User.is_bot.is_(True))
        .all()
    )
    if not persona_rows:
        return result

    for match in matches:
        existing_user_ids = {
            uid for (uid,) in db.query(Bet.user_id).filter(Bet.match_id == match.id).all()
        }
        pending = [(p, name) for p, name in persona_rows if p.user_id not in existing_user_ids]
        if not pending:
            continue

        prontas, futuras = [], []
        for persona, name in pending:
            place_after = _compute_place_after(persona, match, now)
            item = {"user_id": persona.user_id, "name": name, "place_after": place_after.isoformat()}
            (futuras if place_after > now else prontas).append(item)

        result["matches"].append({
            "match_id": match.id,
            "teams": f"{match.team_a.name} x {match.team_b.name}",
            "match_date": match.match_date.isoformat() if match.match_date else None,
            "personas_prontas": prontas,
            "personas_jitter_futuro": futuras,
        })

    return result


def _place_bets_for_match(
    db: Session, match: Match, persona_rows: list, br_id: int | None, now: datetime, summary: dict
) -> int:
    """Cria as apostas pendentes de 1 jogo. Retorna quantas foram criadas
    (0 = nada a fazer ou todas ainda em jitter — caller decide commit/rollback)."""
    existing_user_ids = {
        uid for (uid,) in db.query(Bet.user_id).filter(Bet.match_id == match.id).all()
    }
    pending = [(p, name) for p, name in persona_rows if p.user_id not in existing_user_ids]
    if not pending:
        return 0

    ta_input = _team_to_input(match.team_a)
    tb_input = _team_to_input(match.team_b)
    h2h = get_h2h_cached(db, match.team_a.code, match.team_b.code)
    phase_str = match.phase.value if match.phase else "group"
    lambda_a, lambda_b, _weights_used = compute_weighted_lambdas(
        ta_input, tb_input, is_neutral=match.is_neutral, phase=phase_str, h2h=h2h,
    )
    db_weights = dc_score_weights(lambda_a, lambda_b)

    is_knockout = match.phase != MatchPhase.group and match.competition_id != br_id
    prob_a = prob_b = None
    if is_knockout:
        prob_a, _prob_draw, prob_b = elo_win_probabilities(
            float(match.team_a.elo_rating), float(match.team_b.elo_rating), bool(match.is_neutral)
        )

    decided: list[dict] = []
    for persona, name in pending:
        params = persona.params or {}
        place_after = _compute_place_after(persona, match, now)
        if place_after > now:
            summary["skipped_jitter"] += 1
            continue

        fav_code = persona.favorite_team_code
        is_fav_a = bool(fav_code) and fav_code == match.team_a.code
        is_fav_b = bool(fav_code) and fav_code == match.team_b.code

        seed_str = f"{persona.user_id}:{match.id}:{BOT_SEED_VERSION}"
        score_a, score_b = persona_sample_score(db_weights, params, is_fav_a, is_fav_b, seed_str)

        et_winner_pick = None
        if is_knockout:
            et_winner_pick = _et_winner_pick(prob_a, prob_b, is_fav_a, is_fav_b)

        bet = Bet(
            user_id=persona.user_id,
            match_id=match.id,
            competition_id=match.competition_id,
            score_a=score_a,
            score_b=score_b,
            et_winner_pick=et_winner_pick,
            locked_at=match.match_date,
        )
        db.add(bet)
        decided.append({
            "user_id": persona.user_id,
            "name": name,
            "archetype": persona.archetype,
            "bio": persona.bio,
            "params": params,
            "score_a": score_a,
            "score_b": score_b,
            "bet": bet,
        })

    if not decided:
        return 0

    db.flush()  # garante bet.id antes do reason opcional referenciar / logs

    try:
        reasons = generate_reasons(db, match, decided)
        for item, reason in zip(decided, reasons):
            item["bet"].bot_reason = reason
    except Exception as e:
        # generate_reasons já isola internamente e nunca deveria propagar, mas
        # blindagem dupla: falha aqui NUNCA pode derrubar a criação da aposta.
        print(f"[bot_squad] generate_reasons explodiu (ignorado, sem justificativa), jogo {match.id}: {e}", flush=True)

    return len(decided)


# ─── Justificativa (LLM por jogo + fallback determinístico) ──────────────────

def _bot_squad_llm_cfg(db: Session):
    """Monta (cfg, chain) pra 1 chamada de LLM do bot_squad, mesma infra de
    `routers/analysis.py::_call_llm`. Se houver chave OpenAI direta configurada
    (site_config.openai_api_key), força o modelo pro `gpt-5.4-mini` — mesmo
    modelo já validado pro Oráculo (barato, ~US$0,0014/chamada, conhecimento
    mar/2026 — ver skill predicts). Sem OpenAI configurada, cai na cadeia
    normal de fallback da análise (Gemini/OpenRouter), sem forçar modelo."""
    from routers.analysis import _get_config, _get_provider_chain

    cfg = _get_config(db)
    if cfg.get("openai_key"):
        chain = [{
            "type": "openai",
            "key": cfg["openai_key"],
            "model": BOT_SQUAD_MODEL_OVERRIDE,
            "label": f"OpenAI {BOT_SQUAD_MODEL_OVERRIDE} (bot_squad)",
        }]
        return cfg, chain
    chain = _get_provider_chain(cfg)
    if not chain:
        return None, None
    return cfg, chain


def _extract_reasons_array(result) -> list | None:
    """Parse tolerante: aceita array puro OU objeto com o array numa chave
    comum (o `response_format=json_object` da OpenAI exige objeto no topo)."""
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for key in ("reasons", "justificativas", "comentarios", "comments", "items", "data", "array"):
            v = result.get(key)
            if isinstance(v, list):
                return v
        for v in result.values():
            if isinstance(v, list):
                return v
    return None


def _build_bot_squad_prompt(db: Session, match: Match, decided: list[dict]) -> str:
    from routers.analysis import _get_br_context

    ta, tb = match.team_a, match.team_b
    br_id = get_competition_id(db, "brasileirao2026")
    is_br = br_id is not None and match.competition_id == br_id

    if is_br:
        ctx_a, ctx_b, _h2h_season = _get_br_context(db, match.competition_id, match.team_a_id, match.team_b_id)
        contexto = (
            f"Campeonato Brasileiro Série A 2026 — rodada {match.match_number or '?'} de 38\n"
            f"{ta.name}: {ctx_a['pos']}º lugar, {ctx_a['pts']} pts (V{ctx_a['v']} E{ctx_a['e']} D{ctx_a['d']}), "
            f"saldo de gols {ctx_a['sg']}, Elo {ta.elo_rating}, forma últimos 10 jogos {ta.form_10}\n"
            f"{tb.name}: {ctx_b['pos']}º lugar, {ctx_b['pts']} pts (V{ctx_b['v']} E{ctx_b['e']} D{ctx_b['d']}), "
            f"saldo de gols {ctx_b['sg']}, Elo {tb.elo_rating}, forma últimos 10 jogos {tb.form_10}"
        )
    else:
        phase_label = {
            "group": "fase de grupos", "r32": "rodada de 32", "r16": "oitavas de final",
            "qf": "quartas de final", "sf": "semifinal", "3rd": "disputa de 3º lugar", "final": "final",
        }.get(match.phase.value if match.phase else "group", "fase de grupos")
        contexto = (
            f"Copa do Mundo 2026 — {phase_label}\n"
            f"{ta.name} ({ta.code}): Elo {ta.elo_rating}, forma últimos 10 jogos {ta.form_10}, "
            f"ataque {ta.avg_goals_for} gols/jogo, defesa {ta.avg_goals_against} sofridos/jogo\n"
            f"{tb.name} ({tb.code}): Elo {tb.elo_rating}, forma últimos 10 jogos {tb.form_10}, "
            f"ataque {tb.avg_goals_for} gols/jogo, defesa {tb.avg_goals_against} sofridos/jogo"
        )

    personas_block = "\n".join(
        f"{i + 1}. {item['name']} — arquétipo \"{item['archetype']}\" — bio: {item['bio'] or 'sem bio'} — "
        f"palpite decidido: {ta.name} {item['score_a']} x {item['score_b']} {tb.name}"
        for i, item in enumerate(decided)
    )
    n = len(decided)

    return (
        "Você escreve, em português do Brasil, comentários curtos e naturais de apostadores "
        "comuns de um bolão de futebol — cada um já com o palpite decidido, você só explica o "
        "motivo com a voz de cada um.\n\n"
        f"## Jogo\n{ta.name} x {tb.name}\n{contexto}\n\n"
        f"## Apostadores ({n}), NESTA ORDEM\n{personas_block}\n\n"
        "## Instruções\n"
        f"Escreva exatamente {n} comentários, um por apostador da lista acima, NA MESMA ORDEM. "
        "Cada comentário: 1-2 frases, tom coloquial e humano, coerente com o arquétipo e a bio de "
        "quem fala, pode citar o placar ou o motivo da escolha.\n"
        "PROIBIDO revelar, sugerir ou insinuar que quem fala é um bot, uma IA ou um programa — "
        "escreva como pessoa real.\n"
        "PROIBIDO inventar qualquer estatística, sequência, lesão ou número que não esteja no "
        "contexto do jogo acima — use só os fatos dados.\n\n"
        "Responda em JSON PURO (sem markdown, sem ```), exatamente neste formato:\n"
        '{"reasons": ["comentário do apostador 1", "comentário do apostador 2", "..."]}'
    )


def generate_reasons(db: Session, match: Match, decided: list[dict]) -> list[str]:
    """1 chamada LLM pro jogo inteiro — retorna 1 justificativa por item de
    `decided` (mesma ordem). `decided` = [{user_id, name, archetype, bio,
    params, score_a, score_b}, ...]. Falha de QUALQUER tipo (rede, parse,
    cadeia esgotada) NUNCA propaga — cai em `fallback_reason` determinístico
    item a item."""
    n = len(decided)
    if n == 0:
        return []

    try:
        cfg, chain = _bot_squad_llm_cfg(db)
        if not cfg or not chain:
            raise ValueError("nenhum provider LLM configurado")

        from routers.analysis import _call_llm, log_llm_usage

        prompt = _build_bot_squad_prompt(db, match, decided)
        start = time.time()
        result, model_tag, usage = _call_llm(cfg, prompt, chain=chain)
        duration_ms = int((time.time() - start) * 1000)

        try:
            log_llm_usage(db, trigger="bot_squad", model_tag=model_tag, usage=usage,
                           match_id=match.id, duration_ms=duration_ms)
        except Exception:
            pass  # log_llm_usage já se blinda sozinha; blindagem dupla aqui é barata

        reasons = _extract_reasons_array(result)
        if not reasons or len(reasons) != n:
            got = len(reasons) if reasons else 0
            raise ValueError(f"esperava {n} justificativas, LLM devolveu {got}")

        cleaned = [str(r).strip() for r in reasons]
        if any(not r for r in cleaned):
            raise ValueError("justificativa vazia no array retornado")
        return cleaned

    except Exception as e:
        print(f"[bot_squad] generate_reasons via LLM falhou (fallback determinístico), jogo {match.id}: {e}", flush=True)
        return [
            fallback_reason(
                item["archetype"], item.get("params") or {}, item["score_a"], item["score_b"],
                match.team_a.name, match.team_b.name,
            )
            for item in decided
        ]


# ─── Fallback determinístico (sem LLM) ────────────────────────────────────────

_FALLBACK_TEMPLATES: dict[str, list[str]] = {
    "cauteloso": [
        "Prefiro não me empolgar, vou de {score}. Ninguém ganha título em julho.",
        "Com calma nessa: {score} é o que dá pra confiar hoje.",
        "Sem arriscar demais — {score} e sigo vivo no bolão.",
    ],
    "zebra": [
        "Todo mundo vai no óbvio, eu vou de {score}. Zebra existe pra isso.",
        "Duvido do favorito — {score} e quero ver quem ri por último.",
        "Se ninguém acredita em {score}, é exatamente por isso que eu acredito.",
    ],
    "torcedor-fanatico": [
        "Só pode ser {score}, meu time não vai me decepcionar hoje!",
        "Confio de olhos fechados: {score} e a gente comemora junto.",
        "Nem preciso pensar muito — {score}, é fé total.",
    ],
    "estatistica": [
        "Números não mentem: {score} é o resultado mais provável pelos dados.",
        "Rodei a conta na cabeça, {score} bate com o histórico dos dois.",
        "Estatisticamente, {score} é a aposta mais racional aqui.",
    ],
    "goleada": [
        "Vai ter gol pra todo lado, fecho em {score}.",
        "Jogo aberto desses eu não perco — {score} sem medo.",
        "Ataque solto dos dois lados, só pode terminar {score}.",
    ],
    "empatista": [
        "Times parecidos, resultado equilibrado — vou de {score}.",
        "Ninguém vai querer perder esse, fico com {score}.",
        "Jogo truncado tende ao {score}, ninguém arrisca demais.",
    ],
    "home-crente": [
        "Fator casa pesa muito, vou de {score}.",
        "Jogando em casa não tem erro: {score}.",
        "Casa é casa — {score} e ponto final.",
    ],
    "contrarian": [
        "Enquanto todo mundo vai no favorito, eu vou de {score}.",
        "Prefiro fugir do óbvio — {score} é minha aposta diferente.",
        "Contra a maré de novo: {score}, depois é só comemorar.",
    ],
}

_GENERIC_FALLBACK = [
    "Bati o olho nesse jogo e fechei em {score}.",
    "Vou de {score} nessa — instinto de apostador mesmo.",
    "Depois de pensar um pouco, decidi {score}.",
]


def fallback_reason(
    archetype: str, params: dict, score_a: int, score_b: int, team_a_name: str, team_b_name: str
) -> str:
    """Justificativa determinística (sem LLM), mínimo 3 variantes por
    arquétipo. Variação escolhida por hash estável dos próprios argumentos —
    mesma entrada sempre devolve a mesma frase. Exceção NUNCA propaga."""
    try:
        templates = _FALLBACK_TEMPLATES.get(archetype) or _GENERIC_FALLBACK
        key = f"{archetype}|{score_a}|{score_b}|{team_a_name}|{team_b_name}|{sorted((params or {}).items())}"
        template = templates[_sha_int(key) % len(templates)]
        return template.format(score=f"{score_a}x{score_b}", team_a=team_a_name, team_b=team_b_name)
    except Exception:
        return f"Vou de {score_a}x{score_b} nessa."


# ─── Revisão T-3h (re-roda engine com dado fresco, ajusta bots pouco teimosos) ─

def _comp_label(match: Match, br_id: int | None) -> str:
    if br_id is not None and match.competition_id == br_id:
        return "Brasileirão"
    return "Copa do Mundo 2026"


def _result_1x2(score_a: int, score_b: int) -> str:
    if score_a > score_b:
        return "a"
    if score_a < score_b:
        return "b"
    return "draw"


def _send_telegram(db: Session, text: str) -> bool:
    """Envia 1 mensagem simples pro Telegram — mesmo padrão de
    `projections.py` (~linha 286): token/chat de `site_config`
    (`telegram_bot_token`/`telegram_chat_id`), `parse_mode=HTML`. Retorna True
    só com envio confirmado (2xx); NUNCA propaga exceção — chamador decide
    o que fazer (claim-then-send já commitou a review antes de chamar isso)."""
    try:
        from routers.report import _telegram_config

        token, chat = _telegram_config(db)
        if not token or not chat:
            print("[bot_squad] Telegram não configurado, pulando envio", flush=True)
            return False
        r = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
            timeout=15,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"[bot_squad] erro enviando Telegram: {e}", flush=True)
        return False


def _build_review_telegram_message(match: Match, br_id: int | None, kept: int, adjusted: int, examples: list[str]) -> str:
    comp = _comp_label(match, br_id)
    lines = [
        f"⏱️ REVISÃO T-3h — {match.team_a.name} x {match.team_b.name} ({comp})",
        f"🤖 {kept} mantiveram · {adjusted} ajustaram",
    ]
    if examples:
        lines.extend(f"• {ex}" for ex in examples[:3])
    else:
        lines.append("Todos confiantes nos palpites.")
    return "\n".join(lines)


def run_t3_reviews(db: Session | None = None) -> dict:
    """
    Varre jogos `scheduled` das 2 competições com kickoff em [now+2h30,
    now+3h30] e SEM linha em `bot_squad_reviews` — re-roda o engine com dado
    fresco (mesmo caminho de `place_pending_bets`), calcula o resultado 1x2
    do placar recomendado ATUAL via `simulate_match`/`pick_recommended_score`
    (igual `routers/matches.py`), e ajusta a aposta de bots pouco teimosos
    (`stubbornness < 0.6`) cujo palpite já feito diverge desse resultado.
    Claim-then-send: grava `BotSquadReview` (telegram_sent=False) + commit
    ANTES de mandar Telegram; só marca `telegram_sent=True` após o 2xx.
    Cada jogo isolado em try/except — 1 quebrando não derruba os outros.

    Retorna {"reviewed", "adjusted_total", "kept_total", "telegram_sent"}.
    """
    own_session = db is None
    db = db or SessionLocal()
    summary = {"reviewed": 0, "adjusted_total": 0, "kept_total": 0, "telegram_sent": 0}
    try:
        now = _utcnow()
        window_start = now + BOT_SQUAD_REVIEW_WINDOW_START
        window_end = now + BOT_SQUAD_REVIEW_WINDOW_END

        copa_id = get_competition_id(db, "copa2026")
        br_id = get_competition_id(db, "brasileirao2026")
        comp_ids = [cid for cid in (copa_id, br_id) if cid is not None]
        if not comp_ids:
            print("[bot_squad] revisão T-3h: nenhuma competição encontrada — abortando", flush=True)
            return summary

        reviewed_match_ids = {mid for (mid,) in db.query(BotSquadReview.match_id).all()}

        matches = (
            db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .filter(
                Match.competition_id.in_(comp_ids),
                Match.status == MatchStatus.scheduled,
                Match.match_date.isnot(None),
                Match.match_date >= window_start,
                Match.match_date <= window_end,
            )
            .all()
        )
        matches = [m for m in matches if m.id not in reviewed_match_ids]
        if not matches:
            print("[bot_squad] revisão T-3h: nenhum jogo na janela sem revisão", flush=True)
            return summary

        for match in matches:
            try:
                _review_match(db, match, br_id, now, summary)
            except Exception as e:
                db.rollback()
                print(f"[bot_squad] erro na revisão T-3h do jogo {match.id}: {e}", flush=True)

        return summary
    finally:
        if own_session:
            db.close()


def _review_match(db: Session, match: Match, br_id: int | None, now: datetime, summary: dict) -> None:
    bot_rows = (
        db.query(Bet, BotPersona, User.name)
        .join(BotPersona, BotPersona.user_id == Bet.user_id)
        .join(User, User.id == Bet.user_id)
        .filter(Bet.match_id == match.id)
        .all()
    )
    if not bot_rows:
        return  # nenhuma aposta de bot ainda nesse jogo — nada a revisar

    ta_input = _team_to_input(match.team_a)
    tb_input = _team_to_input(match.team_b)
    h2h = get_h2h_cached(db, match.team_a.code, match.team_b.code)  # cache-only, mesmo padrão de place_pending_bets
    phase_str = match.phase.value if match.phase else "group"
    lambda_a, lambda_b, _weights_used = compute_weighted_lambdas(
        ta_input, tb_input, is_neutral=match.is_neutral, phase=phase_str, h2h=h2h,
    )

    sim = simulate_match(lambda_a, lambda_b, n=settings.mc_simulations)
    rec = sim["recommended_score"]
    rec_a, rec_b = (int(x) for x in rec["score"].split("x"))
    rec_result = _result_1x2(rec_a, rec_b)

    is_knockout = match.phase != MatchPhase.group and match.competition_id != br_id
    prob_a = prob_b = None
    if is_knockout:
        prob_a, _prob_draw, prob_b = elo_win_probabilities(
            float(match.team_a.elo_rating), float(match.team_b.elo_rating), bool(match.is_neutral)
        )

    db_weights = None  # só calcula (lazy) se algum bot realmente precisar reamostrar
    adjusted: list[dict] = []
    kept_count = 0

    for bet, persona, name in bot_rows:
        params = persona.params or {}
        stubbornness = float(params.get("stubbornness", 0.5))
        bet_result = _result_1x2(bet.score_a, bet.score_b)
        needs_change = stubbornness < BOT_SQUAD_STUBBORNNESS_THRESHOLD and bet_result != rec_result

        if not needs_change or not (match.match_date and match.match_date > now):
            kept_count += 1
            continue

        if db_weights is None:
            db_weights = dc_score_weights(lambda_a, lambda_b)

        fav_code = persona.favorite_team_code
        is_fav_a = bool(fav_code) and fav_code == match.team_a.code
        is_fav_b = bool(fav_code) and fav_code == match.team_b.code

        old_a, old_b = bet.score_a, bet.score_b
        seed_str = f"{persona.user_id}:{match.id}:{BOT_SQUAD_REVIEW_SEED_VERSION}"
        new_a, new_b = persona_sample_score(db_weights, params, is_fav_a, is_fav_b, seed_str)

        bet.score_a, bet.score_b = new_a, new_b
        if is_knockout:
            bet.et_winner_pick = _et_winner_pick(prob_a, prob_b, is_fav_a, is_fav_b)

        adjusted.append({
            "user_id": persona.user_id, "name": name, "archetype": persona.archetype,
            "bio": persona.bio, "params": params,
            "score_a": new_a, "score_b": new_b, "bet": bet,
            "old_score": f"{old_a}x{old_b}", "new_score": f"{new_a}x{new_b}",
        })

    if adjusted:
        db.flush()
        try:
            reasons = generate_reasons(db, match, adjusted)
            for item, reason in zip(adjusted, reasons):
                item["bet"].bot_reason = reason
        except Exception as e:
            # generate_reasons já se blinda sozinha — blindagem dupla aqui é barata;
            # reason antigo fica como estava se isso explodir.
            print(f"[bot_squad] generate_reasons (revisão) falhou, jogo {match.id}: {e}", flush=True)

    adjusted_count = len(adjusted)
    examples = [f"{a['name'].split()[0]}: {a['old_score']} → {a['new_score']}" for a in adjusted[:3]]
    summary_text = f"{kept_count} mantiveram, {adjusted_count} ajustaram"
    if examples:
        summary_text += " — " + " | ".join(examples)

    review = BotSquadReview(
        match_id=match.id, adjusted_count=adjusted_count, kept_count=kept_count,
        summary=summary_text, telegram_sent=False,
    )
    db.add(review)
    db.commit()  # CLAIM antes de enviar Telegram — regra anti-flood da casa

    summary["reviewed"] += 1
    summary["adjusted_total"] += adjusted_count
    summary["kept_total"] += kept_count
    print(
        f"[bot_squad] revisão T-3h jogo {match.id} ({match.team_a.code} x {match.team_b.code}): "
        f"{summary_text}", flush=True,
    )

    try:
        text_msg = _build_review_telegram_message(match, br_id, kept_count, adjusted_count, examples)
        if _send_telegram(db, text_msg):
            review.telegram_sent = True
            db.commit()
            summary["telegram_sent"] += 1
    except Exception as e:
        db.rollback()
        print(f"[bot_squad] telegram da revisão T-3h falhou, jogo {match.id}: {e}", flush=True)


if __name__ == "__main__":
    print(place_pending_bets())
    print(run_t3_reviews())
