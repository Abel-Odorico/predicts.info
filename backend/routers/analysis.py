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
    {"id": "meta-llama/llama-3.3-70b-instruct:free",       "label": "🆓 Llama 3.3 70B (rápido)"},
    {"id": "google/gemma-4-31b-it:free",                   "label": "🆓 Gemma 4 31B (mais rápido)"},
    {"id": "openai/gpt-oss-120b:free",                     "label": "🆓 GPT OSS 120B"},
    {"id": "nousresearch/hermes-3-llama-3.1-405b:free",    "label": "🆓 Hermes 3 Llama 405B"},
    {"id": "nvidia/nemotron-3-super-120b-a12b:free",       "label": "🆓 Nvidia Nemotron Super 120B"},
    {"id": "qwen/qwen3-next-80b-a3b-instruct:free",        "label": "🆓 Qwen3 Next 80B"},
    {"id": "nvidia/nemotron-3-ultra-550b-a55b:free",       "label": "🆓 Nvidia Nemotron Ultra 550B (lento)"},
]

OPENROUTER_PAID_MODELS = [
    {"id": "anthropic/claude-opus-4",                      "label": "💎 Claude Opus 4 (melhor análise)"},
    {"id": "anthropic/claude-sonnet-4-5",                  "label": "💎 Claude Sonnet 4.5 (rápido+capaz)"},
    {"id": "openai/gpt-4.1",                               "label": "💎 GPT-4.1 (excelente contexto)"},
    {"id": "openai/gpt-4o",                                "label": "💎 GPT-4o"},
    {"id": "google/gemini-2.5-pro",                        "label": "💎 Gemini 2.5 Pro (via OR)"},
    {"id": "google/gemini-2.5-flash",                      "label": "💎 Gemini 2.5 Flash (via OR)"},
    {"id": "deepseek/deepseek-r1",                         "label": "💎 DeepSeek R1 (raciocínio)"},
    {"id": "meta-llama/llama-4-maverick",                  "label": "💎 Llama 4 Maverick"},
    {"id": "x-ai/grok-3",                                  "label": "💎 Grok 3"},
]

OPENAI_DIRECT_MODELS = [
    {"id": "gpt-4.1",         "label": "💎 GPT-4.1 (melhor para análises longas)"},
    {"id": "gpt-4o",          "label": "💎 GPT-4o (rápido e capaz)"},
    {"id": "gpt-4o-mini",     "label": "💡 GPT-4o Mini (barato e rápido)"},
    {"id": "gpt-4-turbo",     "label": "💎 GPT-4 Turbo"},
    {"id": "o1-mini",         "label": "🧠 o1-mini (raciocínio)"},
]

GEMINI_MODELS = [
    {"id": "gemini-3.5-flash",                "label": "Gemini 3.5 Flash (recomendado)"},
    {"id": "gemini-2.5-flash",                "label": "Gemini 2.5 Flash (mais rápido)"},
    {"id": "gemini-2.5-flash-preview-05-20",  "label": "Gemini 2.5 Flash Preview mai/25"},
    {"id": "gemini-2.0-flash",                "label": "Gemini 2.0 Flash"},
    {"id": "gemini-2.0-flash-lite",           "label": "Gemini 2.0 Flash Lite (ultrarrápido)"},
    {"id": "gemini-2.5-pro",                  "label": "Gemini 2.5 Pro (mais capaz)"},
    {"id": "gemini-2.5-pro-preview-06-05",    "label": "Gemini 2.5 Pro Preview jun/25"},
]

DEFAULT_OR_MODEL     = "meta-llama/llama-3.3-70b-instruct:free"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"
DEFAULT_PROVIDER     = "openrouter"

CONFIG_KEYS = (
    "analysis_provider",
    "openrouter_api_key", "openrouter_model",
    "gemini_api_key",     "gemini_api_key_2", "gemini_model",
    "openai_api_key",     "openai_model",
    "analysis_prompt_template",
)

BEST_FREE_OR_MODEL = "meta-llama/llama-3.3-70b-instruct:free"


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
        "openai_key":        c.get("openai_api_key", ""),
        "openai_model":      c.get("openai_model", "gpt-4o-mini"),
        "prompt_template":   c.get("analysis_prompt_template", "") or "",
    }


