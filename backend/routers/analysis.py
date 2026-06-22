"""
GET  /matches/{id}/analysis              — análise pública (cache DB)
POST /admin/analysis/{match_id}/generate — gera/regenera uma partida
POST /admin/analysis/generate-all        — gera todas as pendentes (bg task)
GET  /admin/analysis/status              — lista partidas + status análise
GET  /admin/analysis/config              — lê config providers
POST /admin/analysis/config              — salva config providers
"""
import json
import logging
from datetime import datetime, timezone

import requests as http_requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth_utils import require_admin
from database import get_db
from models import Team, User

log = logging.getLogger(__name__)
router = APIRouter(tags=["analysis"])

# ─── Provider catalogs ────────────────────────────────────────────────────────

OPENROUTER_FREE_MODELS = [
    {"id": "nvidia/nemotron-3-ultra-550b-a55b:free",       "label": "🆓 Nvidia Nemotron Ultra 550B"},
    {"id": "nousresearch/hermes-3-llama-3.1-405b:free",    "label": "🆓 Hermes 3 Llama 405B"},
    {"id": "openai/gpt-oss-120b:free",                     "label": "🆓 GPT OSS 120B"},
    {"id": "nvidia/nemotron-3-super-120b-a12b:free",       "label": "🆓 Nvidia Nemotron Super 120B"},
    {"id": "qwen/qwen3-next-80b-a3b-instruct:free",        "label": "🆓 Qwen3 Next 80B"},
    {"id": "meta-llama/llama-3.3-70b-instruct:free",       "label": "🆓 Llama 3.3 70B"},
    {"id": "google/gemma-4-31b-it:free",                   "label": "🆓 Gemma 4 31B"},
    # Pagos — melhores modelos
    {"id": "anthropic/claude-opus-4",                      "label": "💎 Claude Opus 4"},
    {"id": "anthropic/claude-sonnet-4-5",                  "label": "💎 Claude Sonnet 4.5"},
    {"id": "openai/gpt-4o",                                "label": "💎 GPT-4o"},
    {"id": "openai/gpt-4.1",                               "label": "💎 GPT-4.1"},
    {"id": "google/gemini-2.5-pro",                        "label": "💎 Gemini 2.5 Pro (via OR)"},
    {"id": "google/gemini-2.5-flash",                      "label": "💎 Gemini 2.5 Flash (via OR)"},
    {"id": "deepseek/deepseek-r1",                         "label": "💎 DeepSeek R1"},
    {"id": "meta-llama/llama-4-maverick",                  "label": "💎 Llama 4 Maverick"},
    {"id": "x-ai/grok-3",                                  "label": "💎 Grok 3"},
]

GEMINI_MODELS = [
    {"id": "gemini-3.5-flash",                "label": "Gemini 3.5 Flash (mais novo)"},
    {"id": "gemini-2.5-pro",                  "label": "Gemini 2.5 Pro (mais capaz)"},
    {"id": "gemini-2.5-pro-preview-06-05",    "label": "Gemini 2.5 Pro Preview jun/25"},
    {"id": "gemini-2.5-flash",                "label": "Gemini 2.5 Flash"},
    {"id": "gemini-2.5-flash-preview-05-20",  "label": "Gemini 2.5 Flash Preview mai/25"},
    {"id": "gemini-2.0-flash",                "label": "Gemini 2.0 Flash"},
    {"id": "gemini-2.0-flash-lite",           "label": "Gemini 2.0 Flash Lite"},
]

DEFAULT_OR_MODEL    = "nvidia/nemotron-3-ultra-550b-a55b:free"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"
DEFAULT_PROVIDER    = "openrouter"

CONFIG_KEYS = (
    "analysis_provider",
    "openrouter_api_key", "openrouter_model",
    "gemini_api_key",     "gemini_api_key_2", "gemini_model",
    "analysis_prompt_template",
)

BEST_FREE_OR_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "•" * len(key)
    return key[:6] + "•" * 20 + key[-4:]


