"""
GET  /matches/{id}/analysis              — análise pública (cache DB)
POST /admin/analysis/{match_id}/generate — gera/regenera uma partida
POST /admin/analysis/generate-all        — gera todas as pendentes (bg task)
GET  /admin/analysis/status              — lista partidas + status análise
GET  /admin/analysis/config              — lê config OpenRouter
POST /admin/analysis/config              — salva config OpenRouter
"""
import json
import logging
from datetime import datetime, timezone

import requests as http_requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth_utils import require_admin, get_current_user
from database import get_db
from models import Match, Team, SiteConfig, User

log = logging.getLogger(__name__)
router = APIRouter(tags=["analysis"])

ANALYSIS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS match_analyses (
    id           SERIAL PRIMARY KEY,
    match_id     INTEGER NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
    content      JSONB   NOT NULL,
    model_used   VARCHAR(120),
    generated_at TIMESTAMP DEFAULT NOW()
)
"""

AVAILABLE_MODELS = [
    {"id": "google/gemini-2.5-pro-preview",       "label": "Gemini 2.5 Pro (recomendado)"},
    {"id": "google/gemini-2.5-flash-preview",      "label": "Gemini 2.5 Flash"},
    {"id": "anthropic/claude-sonnet-4-5",          "label": "Claude Sonnet 4.5"},
    {"id": "anthropic/claude-opus-4",              "label": "Claude Opus 4"},
    {"id": "openai/gpt-4o",                        "label": "GPT-4o"},
    {"id": "openai/gpt-4.1",                       "label": "GPT-4.1"},
    {"id": "meta-llama/llama-4-maverick",          "label": "Llama 4 Maverick"},
    {"id": "deepseek/deepseek-r2",                 "label": "DeepSeek R2"},
]
DEFAULT_MODEL = "google/gemini-2.5-pro-preview"


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _get_config(db: Session) -> dict:
    rows = db.execute(
        text("SELECT key, value FROM site_config WHERE key IN ('openrouter_api_key','openrouter_model')")
    ).fetchall()
    cfg = {r[0]: r[1] for r in rows}
    return {
        "api_key": cfg.get("openrouter_api_key", ""),
        "model":   cfg.get("openrouter_model", DEFAULT_MODEL),
    }


def _save_config(db: Session, api_key: str, model: str):
    for key, val in [("openrouter_api_key", api_key), ("openrouter_model", model)]:
        db.execute(
            text("""
                INSERT INTO site_config (key, value) VALUES (:k, :v)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """),
            {"k": key, "v": val},
        )
    db.commit()


def _build_prompt(match_row, team_a: Team, team_b: Team, players_a, players_b, recent_a, recent_b, mc_prob) -> str:
    def fmt_players(players):
        pos_order = {"GK": 0, "DF": 1, "MF": 2, "FW": 3}
        sorted_p = sorted(players, key=lambda p: pos_order.get(p.position, 9))
        return "\n".join(f"  - {p.name} ({p.position})" for p in sorted_p[:12])

    def fmt_results(results):
        if not results:
            return "  Sem dados disponíveis"
        lines = []
        for r in results[:5]:
            lines.append(f"  - {r['date']}: {r['team_a']} {r['score_a']}x{r['score_b']} {r['team_b']}")
        return "\n".join(lines)

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
            "max_tokens": 3000,
        },
        timeout=90,
    )
    resp.raise_for_status()
    text_out = resp.json()["choices"][0]["message"]["content"].strip()
    # strip markdown fences if model ignores instruction
    if text_out.startswith("```"):
        text_out = text_out.split("```")[1]
        if text_out.startswith("json"):
            text_out = text_out[4:]
    return json.loads(text_out)


def _get_recent_results(db: Session, team_code: str, limit: int = 5) -> list:
    rows = db.execute(
        text("""
            SELECT ta.code AS team_a, tb.code AS team_b,
                   mr.score_a, mr.score_b,
                   TO_CHAR(m.match_date, 'DD/MM') AS date
            FROM matches m
            JOIN teams ta ON ta.id = m.team_a_id
            JOIN teams tb ON tb.id = m.team_b_id
            JOIN match_results mr ON mr.match_id = m.id
            WHERE ta.code = :code OR tb.code = :code
            ORDER BY m.match_date DESC
            LIMIT :lim
        """),
        {"code": team_code, "lim": limit},
    ).fetchall()
    return [{"team_a": r[0], "team_b": r[1], "score_a": r[2], "score_b": r[3], "date": r[4]} for r in rows]


def _get_mc_prob(db: Session, match_id: int) -> dict | None:
    row = db.execute(
        text("SELECT data FROM simulations_cache WHERE match_id = :mid LIMIT 1"),
        {"mid": match_id},
    ).fetchone()
    if not row:
        return None
    try:
        d = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        return {
            "prob_a":    round(d.get("prob_a", 0) * 100, 1),
            "prob_draw": round(d.get("prob_draw", 0) * 100, 1),
            "prob_b":    round(d.get("prob_b", 0) * 100, 1),
        }
    except Exception:
        return None


def _generate_one(match_id: int, db: Session, api_key: str, model: str) -> dict:
    row = db.execute(
        text("""
            SELECT m.id, ta.id AS ta_id, tb.id AS tb_id,
                   m.match_date, m.phase, ta.group_name
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

    recent_a = _get_recent_results(db, team_a.code)
    recent_b = _get_recent_results(db, team_b.code)
    mc_prob  = _get_mc_prob(db, match_id)

    prompt  = _build_prompt(match_row, team_a, team_b, players_a, players_b, recent_a, recent_b, mc_prob)
    content = _call_openrouter(api_key, model, prompt)

    db.execute(
        text("""
            INSERT INTO match_analyses (match_id, content, model_used, generated_at)
            VALUES (:mid, :content, :model, :now)
            ON CONFLICT (match_id) DO UPDATE
              SET content = EXCLUDED.content,
                  model_used = EXCLUDED.model_used,
                  generated_at = EXCLUDED.generated_at
        """),
        {"mid": match_id, "content": json.dumps(content), "model": model, "now": _utcnow()},
    )
    db.commit()
    return content