def _get_provider_chain(cfg: dict) -> list[dict]:
    """Cadeia de fallback: Gemini1 → Gemini2 → OpenAI → OpenRouter."""
    chain = []
    if cfg.get("gemini_key"):
        chain.append({"type": "gemini", "key": cfg["gemini_key"], "model": cfg["gemini_model"], "label": "Gemini key1"})
    if cfg.get("gemini_key_2"):
        chain.append({"type": "gemini", "key": cfg["gemini_key_2"], "model": cfg["gemini_model"], "label": "Gemini key2"})
    if cfg.get("openai_key"):
        oai_model = cfg.get("openai_model") or "gpt-4o-mini"
        chain.append({"type": "openai", "key": cfg["openai_key"], "model": oai_model, "label": f"OpenAI {oai_model}"})
    if cfg.get("openrouter_key"):
        or_model = cfg.get("openrouter_model") or BEST_FREE_OR_MODEL
        chain.append({"type": "openrouter", "key": cfg["openrouter_key"], "model": or_model, "label": f"OpenRouter {or_model.split('/')[-1]}"})
    return chain


def _upsert(db: Session, key: str, val: str):
    db.execute(
        text("INSERT INTO site_config (key, value) VALUES (:k, :v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"),
        {"k": key, "v": val},
    )


def _save_config(db: Session, provider: str, or_key: str, or_model: str, g_key: str, g_model: str,
                 oai_key: str = "", oai_model: str = ""):
    _upsert(db, "analysis_provider",  provider)
    _upsert(db, "openrouter_model",   or_model)
    _upsert(db, "gemini_model",       g_model)
    if oai_model:
        _upsert(db, "openai_model", oai_model)
    if or_key and not or_key.startswith("•"):
        _upsert(db, "openrouter_api_key", or_key)
    if g_key and not g_key.startswith("•"):
        _upsert(db, "gemini_api_key", g_key)
    if oai_key and not oai_key.startswith("•"):
        _upsert(db, "openai_api_key", oai_key)
    db.commit()


# ─── LLM callers ─────────────────────────────────────────────────────────────

def _call_openai(api_key: str, model: str, prompt: str) -> tuple[dict, dict]:
    resp = http_requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 3000,
            "response_format": {"type": "json_object"},
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage", {})
    result = json.loads(data["choices"][0]["message"]["content"])
    meta = {
        "tokens_in":  int(usage.get("prompt_tokens", 0)),
        "tokens_out": int(usage.get("completion_tokens", 0)),
        "cost_usd":   0.0,  # calculated separately if needed
    }
    return result, meta


def _strip_fences(text_out: str) -> str:
    text_out = text_out.strip()
    if text_out.startswith("```"):
        parts = text_out.split("```")
        text_out = parts[1] if len(parts) > 1 else text_out
        if text_out.startswith("json"):
            text_out = text_out[4:]
    return text_out.strip()


def _call_openrouter(api_key: str, model: str, prompt: str) -> tuple[dict, dict]:
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
            "max_tokens": 3000,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage", {})
    result = json.loads(_strip_fences(data["choices"][0]["message"]["content"]))
    meta = {
        "tokens_in":  int(usage.get("prompt_tokens", 0)),
        "tokens_out": int(usage.get("completion_tokens", 0)),
        "cost_usd":   float(usage.get("cost", 0) or 0),
    }
    return result, meta


def _call_gemini(api_key: str, model: str, prompt: str) -> tuple[dict, dict]:
    meta = {"tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}
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
                response_mime_type="application/json",
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        text_out = response.text
        um = getattr(response, "usage_metadata", None)
        if um:
            meta["tokens_in"]  = getattr(um, "prompt_token_count", 0) or 0
            meta["tokens_out"] = getattr(um, "candidates_token_count", 0) or 0
    except Exception:
        # Fallback para REST se SDK não disponível ou der erro
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        resp = http_requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "maxOutputTokens": 8192,
                    "temperature": 0.7,
                    "responseMimeType": "application/json",
                    "thinkingConfig": {"thinkingBudget": 0},
                },
            },
            timeout=90,
        )
        resp.raise_for_status()
        rj = resp.json()
        text_out = rj["candidates"][0]["content"]["parts"][0]["text"]
        um = rj.get("usageMetadata", {})
        meta["tokens_in"]  = int(um.get("promptTokenCount", 0))
        meta["tokens_out"] = int(um.get("candidatesTokenCount", 0))
    return json.loads(_strip_fences(text_out)), meta