# ─── Config helpers ───────────────────────────────────────────────────────────

def _get_config(db: Session) -> dict:
    rows = db.execute(
        text(f"SELECT key, value FROM site_config WHERE key IN {CONFIG_KEYS}")
    ).fetchall()
    c = {r[0]: r[1] for r in rows}
    return {
        "provider":          c.get("analysis_provider", DEFAULT_PROVIDER),
        "openrouter_key":    c.get("openrouter_api_key", ""),
        "openrouter_model":  c.get("openrouter_model", DEFAULT_OR_MODEL),
        "gemini_key":        c.get("gemini_api_key", ""),
        "gemini_key_2":      c.get("gemini_api_key_2", ""),
        "gemini_model":      c.get("gemini_model", DEFAULT_GEMINI_MODEL),
        "prompt_template":   c.get("analysis_prompt_template", "") or "",
    }


def _get_provider_chain(cfg: dict) -> list[dict]:
    """Retorna cadeia de fallback: Gemini1 → Gemini2 → OpenRouter best free."""
    chain = []
    if cfg.get("gemini_key"):
        chain.append({"type": "gemini", "key": cfg["gemini_key"], "model": cfg["gemini_model"], "label": "Gemini key1"})
    if cfg.get("gemini_key_2"):
        chain.append({"type": "gemini", "key": cfg["gemini_key_2"], "model": cfg["gemini_model"], "label": "Gemini key2"})
    if cfg.get("openrouter_key"):
        chain.append({"type": "openrouter", "key": cfg["openrouter_key"], "model": BEST_FREE_OR_MODEL, "label": f"OpenRouter {BEST_FREE_OR_MODEL}"})
    return chain


def _upsert(db: Session, key: str, val: str):
    db.execute(
        text("INSERT INTO site_config (key, value) VALUES (:k, :v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"),
        {"k": key, "v": val},
    )


def _save_config(db: Session, provider: str, or_key: str, or_model: str, g_key: str, g_model: str):
    _upsert(db, "analysis_provider",  provider)
    _upsert(db, "openrouter_model",   or_model)
    _upsert(db, "gemini_model",       g_model)
    if or_key and not or_key.startswith("•"):
        _upsert(db, "openrouter_api_key", or_key)
    if g_key and not g_key.startswith("•"):
        _upsert(db, "gemini_api_key", g_key)
    db.commit()


# ─── LLM callers ─────────────────────────────────────────────────────────────

def _strip_fences(text_out: str) -> str:
    text_out = text_out.strip()
    if text_out.startswith("```"):
        parts = text_out.split("```")
        text_out = parts[1] if len(parts) > 1 else text_out
        if text_out.startswith("json"):
            text_out = text_out[4:]
    return text_out.strip()


def _call_openrouter(api_key: str, model: str, prompt: str) -> dict:
    resp = http_requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://predicts.info",
            "X-Title": "Predicts Copa 2026",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 8000,
        },
        timeout=90,
    )
    resp.raise_for_status()
    return json.loads(_strip_fences(resp.json()["choices"][0]["message"]["content"]))


def _call_gemini(api_key: str, model: str, prompt: str) -> dict:
    try:
        from google import genai
        from google.genai import types as genai_types
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                max_output_tokens=8192,
                temperature=0.7,
            ),
        )
        text_out = response.text
    except Exception:
        # Fallback para REST se SDK não disponível ou der erro
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        resp = http_requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.7},
            },
            timeout=90,
        )
        resp.raise_for_status()
        text_out = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(_strip_fences(text_out))


def _is_quota_error(err: str) -> bool:
    low = err.lower()
    return "429" in err or "too many requests" in low or "resource_exhausted" in low or "quota" in low or "rate" in low


