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
    {"id": "nvidia/nemotron-3-ultra-550b-a55b:free",       "label": "Nvidia Nemotron Ultra 550B (free)"},
    {"id": "nousresearch/hermes-3-llama-3.1-405b:free",    "label": "Hermes 3 Llama 405B (free)"},
    {"id": "openai/gpt-oss-120b:free",                     "label": "GPT OSS 120B (free)"},
    {"id": "nvidia/nemotron-3-super-120b-a12b:free",       "label": "Nvidia Nemotron Super 120B (free)"},
    {"id": "qwen/qwen3-next-80b-a3b-instruct:free",        "label": "Qwen3 80B (free)"},
    {"id": "meta-llama/llama-3.3-70b-instruct:free",       "label": "Llama 3.3 70B (free)"},
    {"id": "google/gemma-4-31b-it:free",                   "label": "Gemma 4 31B (free)"},
    {"id": "qwen/qwen3-coder:free",                        "label": "Qwen3 Coder (free)"},
]

GEMINI_MODELS = [
    {"id": "gemini-2.5-pro",                  "label": "Gemini 2.5 Pro (mais capaz)"},
    {"id": "gemini-2.5-pro-preview-06-05",    "label": "Gemini 2.5 Pro Preview jun/25"},
    {"id": "gemini-2.5-flash",                "label": "Gemini 2.5 Flash (rápido)"},
    {"id": "gemini-2.5-flash-preview-05-20",  "label": "Gemini 2.5 Flash Preview mai/25"},
    {"id": "gemini-2.0-flash",                "label": "Gemini 2.0 Flash"},
    {"id": "gemini-2.0-flash-lite",           "label": "Gemini 2.0 Flash Lite"},
]

DEFAULT_OR_MODEL    = "nvidia/nemotron-3-ultra-550b-a55b:free"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_PROVIDER    = "openrouter"

CONFIG_KEYS = (
    "analysis_provider",
    "openrouter_api_key", "openrouter_model",
    "gemini_api_key",     "gemini_model",
)


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
        "gemini_model":      c.get("gemini_model", DEFAULT_GEMINI_MODEL),
    }


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


def _call_llm(cfg: dict, prompt: str) -> tuple[dict, str]:
    provider = cfg["provider"]
    if provider == "gemini":
        if not cfg["gemini_key"]:
            raise ValueError("Gemini API key não configurada")
        model = cfg["gemini_model"]
        return _call_gemini(cfg["gemini_key"], model, prompt), f"gemini/{model}"
    else:
        if not cfg["openrouter_key"]:
            raise ValueError("OpenRouter API key não configurada")
        model = cfg["openrouter_model"]
        return _call_openrouter(cfg["openrouter_key"], model, prompt), f"openrouter/{model}"


# ─── Prompt builder ───────────────────────────────────────────────────────────