def _is_quota_error(err: str) -> bool:
    low = err.lower()
    return "429" in err or "too many requests" in low or "resource_exhausted" in low or "quota" in low or "rate" in low


def _call_llm(cfg: dict, prompt: str, provider_state: list | None = None, chain: list | None = None) -> tuple[dict, str, dict]:
    """
    Chama LLM com fallback automático: Gemini key1 → Gemini key2 → OpenRouter best free.
    provider_state: lista de 1 elemento [idx] compartilhada entre chamadas do mesmo lote.
    chain: cadeia customizada (sobrescreve _get_provider_chain se fornecida).
    Returns (result, model_tag, usage_meta).
    """
    if chain is None:
        chain = _get_provider_chain(cfg)
    if not chain:
        raise ValueError("Nenhum provider configurado (configure Gemini ou OpenRouter)")

    start = provider_state[0] if provider_state else 0
    for idx in range(start, len(chain)):
        p = chain[idx]
        try:
            if p["type"] == "gemini":
                result, meta = _call_gemini(p["key"], p["model"], prompt)
            elif p["type"] == "openai":
                result, meta = _call_openai(p["key"], p["model"], prompt)
            else:
                result, meta = _call_openrouter(p["key"], p["model"], prompt)
            if provider_state is not None:
                provider_state[0] = idx
            return result, f"{p['type']}/{p['model']}", meta
        except Exception as e:
            if _is_quota_error(str(e)) and idx < len(chain) - 1:
                print(f"[analysis] {p['label']} exausto → {chain[idx+1]['label']}", flush=True)
                if provider_state is not None:
                    provider_state[0] = idx + 1
                continue
            raise

    raise ValueError("Todos os providers da cadeia exaustos")


DEFAULT_PROMPT_TEMPLATE = (
    "Você é um jornalista esportivo sênior especializado em futebol internacional, "
    "com décadas de cobertura de Copas do Mundo e profundo conhecimento tático.\n"
    "Analise a partida {team_a_name} × {team_b_name} com rigor técnico e paixão futebolística.\n\n"
    "REGRAS OBRIGATÓRIAS:\n"
    "- Escreva em PORTUGUÊS BRASILEIRO fluente, estilo ESPN/Globo Esporte\n"
    "- Use os DADOS FORNECIDOS como base factual; enriqueça com conhecimento tático real de cada seleção\n"
    "- key_players: cite os 3 MAIS FAMOSOS E DETERMINANTES desta seleção pelo seu conhecimento real do futebol mundial — SEMPRE inclua a superestrela titular (ex: Messi, Salah, Mbappé, Vini Jr.) mesmo que apareça no final da lista de convocados\n"
    "- Use a lista de convocados para confirmar quem está disponível (⚠️ = lesionado, 🚫 = suspenso), mas baseie os key_players na reputação real e titularidade habitual\n"
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
    '      "SUPERESTRELA (ex: Messi/Salah/Mbappé/Vini Jr.) — sempre o 1º, com posição e papel decisivo neste jogo",\n'
    '      "2º destaque (posição) — função tática e ameaça concreta para este adversário específico",\n'
    '      "3º destaque (posição) — impacto esperado e duelo individual que travará"\n'
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
    '(2) cite o placar mais provável do modelo Dixon-Coles (primeiro da lista de placares acima) e os xG esperados, '
    'justifique taticamente, diga quem marca (superestrela em 1º lugar) e em que período do jogo — seja cirúrgico",\n'
    '  "verdict": "Uma frase direta e opinativa: ex. \'{team_a_name} favorita por qualidade no meio-campo\' | '
    '\'Equilíbrio total — clássico pode terminar no detalhe\' | \'{team_b_name} surpreende com velocidade no contra-ataque\'"\n'
    '}}'
)


# ─── Prompt builder ───────────────────────────────────────────────────────────