def _call_llm(cfg: dict, prompt: str, provider_state: list | None = None) -> tuple[dict, str]:
    """
    Chama LLM com fallback automático: Gemini key1 → Gemini key2 → OpenRouter best free.
    provider_state: lista de 1 elemento [idx] compartilhada entre chamadas do mesmo lote.
    """
    chain = _get_provider_chain(cfg)
    if not chain:
        raise ValueError("Nenhum provider configurado (configure Gemini ou OpenRouter)")

    start = provider_state[0] if provider_state else 0
    for idx in range(start, len(chain)):
        p = chain[idx]
        try:
            if p["type"] == "gemini":
                result = _call_gemini(p["key"], p["model"], prompt)
            else:
                result = _call_openrouter(p["key"], p["model"], prompt)
            if provider_state is not None:
                provider_state[0] = idx  # mantém no provider que funcionou
            return result, f"{p['type']}/{p['model']}"
        except Exception as e:
            if _is_quota_error(str(e)) and idx < len(chain) - 1:
                print(f"[analysis] {p['label']} exausto → {chain[idx+1]['label']}", flush=True)
                if provider_state is not None:
                    provider_state[0] = idx + 1
                continue
            raise  # último provider ou erro não-quota: propaga

    raise ValueError("Todos os providers da cadeia exaustos")


DEFAULT_PROMPT_TEMPLATE = (
    "Você é um jornalista esportivo sênior especializado em futebol internacional, "
    "com décadas de cobertura de Copas do Mundo e profundo conhecimento tático.\n"
    "Analise a partida {team_a_name} × {team_b_name} com rigor técnico e paixão futebolística.\n\n"
    "REGRAS OBRIGATÓRIAS:\n"
    "- Escreva em PORTUGUÊS BRASILEIRO fluente, estilo ESPN/Globo Esporte\n"
    "- Use os DADOS FORNECIDOS como base factual; enriqueça com conhecimento tático real de cada seleção\n"
    "- Cite jogadores específicos da convocação com posição e função real (ex: 'Vinicius Jr., ponta-esquerda veloz que explora espaços')\n"
    "- Mencione sistemas táticos concretos (4-3-3, 4-2-3-1, 3-5-2, etc.) com base no estilo reconhecido de cada CT\n"
    "- Contextualize no grupo/fase: classificação atual, o que cada resultado significa\n"
    "- Seja CIRÚRGICO em predições: placar, quem marca, em que fase do jogo\n"
    "- Fale de duelos individuais relevantes: qual zagueiro vai marcar qual atacante\n\n"
    "## DADOS DA PARTIDA\n"
    "Fase: {phase} | Grupo: {group_name} | Data: {match_date}\n\n"
    "## {team_a_name} ({team_a_code}) — ELO {team_a_elo}\n"
    "Histórico Copa: {team_a_wc_apps} participações | Melhor: {team_a_best}\n"
    "Ataque: {team_a_avg_gf} gols/jogo | xG {team_a_xg} | Defesa: {team_a_avg_ga} sofridos | xGA {team_a_xga}\n"
    "Forma — últimos 5: {team_a_form5} | últimos 10: {team_a_form10}\n"
    "Convocados:\n{team_a_players}\n"
    "Resultados nesta Copa:\n{team_a_results}\n\n"
    "## {team_b_name} ({team_b_code}) — ELO {team_b_elo}\n"
    "Histórico Copa: {team_b_wc_apps} participações | Melhor: {team_b_best}\n"
    "Ataque: {team_b_avg_gf} gols/jogo | xG {team_b_xg} | Defesa: {team_b_avg_ga} sofridos | xGA {team_b_xga}\n"
    "Forma — últimos 5: {team_b_form5} | últimos 10: {team_b_form10}\n"
    "Convocados:\n{team_b_players}\n"
    "Resultados nesta Copa:\n{team_b_results}\n"
    "{mc_probs}\n"
    "## SAÍDA — JSON PURO (sem markdown, sem ```):\n"
    '{{\n'
    '  "overview": "3 parágrafos: (1) contexto e o que está em jogo — mencione pontos na tabela, situação de classificação; '
    '(2) histórico entre as seleções em Copas — confrontos anteriores, rivalidade, surpresas históricas; '
    '(3) estado atual neste torneio — quem entrou bem, quem decepcionou até aqui",\n'
    '  "team_a": {{\n'
    '    "tactical": "Sistema tático específico com nome (ex: 4-3-3 de pressão alta), como se organizam defensiva e ofensivamente, '
    'transição, posse ou contra-ataque, set-pieces",\n'
    '    "key_players": [\n'
    '      "Nome Completo (posição real) — papel específico neste jogo e por que é determinante",\n'
    '      "Nome Completo (posição) — função tática e ameaça concreta",\n'
    '      "Nome Completo (posição) — impacto esperado"\n'
    '    ],\n'
    '    "form": "Desempenho nos jogos desta Copa: gols, assistências, consistência defensiva, '
    'lesões confirmadas ou dúvidas, rotação de titulares esperada",\n'
    '    "strengths": "3-4 qualidades concretas no contexto deste confronto — o que fazem melhor que o adversário",\n'
    '    "weaknesses": "2-3 vulnerabilidades reais que {team_b_name} pode explorar hoje — seja cirúrgico"\n'
    '  }},\n'
    '  "team_b": {{\n'
    '    "tactical": "...",\n'
    '    "key_players": ["...", "...", "..."],\n'
    '    "form": "...",\n'
    '    "strengths": "...",\n'
    '    "weaknesses": "2-3 vulnerabilidades que {team_a_name} pode explorar"\n'
    '  }},\n'
    '  "matchup": "2 parágrafos: (1) batalha tática principal — onde o jogo será decidido '
    '(duelos no meio, velocidade vs. bloco defensivo, bola aérea, bola parada), cite duelos individuais concretos; '
    '(2) fator X — o que pode mudar o jogo inesperadamente (substituição, expulsão, gol contra, árbitro)",\n'
    '  "prediction": "2 parágrafos: (1) como o jogo deve se desenvolver fase por fase — '
    'quem controla o início, quando surge a primeira grande chance, como o placar tende a se abrir; '
    '(2) placar mais provável com justificativa estatística, citar quem marca e em que período do jogo",\n'
    '  "verdict": "Uma frase direta e opinativa: ex. \'{team_a_name} favorita por qualidade no meio-campo\' | '
    '\'Equilíbrio total — clássico pode terminar no detalhe\' | \'{team_b_name} surpreende com velocidade no contra-ataque\'"\n'
    '}}'
)