def _generate_all_bg(db_url: str, api_key: str, model: str):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        pending = db.execute(
            text("""
                SELECT m.id FROM matches m
                WHERE NOT EXISTS (SELECT 1 FROM match_analyses ma WHERE ma.match_id = m.id)
                ORDER BY m.match_date
            """)
        ).fetchall()
        for (mid,) in pending:
            try:
                _generate_one(mid, db, api_key, model)
                log.info("analysis generated match_id=%s", mid)
            except Exception as e:
                log.error("analysis failed match_id=%s: %s", mid, e)
    finally:
        db.close()


# ─── Public ────────────────────────────────────────────────────────────────────

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


# ─── Admin ─────────────────────────────────────────────────────────────────────

@router.get("/admin/analysis/config")
def get_analysis_config(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    cfg = _get_config(db)
    # mask key for display
    key = cfg["api_key"]
    masked = ("sk-or-" + "•" * 20 + key[-4:]) if len(key) > 8 else ("•" * len(key) if key else "")
    return {"api_key_masked": masked, "has_key": bool(key), "model": cfg["model"], "available_models": AVAILABLE_MODELS}


class AnalysisConfigIn(BaseModel):
    api_key: str = ""
    model: str = DEFAULT_MODEL


@router.post("/admin/analysis/config")
def save_analysis_config(body: AnalysisConfigIn, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if body.api_key and not body.api_key.startswith("•"):
        _save_config(db, body.api_key, body.model)
    else:
        cfg = _get_config(db)
        _save_config(db, cfg["api_key"], body.model)
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
        {
            "match_id":     r[0],
            "team_a_code":  r[1],
            "team_a_name":  r[2],
            "team_b_code":  r[3],
            "team_b_name":  r[4],
            "match_date":   r[5],
            "phase":        r[6],
            "has_analysis": r[7] is not None,
            "generated_at": r[7],
            "model_used":   r[8],
        }
        for r in rows
    ]


@router.post("/admin/analysis/{match_id}/generate")
def generate_one(match_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    cfg = _get_config(db)
    if not cfg["api_key"]:
        raise HTTPException(400, "OpenRouter API key não configurada")
    content = _generate_one(match_id, db, cfg["api_key"], cfg["model"])
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
    if not cfg["api_key"]:
        raise HTTPException(400, "OpenRouter API key não configurada")

    from config import settings
    background_tasks.add_task(_generate_all_bg, settings.database_url, cfg["api_key"], cfg["model"])
    return {"ok": True, "message": "Geração iniciada em background"}