def _build_prompt(match_row, team_a: Team, team_b: Team, players_a, players_b, recent_a, recent_b, mc_prob, custom_template: str = "") -> str:
    def fmt_players(players):
        # FW first — stars (Messi, Salah, Mbappé) are attackers
        # Limit to 15 players max to keep prompt concise and fast
        pos_order = {"FW": 0, "MF": 1, "DF": 2, "GK": 3}
        pos_label = {"FW": "ATA", "MF": "MEI", "DF": "DEF", "GK": "GOL"}
        sorted_p = sorted(players, key=lambda p: pos_order.get(p.position, 9))
        # Keep all injured/suspended + up to 15 total
        priority = [p for p in sorted_p if p.is_injured or p.is_suspended]
        rest = [p for p in sorted_p if not p.is_injured and not p.is_suspended]
        selected = (priority + rest)[:15]
        lines, cur_pos = [], None
        for p in selected:
            lbl = pos_label.get(p.position, p.position)
            if lbl != cur_pos:
                lines.append(f"  [{lbl}]")
                cur_pos = lbl
            suffix = " ⚠️" if p.is_injured else " 🚫" if p.is_suspended else ""
            lines.append(f"    • {p.name}{suffix}")
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
        top_sc = mc_prob.get("top_scores", [])[:5]
        scores_str = "  |  ".join(
            f"{s['score']} ({s['prob']:.1f}%)" for s in top_sc
        ) if top_sc else "N/D"
        mc_probs = (
            f"## Probabilidades Dixon-Coles + Monte Carlo\n"
            f"  Vitória {team_a.name}: {mc_prob.get('prob_a', 0):.1f}% | "
            f"Empate: {mc_prob.get('prob_draw', 0):.1f}% | "
            f"Vitória {team_b.name}: {mc_prob.get('prob_b', 0):.1f}%\n"
            f"  xG esperado: {team_a.name} {mc_prob.get('lambda_a', 0):.2f} gols × "
            f"{team_b.name} {mc_prob.get('lambda_b', 0):.2f} gols\n"
            f"  Placares mais prováveis: {scores_str}\n"
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
        text("SELECT prob_a, prob_draw, prob_b, top_scores, lambda_a, lambda_b FROM simulations_cache WHERE match_id = :mid LIMIT 1"),
        {"mid": match_id},
    ).fetchone()
    if not row:
        return None
    top_scores = row[3] or []
    if isinstance(top_scores, str):
        top_scores = json.loads(top_scores)
    return {
        "prob_a":    round(float(row[0] or 0) * 100, 1),
        "prob_draw": round(float(row[1] or 0) * 100, 1),
        "prob_b":    round(float(row[2] or 0) * 100, 1),
        "top_scores": top_scores[:5],
        "lambda_a":  round(float(row[4] or 0), 2),
        "lambda_b":  round(float(row[5] or 0), 2),
    }


def _generate_one(
    match_id: int,
    db: Session,
    cfg: dict,
    provider_state: list | None = None,
    batch_id: str | None = None,
    trigger: str = "manual",
) -> dict:
    import time
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

    prompt = _build_prompt(match_row, team_a, team_b, players_a, players_b,
                           _get_recent_results(db, team_a.code),
                           _get_recent_results(db, team_b.code),
                           _get_mc_prob(db, match_id),
                           cfg.get("prompt_template", ""))

    t0 = time.time()
    content, model_tag, usage = _call_llm(cfg, prompt, provider_state)
    duration_ms = int((time.time() - t0) * 1000)

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
    provider_type = "gemini" if model_tag.startswith("gemini") else "openrouter"
    db.execute(
        text("""
            INSERT INTO analysis_logs (match_id, model_used, provider, tokens_in, tokens_out,
                cost_usd, duration_ms, status, batch_id, trigger, created_at)
            VALUES (:mid, :model, :prov, :ti, :to, :cost, :dur, 'ok', :bid, :trig, :now)
        """),
        {
            "mid": match_id, "model": model_tag, "prov": provider_type,
            "ti": usage.get("tokens_in", 0), "to": usage.get("tokens_out", 0),
            "cost": usage.get("cost_usd", 0.0), "dur": duration_ms,
            "bid": batch_id, "trig": trigger, "now": _utcnow(),
        },
    )
    db.commit()
    return content


PROGRESS_REDIS_KEY = "analysis:progress"
PROGRESS_TTL = 7200  # 2h


def _redis_for_progress():
    try:
        import redis as _redis
        from config import settings
        return _redis.from_url(settings.redis_url, decode_responses=True)
    except Exception:
        return None


def _push_progress(r, data: dict):
    if r:
        try:
            r.setex(PROGRESS_REDIS_KEY, PROGRESS_TTL, json.dumps(data, default=str))
        except Exception:
            pass