# ─── Prompt builder ───────────────────────────────────────────────────────────

def _build_prompt(match_row, team_a: Team, team_b: Team, players_a, players_b, recent_a, recent_b, mc_prob, custom_template: str = "") -> str:
    def fmt_players(players):
        pos_order = {"GK": 0, "DF": 1, "MF": 2, "FW": 3}
        pos_label = {"GK": "GOL", "DF": "DEF", "MF": "MEI", "FW": "ATA"}
        sorted_p = sorted(players, key=lambda p: pos_order.get(p.position, 9))
        lines, cur_pos = [], None
        for p in sorted_p[:16]:
            lbl = pos_label.get(p.position, p.position)
            if lbl != cur_pos:
                lines.append(f"  [{lbl}]")
                cur_pos = lbl
            lines.append(f"    • {p.name}")
        return "\n".join(lines)

    def fmt_results(results):
        if not results:
            return "  Sem dados disponíveis nesta Copa"
        return "\n".join(
            f"  {r['date']}: {r['team_a']} {r['score_a']}–{r['score_b']} {r['team_b']}"
            for r in results[:5]
        )

    mc_probs = ""
    if mc_prob:
        mc_probs = (
            f"## Probabilidades Monte Carlo (1.000.000 simulações)\n"
            f"  {team_a.name} {mc_prob.get('prob_a', 0):.1f}% | "
            f"Empate {mc_prob.get('prob_draw', 0):.1f}% | "
            f"{team_b.name} {mc_prob.get('prob_b', 0):.1f}%\n"
        )

    template = custom_template.strip() if custom_template else DEFAULT_PROMPT_TEMPLATE
    return template.format(
        team_a_name=team_a.name, team_a_code=team_a.code,
        team_a_elo=team_a.elo_rating or "N/D",
        team_a_wc_apps=team_a.world_cup_appearances or "N/D",
        team_a_best=team_a.best_wc_result or "N/D",
        team_a_avg_gf=team_a.avg_goals_for or "N/D",
        team_a_avg_ga=team_a.avg_goals_against or "N/D",
        team_a_xg=team_a.xg_for or "N/D",
        team_a_xga=team_a.xg_against or "N/D",
        team_a_form5=team_a.form_5 or "N/D",
        team_a_form10=team_a.form_10 or "N/D",
        team_a_players=fmt_players(players_a),
        team_a_results=fmt_results(recent_a),
        team_b_name=team_b.name, team_b_code=team_b.code,
        team_b_elo=team_b.elo_rating or "N/D",
        team_b_wc_apps=team_b.world_cup_appearances or "N/D",
        team_b_best=team_b.best_wc_result or "N/D",
        team_b_avg_gf=team_b.avg_goals_for or "N/D",
        team_b_avg_ga=team_b.avg_goals_against or "N/D",
        team_b_xg=team_b.xg_for or "N/D",
        team_b_xga=team_b.xg_against or "N/D",
        team_b_form5=team_b.form_5 or "N/D",
        team_b_form10=team_b.form_10 or "N/D",
        team_b_players=fmt_players(players_b),
        team_b_results=fmt_results(recent_b),
        phase=match_row.get("phase", "group"),
        group_name=match_row.get("group_name") or "mata-mata",
        match_date=str(match_row.get("match_date", ""))[:10],
        mc_probs=mc_probs,
    )