def _build_prompt(match_row, team_a: Team, team_b: Team, players_a, players_b, recent_a, recent_b, mc_prob) -> str:
    def fmt_players(players):
        pos_order = {"GK": 0, "DF": 1, "MF": 2, "FW": 3}
        sorted_p = sorted(players, key=lambda p: pos_order.get(p.position, 9))
        return "\n".join(f"  - {p.name} ({p.position})" for p in sorted_p[:12])

    def fmt_results(results):
        if not results:
            return "  Sem dados disponíveis"
        return "\n".join(f"  - {r['date']}: {r['team_a']} {r['score_a']}x{r['score_b']} {r['team_b']}" for r in results[:5])

    prob_str = ""
    if mc_prob:
        prob_str = (
            f"\n## Probabilidades Monte Carlo (1M simulações)\n"
            f"  - Vitória {team_a.name}: {mc_prob.get('prob_a', 0):.1f}%\n"
            f"  - Empate: {mc_prob.get('prob_draw', 0):.1f}%\n"
            f"  - Vitória {team_b.name}: {mc_prob.get('prob_b', 0):.1f}%\n"
        )

    return f"""Você é um especialista em futebol com profundo conhecimento da Copa do Mundo 2026. Analise a partida abaixo com base nos dados estruturados fornecidos e no seu conhecimento atual dos times.

Produza uma análise RICA, DETALHADA e APAIXONANTE em PORTUGUÊS BRASILEIRO, como se fosse um artigo de pré-jogo de alto nível. Use os dados para embasar a análise, mas vá além — cite jogadores-chave reais, estilo de jogo, tendências recentes, contexto histórico.

## DADOS DA PARTIDA
Fase: {match_row.get('phase','group')}
Grupo: {match_row.get('group_name') or 'mata-mata'}
Data: {match_row.get('match_date')}

## {team_a.name.upper()} ({team_a.code})
- Elo: {team_a.elo_rating or 'N/D'} | Conf: {team_a.confederation}
- Aparições em Copas: {team_a.world_cup_appearances or 'N/D'} | Melhor resultado: {team_a.best_wc_result or 'N/D'}
- Média gols marcados: {team_a.avg_goals_for or 'N/D'} | Média sofridos: {team_a.avg_goals_against or 'N/D'}
- xG médio: {team_a.xg_for or 'N/D'} | xGA: {team_a.xg_against or 'N/D'}
- Forma recente (últimos 5): {team_a.form_5 or 'N/D'} | últimos 10: {team_a.form_10 or 'N/D'}
Convocados:
{fmt_players(players_a)}

Resultados recentes:
{fmt_results(recent_a)}

## {team_b.name.upper()} ({team_b.code})
- Elo: {team_b.elo_rating or 'N/D'} | Conf: {team_b.confederation}
- Aparições em Copas: {team_b.world_cup_appearances or 'N/D'} | Melhor resultado: {team_b.best_wc_result or 'N/D'}
- Média gols marcados: {team_b.avg_goals_for or 'N/D'} | Média sofridos: {team_b.avg_goals_against or 'N/D'}
- xG médio: {team_b.xg_for or 'N/D'} | xGA: {team_b.xg_against or 'N/D'}
- Forma recente (últimos 5): {team_b.form_5 or 'N/D'} | últimos 10: {team_b.form_10 or 'N/D'}
Convocados:
{fmt_players(players_b)}

Resultados recentes:
{fmt_results(recent_b)}
{prob_str}
## FORMATO DE SAÍDA OBRIGATÓRIO (JSON puro, sem markdown, sem ```):
{{
  "overview": "2-3 parágrafos apresentando o confronto, contexto histórico, o que está em jogo",
  "team_a": {{
    "tactical": "Análise tática profunda — sistema, estilo, como se comporta defensiva e ofensivamente",
    "key_players": ["Nome (posição) — por que é crucial neste jogo", "..."],
    "form": "Análise da forma recente, moral, lesões, contexto",
    "strengths": "Pontos fortes principais no contexto deste jogo",
    "weaknesses": "Vulnerabilidades que o adversário pode explorar"
  }},
  "team_b": {{
    "tactical": "...",
    "key_players": ["..."],
    "form": "...",
    "strengths": "...",
    "weaknesses": "..."
  }},
  "matchup": "2 parágrafos: como o estilo de cada time interage, qual é o fator X, como tende a ser o jogo",
  "prediction": "2 parágrafos de predição fundamentada. Seja específico: mencione placar mais provável, como tende a acontecer os gols",
  "verdict": "Frase curta: ex. 'Favorito claro: {team_a.name}' ou 'Equilíbrio técnico' ou 'Desequilíbrio técnico'"
}}

Retorne SOMENTE o JSON. Nenhum outro texto."""


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


def _generate_one(match_id: int, db: Session, cfg: dict) -> dict:
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
                                    _get_mc_prob(db, match_id))
    content, model_tag = _call_llm(cfg, prompt)

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


def _generate_all_bg(db_url: str, cfg: dict):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(db_url)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    try:
        pending = db.execute(
            text("SELECT m.id FROM matches m WHERE NOT EXISTS (SELECT 1 FROM match_analyses ma WHERE ma.match_id = m.id) ORDER BY m.match_date")
        ).fetchall()
        for (mid,) in pending:
            try:
                _generate_one(mid, db, cfg)
                log.info("analysis ok match_id=%s", mid)
            except Exception as e:
                log.error("analysis fail match_id=%s: %s", mid, e)
                db.rollback()
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
    return {
        "provider":               cfg["provider"],
        "openrouter_key_masked":  _mask(cfg["openrouter_key"]),
        "openrouter_has_key":     bool(cfg["openrouter_key"]),
        "openrouter_model":       cfg["openrouter_model"],
        "openrouter_models":      OPENROUTER_FREE_MODELS,
        "gemini_key_masked":      _mask(cfg["gemini_key"]),
        "gemini_has_key":         bool(cfg["gemini_key"]),
        "gemini_model":           cfg["gemini_model"],
        "gemini_models":          GEMINI_MODELS,
    }


class AnalysisConfigIn(BaseModel):
    provider:       str = DEFAULT_PROVIDER
    openrouter_key: str = ""
    openrouter_model: str = DEFAULT_OR_MODEL
    gemini_key:     str = ""
    gemini_model:   str = DEFAULT_GEMINI_MODEL


@router.post("/admin/analysis/config")
def save_analysis_config(body: AnalysisConfigIn, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    _save_config(db, body.provider, body.openrouter_key, body.openrouter_model, body.gemini_key, body.gemini_model)
    return {"ok": True}


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
    background_tasks.add_task(_generate_all_bg, settings.database_url, cfg)
    return {"ok": True, "message": "Geração iniciada em background"}