def _generate_all_bg(db_url: str, cfg: dict, only_pending: bool = True, only_future: bool = False, trigger: str = "manual"):
    import time, uuid
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(db_url)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    batch_id = str(uuid.uuid4())[:16]
    r = _redis_for_progress()

    # Build WHERE clause
    clauses = []
    if only_pending:
        clauses.append("NOT EXISTS (SELECT 1 FROM match_analyses ma WHERE ma.match_id = m.id)")
    if only_future:
        clauses.append("m.match_date >= NOW()")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    try:
        pending = db.execute(
            text(f"""
                SELECT m.id, ta.name, tb.name FROM matches m
                JOIN teams ta ON ta.id = m.team_a_id
                JOIN teams tb ON tb.id = m.team_b_id
                {where}
                ORDER BY
                    CASE WHEN m.match_date >= NOW() THEN 0 ELSE 1 END,
                    m.match_date
            """)
        ).fetchall()

        match_map = {row[0]: f"{row[1]} × {row[2]}" for row in pending}
        pending_ids = [(row[0],) for row in pending]

        chain = _get_provider_chain(cfg)
        provider_state = [0]

        progress = {
            "batch_id": batch_id,
            "status": "running",
            "total": len(pending_ids),
            "done": 0,
            "current": None,
            "started_at": _utcnow().isoformat(),
            "only_pending": only_pending,
            "only_future": only_future,
            "trigger": trigger,
            "items": [],
        }
        _push_progress(r, progress)
        print(f"[analysis] background: {len(pending_ids)} partidas | cadeia: {' → '.join(p['label'] for p in chain)}", flush=True)

        for i, (mid,) in enumerate(pending_ids):
            match_label = match_map.get(mid, f"#{mid}")
            progress["current"] = match_label
            _push_progress(r, progress)

            t0 = time.time()
            try:
                _generate_one(mid, db, cfg, provider_state, batch_id=batch_id, trigger=trigger)
                duration_ms = int((time.time() - t0) * 1000)
                model_label = chain[provider_state[0]]["label"] if chain else "?"
                print(f"[analysis] ✓ match_id={mid} via {model_label}", flush=True)
                progress["done"] += 1
                progress["items"].append({
                    "match_id": mid, "teams": match_label,
                    "model": model_label, "duration_ms": duration_ms,
                    "status": "ok", "finished_at": _utcnow().isoformat(),
                })
                _push_progress(r, progress)
                if i < len(pending_ids) - 1:
                    time.sleep(3)
            except Exception as e:
                err = str(e)
                duration_ms = int((time.time() - t0) * 1000)
                print(f"[analysis] ✗ match_id={mid}: {err[:120]}", flush=True)
                try:
                    db.execute(
                        text("""
                            INSERT INTO analysis_logs (match_id, model_used, provider, status, error_msg, batch_id, created_at)
                            VALUES (:mid, :model, :prov, 'error', :err, :bid, :now)
                        """),
                        {
                            "mid": mid,
                            "model": chain[provider_state[0]]["model"] if chain else None,
                            "prov": chain[provider_state[0]]["type"] if chain else None,
                            "err": err[:500], "bid": batch_id, "now": _utcnow(),
                        },
                    )
                    db.commit()
                except Exception:
                    db.rollback()
                progress["done"] += 1
                progress["items"].append({
                    "match_id": mid, "teams": match_label,
                    "model": chain[provider_state[0]]["label"] if chain else "?",
                    "duration_ms": duration_ms,
                    "status": "error", "error": err[:200],
                    "finished_at": _utcnow().isoformat(),
                })
                _push_progress(r, progress)
                if _is_quota_error(err):
                    print(f"[analysis] rate limit — aguardando 10s", flush=True)
                    time.sleep(10)

        progress["status"] = "done"
        progress["current"] = None
        progress["ended_at"] = _utcnow().isoformat()
        _push_progress(r, progress)

    except Exception as outer:
        progress_err = {"batch_id": batch_id, "status": "error", "error": str(outer)[:300]}
        _push_progress(r, progress_err)
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
        "openrouter_free_models": OPENROUTER_FREE_MODELS,
        "openrouter_paid_models": OPENROUTER_PAID_MODELS,
        "gemini_key_masked":      _mask(cfg["gemini_key"]),
        "gemini_has_key":         bool(cfg["gemini_key"]),
        "gemini_key_2_masked":    _mask(cfg["gemini_key_2"]),
        "gemini_has_key_2":       bool(cfg["gemini_key_2"]),
        "gemini_model":           cfg["gemini_model"],
        "gemini_models":          GEMINI_MODELS,
        "openai_key_masked":      _mask(cfg["openai_key"]),
        "openai_has_key":         bool(cfg["openai_key"]),
        "openai_model":           cfg["openai_model"],
        "openai_models":          OPENAI_DIRECT_MODELS,
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
    openai_key:      str = ""
    openai_model:    str = "gpt-4o-mini"
    prompt_template: str = ""


