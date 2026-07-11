"""
Projeção automática de partidas pro Telegram (Elo/forma/xG/campanha do banco +
H2H all-time, via banco se já existir ou via IA na primeira vez).

Roda dentro de update_world_cup_data.py (cron 5min). Envia uma única vez por
partida, ORACLE_PROJECTION_WINDOW_HOURS antes do kickoff (match_projections
controla o "já enviado").

H2H: fatos estáveis (resultados passados não mudam), então uma vez buscado —
por IA ou por pesquisa manual — fica cacheado em team_head_to_head e nunca
mais precisa re-buscar pro mesmo par de seleções.
"""
import html as _html
import json
from datetime import timedelta

import httpx
from sqlalchemy.orm import Session, joinedload

from competitions import get_competition_id
from database import SessionLocal
from models import Match, MatchStatus, MatchProjection, TeamHeadToHead
from engine.weights import compute_weighted_lambdas
from engine.monte_carlo import simulate_match
from routers.matches import _team_to_input
from h2h_lookup import get_h2h_cached

PROJECTION_WINDOW_HOURS = 24


def _utcnow():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _fetch_h2h_via_llm(db: Session, team_a_name: str, team_b_name: str) -> dict | None:
    from routers.analysis import _get_config, _get_provider_chain, _call_llm

    cfg = _get_config(db)
    chain = _get_provider_chain(cfg)
    if not chain:
        return None

    prompt = (
        f"Você é um estatístico de futebol internacional. Recorde o retrospecto histórico "
        f"ALL-TIME (todas as competições: Copas, eliminatórias, amistosos) entre "
        f"{team_a_name} e {team_b_name} nas seleções principais masculinas.\n\n"
        "Responda em JSON PURO (sem markdown):\n"
        "{\n"
        f'  "wins_a": <int, vitórias de {team_a_name}>,\n'
        f'  "wins_b": <int, vitórias de {team_b_name}>,\n'
        '  "draws": <int, empates>,\n'
        '  "total_matches": <int>,\n'
        '  "summary": "2-4 frases em PT-BR citando os confrontos mais relevantes (Copas, data, placar)",\n'
        '  "recent_results": [\n'
        '    {"date": "AAAA ou MM/AAAA", "competition": "ex: Copa 2014, Amistoso", '
        '"result": "frase curta com o placar, ex: Bélgica 2x1 EUA"},\n'
        "    ... até 3 itens, do jogo MAIS RECENTE pro mais antigo\n"
        "  ]\n"
        "}\n"
        "Se não tiver certeza do número exato, dê a melhor estimativa plausível baseada no que sabe "
        "e deixe isso implícito no summary (ex: 'poucos confrontos registrados'). "
        "recent_results pode ter menos de 3 itens se não houver confrontos suficientes, ou lista vazia se não souber nenhum."
    )
    try:
        content, model_tag, _usage = _call_llm(cfg, prompt, chain=chain)
        recent = content.get("recent_results") or []
        recent_results = [
            {
                "date": str(r.get("date") or "")[:20],
                "competition": str(r.get("competition") or "")[:60],
                "result": str(r.get("result") or "")[:150],
            }
            for r in recent[:3] if isinstance(r, dict)
        ]
        return {
            "wins_a": int(content.get("wins_a") or 0),
            "wins_b": int(content.get("wins_b") or 0),
            "draws": int(content.get("draws") or 0),
            "total_matches": int(content.get("total_matches") or 0),
            "summary": str(content.get("summary") or "")[:1000],
            "recent_results": recent_results,
            "model_tag": model_tag,
        }
    except Exception as e:
        print(f"[projections] H2H via IA falhou: {e}", flush=True)
        return None


def _get_or_fetch_h2h(db: Session, code_a: str, code_b: str, name_a: str, name_b: str) -> dict | None:
    cached = get_h2h_cached(db, code_a, code_b)
    if cached:
        return cached

    fetched = _fetch_h2h_via_llm(db, name_a, name_b)
    if not fetched:
        return None

    row = TeamHeadToHead(
        team_a_code=code_a, team_b_code=code_b,
        wins_a=fetched["wins_a"], wins_b=fetched["wins_b"], draws=fetched["draws"],
        total_matches=fetched["total_matches"], summary=fetched["summary"],
        recent_results=json.dumps(fetched.get("recent_results") or [], ensure_ascii=False),
        source=f"llm/{fetched.get('model_tag', '?')}",
    )
    db.add(row)
    db.commit()
    return {**fetched, "total": fetched["total_matches"], "flip": False}