# ─── Core generator ───────────────────────────────────────────────────────────

def _get_recent_results(db: Session, team_code: str, limit: int = 5) -> list:
    rows = db.execute(
        text("""
            SELECT ta.code, tb.code, mr.score_a, mr.score_b,
                   TO_CHAR(m.match_date, 'DD/MM') AS date
            FROM matches m
            JOIN teams ta ON ta.id = m.team_a_id
            JOIN teams tb ON tb.id = m.team_b_id
            JOIN match_results mr ON mr.match_id = m.id
            WHERE ta.code = :code OR tb.code = :code
            ORDER BY m.match_date DESC LIMIT :lim
        """),
        {"code": team_code, "lim": limit},
    ).fetchall()
    return [{"team_a": r[0], "team_b": r[1], "score_a": r[2], "score_b": r[3], "date": r[4]} for r in rows]


def _get_mc_prob(db: Session, match_id: int) -> dict | None:
    row = db.execute(
        text("SELECT prob_a, prob_draw, prob_b FROM simulations_cache WHERE match_id = :mid LIMIT 1"),
        {"mid": match_id},
    ).fetchone()
    if not row:
        return None
    return {
        "prob_a":    round(float(row[0] or 0) * 100, 1),
        "prob_draw": round(float(row[1] or 0) * 100, 1),
        "prob_b":    round(float(row[2] or 0) * 100, 1),
    }