def _save_config_full(db: Session, body: "AnalysisConfigIn"):
    pairs = [
        ("analysis_provider",        body.provider),
        ("openrouter_model",         body.openrouter_model),
        ("gemini_model",             body.gemini_model),
        ("openai_model",             body.openai_model),
        ("analysis_prompt_template", body.prompt_template),
    ]
    if body.openrouter_key and not body.openrouter_key.startswith("•"):
        pairs.append(("openrouter_api_key", body.openrouter_key))
    if body.gemini_key and not body.gemini_key.startswith("•"):
        pairs.append(("gemini_api_key", body.gemini_key))
    if body.gemini_key_2 and not body.gemini_key_2.startswith("•"):
        pairs.append(("gemini_api_key_2", body.gemini_key_2))
    if body.openai_key and not body.openai_key.startswith("•"):
        pairs.append(("openai_api_key", body.openai_key))
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
    if not _get_provider_chain(cfg):
        raise HTTPException(400, "Nenhum provider configurado (configure Gemini ou OpenRouter)")
    content = _generate_one(match_id, db, cfg)
    return {"ok": True, "match_id": match_id, "content": content}


class GenerateAllBody(BaseModel):
    only_pending: bool = True
    only_future: bool = False


@router.post("/admin/analysis/generate-all")
def generate_all(
    body: GenerateAllBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    cfg = _get_config(db)
    if not _get_provider_chain(cfg):
        raise HTTPException(400, "Nenhum provider configurado (configure Gemini ou OpenRouter)")
    from config import settings
    background_tasks.add_task(
        _generate_all_bg, settings.database_url, cfg,
        body.only_pending, body.only_future, "manual",
    )
    return {"ok": True, "message": "Geração iniciada em background"}


@router.get("/admin/analysis/progress")
def analysis_progress(_: User = Depends(require_admin)):
    r = _redis_for_progress()
    if r:
        try:
            data = r.get(PROGRESS_REDIS_KEY)
            if data:
                return json.loads(data)
        except Exception:
            pass
    return {"status": "idle", "total": 0, "done": 0, "items": [], "current": None}


@router.get("/admin/analysis/logs")
def analysis_logs(limit: int = 100, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = db.execute(text("""
        SELECT
            al.id, al.match_id,
            ta.name AS team_a, tb.name AS team_b,
            al.model_used, al.provider,
            al.tokens_in, al.tokens_out,
            al.cost_usd, al.duration_ms,
            al.status, al.error_msg,
            al.batch_id, al.created_at,
            COALESCE(al.trigger, 'manual') AS trigger
        FROM analysis_logs al
        LEFT JOIN matches m ON m.id = al.match_id
        LEFT JOIN teams ta ON ta.id = m.team_a_id
        LEFT JOIN teams tb ON tb.id = m.team_b_id
        ORDER BY al.created_at DESC
        LIMIT :lim
    """), {"lim": limit}).fetchall()

    items = []
    for r in rows:
        items.append({
            "id": r[0], "match_id": r[1],
            "team_a": r[2], "team_b": r[3],
            "model_used": r[4], "provider": r[5],
            "tokens_in": r[6] or 0, "tokens_out": r[7] or 0,
            "cost_usd": float(r[8] or 0),
            "duration_ms": r[9] or 0,
            "status": r[10], "error_msg": r[11],
            "batch_id": r[12],
            "created_at": str(r[13]),
            "trigger": r[14] or "manual",
        })

    totals = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status = 'ok') AS total_ok,
            COUNT(*) FILTER (WHERE status = 'error') AS total_err,
            SUM(tokens_in) AS total_tokens_in,
            SUM(tokens_out) AS total_tokens_out,
            SUM(cost_usd) AS total_cost,
            SUM(duration_ms) AS total_duration_ms
        FROM analysis_logs
    """)).fetchone()

    return {
        "items": items,
        "totals": {
            "ok": int(totals[0] or 0),
            "error": int(totals[1] or 0),
            "tokens_in": int(totals[2] or 0),
            "tokens_out": int(totals[3] or 0),
            "cost_usd": float(totals[4] or 0),
            "duration_ms": int(totals[5] or 0),
        },
    }