def _campanha(db: Session, match: Match, team_id: int, team_code: str) -> str:
    from sqlalchemy import or_
    rows = (
        db.query(Match)
        .options(joinedload(Match.result), joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(
            or_(Match.team_a_id == team_id, Match.team_b_id == team_id),
            Match.id != match.id,
            Match.status == MatchStatus.finished,
        )
        .order_by(Match.match_date.desc())
        .limit(4)
        .all()
    )
    rows = list(reversed(rows))
    parts = []
    for m in rows:
        if not m.result:
            continue
        is_a = m.team_a_id == team_id
        my_score = m.result.score_a if is_a else m.result.score_b
        opp_score = m.result.score_b if is_a else m.result.score_a
        opp = m.team_b.code if is_a else m.team_a.code
        tag = f" ({m.phase.value})" if m.phase and m.phase.value != "group" else ""
        parts.append(f"{my_score}x{opp_score} {opp}{tag}")
    return " · ".join(parts) if parts else "sem jogos anteriores nesta Copa"


def _pt(v: float, casas: int = 1) -> str:
    return f"{float(v):.{casas}f}".replace(".", ",")


def build_analysis_body(db: Session, match: Match, cache_only: bool = False) -> list[str] | None:
    """
    Bloco de dados (probabilidades → fundamentação → campanha → H2H → modelo),
    sem cabeçalho. Compartilhado entre a Projeção automática (Telegram 24h antes)
    e o Oráculo Predictor (routers/bot.py) — mesma fundamentação, cabeçalhos
    diferentes, pra não duplicar o cálculo de lambdas/Monte Carlo/H2H em dois
    lugares.

    cache_only=True: H2H só do cache (sem fallback LLM) — pra chamadas síncronas
    com latência crítica (ex.: resposta do bot no webhook do WhatsApp). Par sem
    cache = seção H2H simplesmente não entra.
    """
    ta, tb = match.team_a, match.team_b
    if not ta or not tb:
        return None

    ta_in = _team_to_input(ta)
    tb_in = _team_to_input(tb)
    phase_str = match.phase.value if match.phase else "group"
    if cache_only:
        h2h = get_h2h_cached(db, ta.code, tb.code)
    else:
        h2h = _get_or_fetch_h2h(db, ta.code, tb.code, ta.name, tb.name)
    lambda_a, lambda_b, weights_used = compute_weighted_lambdas(
        ta_in, tb_in, is_neutral=match.is_neutral, phase=phase_str, h2h=h2h,
    )
    sim = simulate_match(lambda_a, lambda_b, n=500_000)

    rec = sim["recommended_score"]
    alt_scores = [s for s in sim["top_scores"] if s["score"] != rec["score"]][:3]
    alt = " · ".join(f"{s['score']} ({_pt(s['prob'])}%)" for s in alt_scores)

    lines = [
        "📊 <b>Probabilidades</b>",
        f"Vitória {ta.code}: {_pt(sim['prob_a'])}%",
        f"Empate: {_pt(sim['prob_draw'])}%",
        f"Vitória {tb.code}: {_pt(sim['prob_b'])}%",
        "",
        f"⚽ <b>xG esperado</b>: {ta.code} {_pt(lambda_a, 2)} x {_pt(lambda_b, 2)} {tb.code}",
        f"🎯 <b>Placar recomendado: {rec['score']}</b> (prob. {_pt(rec['prob'])}%)",
        f"Alternativos: {alt}",
        "",
        "📐 <b>Fundamentação</b>",
        "",
        f"<u>Elo</u>: {ta.name} {float(ta.elo_rating):.0f} vs {tb.name} {float(tb.elo_rating):.0f}",
        f"<u>Forma (10 jogos)</u>: {ta.code} {float(ta.form_10)*100:.0f}% vs {tb.code} {float(tb.form_10)*100:.0f}%",
        f"<u>Ataque (xG/jogo)</u>: {ta.code} {_pt(ta.xg_for, 2)} vs {tb.code} {_pt(tb.xg_for, 2)}",
        f"<u>Defesa (xGA/jogo)</u>: {ta.code} {_pt(ta.xg_against, 2)} vs {tb.code} {_pt(tb.xg_against, 2)}",
        "",
        "<u>Campanha nesta Copa</u>:",
        f"{ta.code}: {_campanha(db, match, ta.id, ta.code)}",
        f"{tb.code}: {_campanha(db, match, tb.id, tb.code)}",
    ]

    if h2h:
        lines += [
            "",
            "<u>Histórico entre as seleções (all-time)</u>:",
            h2h.get("summary") or f"{h2h['wins_a']}x{h2h['wins_b']} ({h2h['draws']} empates) em {h2h.get('total') or h2h.get('total_matches')} jogos",
        ]

    lines += [
        "",
        f"<i>Modelo: {_pt(weights_used.get('market_odds', 0))}% odds (Elo-implícito) + {_pt(weights_used.get('xg', 0))}% xG cruzado</i>",
    ]
    return lines


def build_projection_message(db: Session, match: Match, cache_only: bool = False) -> str | None:
    ta, tb = match.team_a, match.team_b
    if not ta or not tb:
        return None

    phase_str = match.phase.value if match.phase else "group"
    local_dt = match.match_date - timedelta(hours=3) if match.match_date else None
    date_str = local_dt.strftime("%d/%m, %Hh (Brasília)") if local_dt else "data a definir"

    phase_label = {
        "group": "Fase de Grupos", "r32": "Rodada de 32", "r16": "Oitavas de Final",
        "qf": "Quartas de Final", "sf": "Semifinal", "3rd": "Terceiro Lugar", "final": "Final",
    }.get(phase_str, phase_str)

    body = build_analysis_body(db, match, cache_only=cache_only)
    if body is None:
        return None

    header = [
        f"🔮 <b>PROJEÇÃO — {phase_label}</b>",
        f"<b>{_html.escape(ta.name)}</b> x <b>{_html.escape(tb.name)}</b>",
        date_str,
        "",
    ]
    return "\n".join(header + body)


def send_pending_projections(db: Session | None = None, log=print) -> dict:
    from routers.report import _telegram_config

    own_session = db is None
    db = db or SessionLocal()
    sent, errors = 0, []
    try:
        token, chat = _telegram_config(db)
        if not token or not chat:
            log("[projections] Telegram não configurado, abortando")
            return {"sent": 0, "errors": ["telegram não configurado"]}

        cutoff = _utcnow() + timedelta(hours=PROJECTION_WINDOW_HOURS)
        already_sent = {row[0] for row in db.query(MatchProjection.match_id).all()}

        candidates = (
            db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .filter(
                Match.status == MatchStatus.scheduled,
                Match.match_date.isnot(None),
                Match.match_date <= cutoff,
                Match.match_date > _utcnow(),
                Match.competition_id == get_competition_id(db),
            )
            .all()
        )

        for m in candidates:
            if m.id in already_sent:
                continue
            try:
                msg = build_projection_message(db, m)
                if not msg:
                    continue
                r = httpx.post(
                    f"https://api.telegram.org/bot{token}/sendMessage",
                    json={"chat_id": chat, "text": msg, "parse_mode": "HTML", "disable_web_page_preview": True},
                    timeout=15,
                )
                r.raise_for_status()
                tg_msg_id = r.json().get("result", {}).get("message_id")
                db.add(MatchProjection(match_id=m.id, telegram_message_id=tg_msg_id))
                db.commit()
                sent += 1
                log(f"[projections] enviado: {m.team_a.code} x {m.team_b.code} (match {m.id})")
            except Exception as e:
                db.rollback()
                errors.append(f"match {m.id}: {e}")
                log(f"[projections] erro no match {m.id}: {e}")

        return {"sent": sent, "errors": errors}
    finally:
        if own_session:
            db.close()


if __name__ == "__main__":
    print(send_pending_projections())