def _generate_one(match_id: int, db: Session, cfg: dict, provider_state: list | None = None) -> dict:
    row = db.execute(
        text("""
            SELECT m.id, ta.id, tb.id, m.match_date, m.phase, ta.group_name
            FROM matches m
            JOIN teams ta ON ta.id = m.team_a_id
            JOIN teams tb ON tb.id = m.team_b_id
            WHERE m.id = :mid
        """),
        {"mid": match_id},
    ).fetchone()
    if not row:
        raise HTTPException(404, "Partida não encontrada")

    match_row = {"match_date": row[3], "phase": row[4], "group_name": row[5]}
    team_a = db.query(Team).get(row[1])
    team_b = db.query(Team).get(row[2])

    from models import Player
    players_a = db.query(Player).filter_by(team_id=row[1]).all()
    players_b = db.query(Player).filter_by(team_id=row[2]).all()

    prompt          = _build_prompt(match_row, team_a, team_b, players_a, players_b,
                                    _get_recent_results(db, team_a.code),
                                    _get_recent_results(db, team_b.code),
                                    _get_mc_prob(db, match_id),
                                    cfg.get("prompt_template", ""))
    content, model_tag = _call_llm(cfg, prompt, provider_state)

    db.execute(
        text("""
            INSERT INTO match_analyses (match_id, content, model_used, generated_at)
            VALUES (:mid, :content, :model, :now)
            ON CONFLICT (match_id) DO UPDATE
              SET content = EXCLUDED.content,
                  model_used = EXCLUDED.model_used,
                  generated_at = EXCLUDED.generated_at
        """),
        {"mid": match_id, "content": json.dumps(content), "model": model_tag, "now": _utcnow()},
    )
    db.commit()
    return content


def _generate_all_bg(db_url: str, cfg: dict, only_pending: bool = True):
    import time
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(db_url)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    try:
        where = "WHERE NOT EXISTS (SELECT 1 FROM match_analyses ma WHERE ma.match_id = m.id)" if only_pending else ""
        pending = db.execute(
            text(f"""
                SELECT m.id FROM matches m
                {where}
                ORDER BY
                    CASE WHEN m.match_date >= NOW() THEN 0 ELSE 1 END,
                    m.match_date
            """)
        ).fetchall()
        chain = _get_provider_chain(cfg)
        provider_state = [0]  # índice do provider atual, compartilhado entre matches
        print(f"[analysis] background: {len(pending)} partidas | cadeia: {' → '.join(p['label'] for p in chain)}", flush=True)
        for i, (mid,) in enumerate(pending):
            try:
                _generate_one(mid, db, cfg, provider_state)
                print(f"[analysis] ✓ match_id={mid} via {chain[provider_state[0]]['label']}", flush=True)
                if i < len(pending) - 1:
                    time.sleep(15)
            except Exception as e:
                err = str(e)
                print(f"[analysis] ✗ match_id={mid}: {err[:120]}", flush=True)
                db.rollback()
                if _is_quota_error(err):
                    print(f"[analysis] rate limit — aguardando 30s", flush=True)
                    time.sleep(30)
    finally:
        db.close()


# ─── Public endpoints ─────────────────────────────────────────────────────────

@router.get("/matches/{match_id}/analysis")
def get_analysis(match_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT content, model_used, generated_at FROM match_analyses WHERE match_id = :mid"),
        {"mid": match_id},
    ).fetchone()
    if not row:
        raise HTTPException(404, "Análise não disponível")
    content = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return {"match_id": match_id, "content": content, "model_used": row[1], "generated_at": row[2]}


# ─── Admin endpoints ──────────────────────────────────────────────────────────

@router.get("/admin/analysis/config")
def get_analysis_config(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    cfg = _get_config(db)
    chain = _get_provider_chain(cfg)
    return {
        "provider":               cfg["provider"],
        "openrouter_key_masked":  _mask(cfg["openrouter_key"]),
        "openrouter_has_key":     bool(cfg["openrouter_key"]),
        "openrouter_model":       cfg["openrouter_model"],
        "openrouter_models":      OPENROUTER_FREE_MODELS,
        "gemini_key_masked":      _mask(cfg["gemini_key"]),
        "gemini_has_key":         bool(cfg["gemini_key"]),
        "gemini_key_2_masked":    _mask(cfg["gemini_key_2"]),
        "gemini_has_key_2":       bool(cfg["gemini_key_2"]),
        "gemini_model":           cfg["gemini_model"],
        "gemini_models":          GEMINI_MODELS,
        "prompt_template":        cfg["prompt_template"],
        "default_prompt":         DEFAULT_PROMPT_TEMPLATE,
        "provider_chain":         [{"label": p["label"], "type": p["type"]} for p in chain],
        "best_free_or_model":     BEST_FREE_OR_MODEL,
    }


class AnalysisConfigIn(BaseModel):
    provider:        str = DEFAULT_PROVIDER
    openrouter_key:  str = ""
    openrouter_model: str = DEFAULT_OR_MODEL
    gemini_key:      str = ""
    gemini_key_2:    str = ""
    gemini_model:    str = DEFAULT_GEMINI_MODEL
    prompt_template: str = ""


def _save_config_full(db: Session, body: "AnalysisConfigIn"):
    pairs = [
        ("analysis_provider",        body.provider),
        ("openrouter_model",         body.openrouter_model),
        ("gemini_model",             body.gemini_model),
        ("analysis_prompt_template", body.prompt_template),
    ]
    if body.openrouter_key and not body.openrouter_key.startswith("•"):
        pairs.append(("openrouter_api_key", body.openrouter_key))
    if body.gemini_key and not body.gemini_key.startswith("•"):
        pairs.append(("gemini_api_key", body.gemini_key))
    if body.gemini_key_2 and not body.gemini_key_2.startswith("•"):
        pairs.append(("gemini_api_key_2", body.gemini_key_2))
    for key, val in pairs:
        db.execute(
            text("INSERT INTO site_config (key,value) VALUES (:k,:v) ON CONFLICT (key) DO UPDATE SET value=:v"),
            {"k": key, "v": val},
        )
    db.commit()


@router.post("/admin/analysis/config")
def save_analysis_config(body: AnalysisConfigIn, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    _save_config_full(db, body)
    return {"ok": True}


@router.get("/admin/analysis/{match_id}/content")
def get_analysis_content(match_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    row = db.execute(
        text("SELECT content, model_used, generated_at FROM match_analyses WHERE match_id = :mid"),
        {"mid": match_id},
    ).fetchone()
    if not row:
        raise HTTPException(404, "Sem análise para esta partida")
    content = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return {"match_id": match_id, "content": content, "model_used": row[1], "generated_at": str(row[2])}


@router.get("/admin/analysis/status")
def analysis_status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = db.execute(
        text("""
            SELECT m.id, ta.code, ta.name, tb.code, tb.name, m.match_date, m.phase,
                   ma.generated_at, ma.model_used
            FROM matches m
            JOIN teams ta ON ta.id = m.team_a_id
            JOIN teams tb ON tb.id = m.team_b_id
            LEFT JOIN match_analyses ma ON ma.match_id = m.id
            ORDER BY m.match_date
        """)
    ).fetchall()
    return [
        {"match_id": r[0], "team_a_code": r[1], "team_a_name": r[2],
         "team_b_code": r[3], "team_b_name": r[4], "match_date": r[5],
         "phase": r[6], "has_analysis": r[7] is not None,
         "generated_at": r[7], "model_used": r[8]}
        for r in rows
    ]


@router.post("/admin/analysis/{match_id}/generate")
def generate_one(match_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    cfg = _get_config(db)
    if cfg["provider"] == "gemini" and not cfg["gemini_key"]:
        raise HTTPException(400, "Gemini API key não configurada")
    if cfg["provider"] == "openrouter" and not cfg["openrouter_key"]:
        raise HTTPException(400, "OpenRouter API key não configurada")
    content = _generate_one(match_id, db, cfg)
    return {"ok": True, "match_id": match_id, "content": content}


class GenerateAllBody(BaseModel):
    only_pending: bool = True


@router.post("/admin/analysis/generate-all")
def generate_all(
    body: GenerateAllBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    cfg = _get_config(db)
    if cfg["provider"] == "gemini" and not cfg["gemini_key"]:
        raise HTTPException(400, "Gemini API key não configurada")
    if cfg["provider"] == "openrouter" and not cfg["openrouter_key"]:
        raise HTTPException(400, "OpenRouter API key não configurada")
    from config import settings
    background_tasks.add_task(_generate_all_bg, settings.database_url, cfg, body.only_pending)
    return {"ok": True, "message": "Geração iniciada em background"}
