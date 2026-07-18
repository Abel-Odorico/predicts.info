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
import time
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

# Validado AO VIVO contra GET https://openrouter.ai/api/v1/models em 2026-07-18
# (task de fallback pago): "anthropic/claude-sonnet-4-5" e "x-ai/grok-3" estavam
# MORTOS (slugs não existem mais no catálogo — sonnet 4.5 usa PONTO, não hífen;
# grok-3 foi descontinuado). Substituídos pelos slugs reais confirmados no JSON.
# "google/gemini-2.5-flash-lite" adicionado (existe, mais barato que o flash normal).
OPENROUTER_PAID_MODELS = [
    {"id": "anthropic/claude-opus-4",                      "label": "💎 Claude Opus 4 (melhor análise)"},
    {"id": "anthropic/claude-sonnet-4.6",                   "label": "💎 Claude Sonnet 4.6 (recomendado Oráculo)"},
    {"id": "anthropic/claude-sonnet-4.5",                   "label": "💎 Claude Sonnet 4.5 (rápido+capaz)"},
    {"id": "openai/gpt-4.1",                               "label": "💎 GPT-4.1 (excelente contexto)"},
    {"id": "openai/gpt-4o",                                "label": "💎 GPT-4o"},
    {"id": "google/gemini-2.5-pro",                        "label": "💎 Gemini 2.5 Pro (via OR)"},
    {"id": "google/gemini-2.5-flash",                      "label": "💎 Gemini 2.5 Flash (via OR)"},
    {"id": "google/gemini-2.5-flash-lite",                 "label": "💡 Gemini 2.5 Flash Lite (via OR, barato)"},
    {"id": "deepseek/deepseek-r1",                         "label": "💎 DeepSeek R1 (raciocínio)"},
    {"id": "meta-llama/llama-4-maverick",                  "label": "💎 Llama 4 Maverick"},
    {"id": "x-ai/grok-4.5",                                "label": "💎 Grok 4.5"},
]

OPENAI_DIRECT_MODELS = [
    {"id": "gpt-4.1",         "label": "💎 GPT-4.1 (melhor para análises longas)"},
    {"id": "gpt-4o",          "label": "💎 GPT-4o (rápido e capaz)"},
    {"id": "gpt-4o-mini",     "label": "💡 GPT-4o Mini (barato e rápido)"},
    {"id": "gpt-4-turbo",     "label": "💎 GPT-4 Turbo"},
    {"id": "o1-mini",         "label": "🧠 o1-mini (raciocínio)"},
]

# Validado 2026-07-18: gemini-3.5-flash existe e responde (API direta Gemini,
# não confundir com o catálogo OpenRouter acima). Mantido sem mudanças.
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

# Fallback pago garantido no fim da cadeia (2026-07-18): OpenRouter tem crédito
# real (US$7,74 em 18/07) mas a cadeia só usava modelos :free (frequentemente
# rate-limited upstream) — crédito nunca era gasto. gemini-2.5-flash via OR já
# testado 200 OK em produção.
DEFAULT_PAID_FALLBACK_MODEL = "google/gemini-2.5-flash"

CONFIG_KEYS = (
    "analysis_provider",
    "openrouter_api_key", "openrouter_model",
    "gemini_api_key",     "gemini_api_key_2", "gemini_model",
    "openai_api_key",     "openai_model",
    "analysis_prompt_template",
    "llm_paid_fallback_model", "llm_paid_fallback_enabled",
    "llm_provider_order", "llm_fallback_enabled",
)

BEST_FREE_OR_MODEL = "meta-llama/llama-3.3-70b-instruct:free"

# ─── Ordem/cadeia de providers (2026-07-18, redesign admin) ──────────────────
# "slot" != modelo: cada slot é uma FONTE de provider (não confundir com o
# catálogo de MODELOS acima). "gemini"/"gemini2" são as 2 keys do Gemini
# tratadas como posições independentes na ordem (permite reordenar key2 antes
# de openai, por exemplo). "openrouter" sempre contribui em bloco (primário
# configurado + frees + pago) na posição em que aparecer na ordem.
DEFAULT_PROVIDER_ORDER = ["gemini", "gemini2", "openai", "openrouter"]
VALID_PROVIDER_SLOTS = {"gemini", "gemini2", "openai", "openrouter"}

PROVIDER_SLOT_LABELS = {
    "gemini":     "Gemini (chave 1)",
    "gemini2":    "Gemini (chave 2 · fallback)",
    "openai":     "OpenAI (direto)",
    "openrouter": "OpenRouter",
}


def _parse_provider_order(raw_value) -> list[str]:
    """Valida a ordem salva em site_config.llm_provider_order (JSON array de
    slots). Valores desconhecidos são ignorados silenciosamente; se sobrar
    vazio ou o valor salvo for inválido, cai no default."""
    order = None
    if raw_value:
        try:
            order = json.loads(raw_value)
        except (TypeError, ValueError):
            order = None
    if not isinstance(order, list):
        return list(DEFAULT_PROVIDER_ORDER)
    cleaned = [s for s in order if isinstance(s, str) and s in VALID_PROVIDER_SLOTS]
    return cleaned or list(DEFAULT_PROVIDER_ORDER)


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
        "paid_fallback_model":   c.get("llm_paid_fallback_model", DEFAULT_PAID_FALLBACK_MODEL) or DEFAULT_PAID_FALLBACK_MODEL,
        "paid_fallback_enabled": c.get("llm_paid_fallback_enabled", "true"),
        "provider_order":    _parse_provider_order(c.get("llm_provider_order")),
        "fallback_enabled":  c.get("llm_fallback_enabled", "true"),
    }


OR_FREE_FALLBACKS = [
    # ⚠️ "openrouter/auto" foi REMOVIDO daqui em 18/07 (achado no diagnóstico do
    # incidente de 402 Payment Required de 11-12/07): apesar do nome da lista,
    # "openrouter/auto" é o smart-router pago da OpenRouter — ele escolhe
    # QUALQUER modelo (inclusive pagos, ex.: "openai/gpt-5.6-sol" no teste real
    # de 18/07) e cobra crédito de verdade por chamada. Confirmado em produção:
    # 210 chamadas via "openrouter/auto" em 11/07 (bug do _auto_generate_analyses
    # sem filtro de competição, já corrigido) queimaram ~US$6,14 de crédito real
    # NUM SÓ DIA (analysis_logs), e no dia seguinte o saldo zerou → 402 em toda
    # a cadeia por horas. Mantê-lo aqui como "fallback grátis" é o oposto do que
    # essa lista promete: sempre que Gemini/OpenAI falharem, ele silenciosamente
    # gasta dinheiro real antes de chegar nos modelos :free de verdade abaixo.
    # Lista revalidada ao vivo em 18/07 contra GET /api/v1/models — 3 dos 4 slugs
    # antigos estavam MORTOS (404 "No endpoints found" / "unavailable for free,
    # use ... instead"): google/gemini-2.0-flash-exp:free, deepseek/deepseek-chat-v3-0324:free,
    # qwen/qwen3-235b-a22b:free, mistralai/mistral-small-3.2-24b-instruct:free —
    # a OpenRouter descontinuou a versão :free desses 4 e só serve a paga no mesmo
    # slug. Substituídos pelos 4 abaixo, testados 200 OK ou rate-limit temporário
    # (upstream congestionado, não morto) no momento da checagem.
    "meta-llama/llama-3.3-70b-instruct:free",
    "openai/gpt-oss-20b:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-31b-it:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
]

def _build_slot_entries(slot: str, cfg: dict) -> list[dict]:
    """Entradas de cadeia produzidas por 1 slot de provider. "openrouter" é o
    único slot que pode gerar mais de 1 entrada (primário + frees + pago)."""
    if slot == "gemini":
        if cfg.get("gemini_key"):
            return [{"type": "gemini", "key": cfg["gemini_key"], "model": cfg["gemini_model"], "label": "Gemini key1"}]
        return []
    if slot == "gemini2":
        if cfg.get("gemini_key_2"):
            return [{"type": "gemini", "key": cfg["gemini_key_2"], "model": cfg["gemini_model"], "label": "Gemini key2"}]
        return []
    if slot == "openai":
        if cfg.get("openai_key"):
            oai_model = cfg.get("openai_model") or "gpt-4o-mini"
            return [{"type": "openai", "key": cfg["openai_key"], "model": oai_model, "label": f"OpenAI {oai_model}"}]
        return []
    if slot == "openrouter":
        if not cfg.get("openrouter_key"):
            return []
        or_key = cfg["openrouter_key"]
        or_model = cfg.get("openrouter_model") or BEST_FREE_OR_MODEL
        entries = [{"type": "openrouter", "key": or_key, "model": or_model, "label": f"OpenRouter {or_model.split('/')[-1]}"}]
        # Free fallbacks (skip if same as primary)
        for m in OR_FREE_FALLBACKS:
            if m != or_model:
                entries.append({"type": "openrouter", "key": or_key, "model": m, "label": f"OpenRouter {m.split('/')[-1]}"})
        # Fallback PAGO garantido no fim do bloco OpenRouter (2026-07-18): depois
        # de esgotar os :free (frequentemente rate-limited upstream), usa 1
        # modelo pago da OpenRouter — crédito real existe e nunca era usado sem
        # isso. Marcado "paid": True pra _call_llm aplicar a guarda de orçamento
        # diário antes de chamar. Desligável via site_config.llm_paid_fallback_enabled="false".
        if str(cfg.get("paid_fallback_enabled", "true")).strip().lower() != "false":
            paid_model = cfg.get("paid_fallback_model") or DEFAULT_PAID_FALLBACK_MODEL
            entries.append({
                "type": "openrouter", "key": or_key, "model": paid_model,
                "label": f"OpenRouter PAGO {paid_model.split('/')[-1]}", "paid": True,
            })
        return entries
    return []


def _get_provider_chain(cfg: dict) -> list[dict]:
    """Cadeia de fallback montada na ordem de cfg['provider_order'] (site_config
    llm_provider_order, JSON array de slots — default gemini→gemini2→openai→
    openrouter, ver DEFAULT_PROVIDER_ORDER). Slots sem key configurada são
    pulados silenciosamente; valores desconhecidos na ordem também (validado em
    _parse_provider_order).

    Se cfg['fallback_enabled'] (site_config llm_fallback_enabled) for "false",
    a cadeia inteira vira só o PRIMEIRO provider configurado da ordem — sem
    frees, sem fallback pago (se o primeiro for openrouter, usa só o modelo
    primário configurado, nada mais)."""
    order = cfg.get("provider_order") or list(DEFAULT_PROVIDER_ORDER)
    fallback_on = str(cfg.get("fallback_enabled", "true")).strip().lower() != "false"

    if not fallback_on:
        for slot in order:
            entries = _build_slot_entries(slot, cfg)
            if entries:
                return [entries[0]]
        return []

    chain = []
    for slot in order:
        chain.extend(_build_slot_entries(slot, cfg))
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
            "max_tokens": 6000,
        },
        timeout=90,
    )
    resp.raise_for_status()
    data = resp.json()
    # Some models return errors inside 200 response body
    if data.get("error"):
        err = data["error"]
        raise ValueError(f"OpenRouter error: {err.get('message', err)}")
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
    sdk_err = None
    text_out = None

    # Try SDK first
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
    except Exception as e:
        sdk_err = e
        # Re-raise quota errors immediately — don't waste REST quota
        if _is_quota_error(str(e)):
            raise
        # For non-quota SDK errors (import failure, network) fall back to REST
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


# ─── Alerta de cadeia morta (Telegram, dedup 6h) ──────────────────────────────
# Isolado em try/except: falha de Telegram NUNCA pode derrubar a geração de análise.

LLM_ALERT_REDIS_KEY = "llm:alert:last"
LLM_ALERT_COOLDOWN_S = 6 * 3600  # 6h
_llm_alert_mem_fallback = {"ts": 0.0}  # usado só se Redis estiver indisponível


def _alert_chain_dead(chain: list, last_exc: Exception | None) -> None:
    import time as _time
    try:
        r = _redis_for_progress()
        now = _time.time()

        if r:
            try:
                if r.get(LLM_ALERT_REDIS_KEY):
                    return  # já alertado nas últimas 6h
            except Exception:
                r = None  # Redis flaky — cai pro guard em memória

        if not r:
            if now - _llm_alert_mem_fallback["ts"] < LLM_ALERT_COOLDOWN_S:
                return

        from database import SessionLocal
        from routers.report import _telegram_config
        import httpx as _httpx

        db = SessionLocal()
        try:
            tg_token, tg_chat = _telegram_config(db)
        finally:
            db.close()
        if not tg_token or not tg_chat:
            return

        labels = ", ".join(p["label"] for p in chain) if chain else "nenhum provider configurado"
        msg = (
            "⚠️ <b>Análise IA: TODOS os provedores falharam</b>\n\n"
            f"Cadeia testada: {labels}\n"
            f"Último erro: {str(last_exc)[:300]}\n\n"
            "Confirme quota/créditos no admin (Sistema → Motor &amp; IA → 🧠 Saúde dos Provedores LLM)."
        )
        _httpx.post(
            f"https://api.telegram.org/bot{tg_token}/sendMessage",
            json={"chat_id": tg_chat, "text": msg, "parse_mode": "HTML", "disable_web_page_preview": True},
            timeout=10,
        )

        if r:
            try:
                r.setex(LLM_ALERT_REDIS_KEY, LLM_ALERT_COOLDOWN_S, _utcnow().isoformat())
            except Exception:
                pass
        _llm_alert_mem_fallback["ts"] = now
    except Exception as e:
        print(f"[analysis] alerta de cadeia morta falhou (ignorado): {e}", flush=True)


# ─── Guarda de orçamento diário (provider pago) ──────────────────────────────
# Isolado: erro aqui NUNCA bloqueia a geração (fail-open) — só evita estourar
# o gasto real com o provider PAGO. Soma cost_usd de analysis_logs do dia UTC.

LLM_DAILY_BUDGET_DEFAULT_USD = 1.50
BUDGET_ALERT_REDIS_KEY = "llm:alert:budget"
BUDGET_ALERT_COOLDOWN_S = 6 * 3600  # 6h, mesmo padrão do alerta de cadeia morta


def _check_daily_budget() -> tuple[bool, float, float]:
    """Retorna (orcamento_estourado, gasto_hoje_usd, limite_usd). Fail-open: se a
    checagem em si falhar, NÃO bloqueia o provider pago (só loga)."""
    limit = LLM_DAILY_BUDGET_DEFAULT_USD
    try:
        from database import SessionLocal
        db = SessionLocal()
        try:
            row = db.execute(
                text("SELECT value FROM site_config WHERE key = 'llm_daily_budget_usd'")
            ).fetchone()
            if row and row[0]:
                try:
                    limit = float(row[0])
                except (TypeError, ValueError):
                    pass
            spent_row = db.execute(
                text("""
                    SELECT COALESCE(SUM(cost_usd), 0) FROM analysis_logs
                    WHERE status = 'ok'
                      AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
                """)
            ).fetchone()
            spent = float(spent_row[0] or 0)
        finally:
            db.close()
        return spent >= limit, spent, limit
    except Exception as e:
        print(f"[analysis] guarda de orçamento falhou (fail-open, seguindo sem bloquear): {e}", flush=True)
        return False, 0.0, limit


def _alert_budget_exceeded(spent: float, limit: float) -> None:
    try:
        r = _redis_for_progress()
        if r:
            try:
                if r.get(BUDGET_ALERT_REDIS_KEY):
                    return  # já alertado nas últimas 6h
            except Exception:
                r = None

        from database import SessionLocal
        from routers.report import _telegram_config
        import httpx as _httpx

        db = SessionLocal()
        try:
            tg_token, tg_chat = _telegram_config(db)
        finally:
            db.close()
        if not tg_token or not tg_chat:
            return

        msg = (
            "💰 <b>Análise IA: orçamento diário do provider pago atingido</b>\n\n"
            f"Gasto hoje (UTC): US$ {spent:.2f} / limite US$ {limit:.2f}\n"
            "Provider pago pulado nesta chamada — cadeia segue só com modelos gratuitos "
            "(podem estar rate-limited). Ajuste <code>llm_daily_budget_usd</code> no site_config se necessário."
        )
        _httpx.post(
            f"https://api.telegram.org/bot{tg_token}/sendMessage",
            json={"chat_id": tg_chat, "text": msg, "parse_mode": "HTML", "disable_web_page_preview": True},
            timeout=10,
        )
        if r:
            try:
                r.setex(BUDGET_ALERT_REDIS_KEY, BUDGET_ALERT_COOLDOWN_S, _utcnow().isoformat())
            except Exception:
                pass
    except Exception as e:
        print(f"[analysis] alerta de orçamento falhou (ignorado): {e}", flush=True)


# ─── Circuit breaker por provider (Redis) ────────────────────────────────────
# Provider que falhou por quota some da cadeia por um tempo (evita bater na
# mesma parede repetidamente); se TODOS estiverem em cooldown, tenta mesmo
# assim (não pode deixar de gerar por excesso de cautela).

CB_REDIS_PREFIX = "llm:cb:"
CB_TTL_DEFAULT_S = 30 * 60      # 30min
CB_TTL_ZERO_TIER_S = 6 * 3600   # 6h — free tier zerado ("limit: 0") não volta sozinho


def _cb_key(label: str) -> str:
    return f"{CB_REDIS_PREFIX}{label}"


def _cb_is_open(r, label: str) -> bool:
    if not r:
        return False
    try:
        return bool(r.exists(_cb_key(label)))
    except Exception:
        return False


def _cb_trip(r, label: str, err_str: str) -> None:
    if not r:
        return
    ttl = CB_TTL_DEFAULT_S
    if "limit: 0" in err_str:
        ttl = CB_TTL_ZERO_TIER_S
        print(f"[analysis] {label}: key sem free tier — trocar key ou ativar billing (cooldown 6h)", flush=True)
    try:
        r.setex(_cb_key(label), ttl, _utcnow().isoformat())
    except Exception:
        pass


def _infer_provider_type(model_tag: str) -> str:
    low = (model_tag or "").lower()
    if "gemini" in low:
        return "gemini"
    if "openai" in low:
        return "openai"
    return "openrouter"


def log_llm_usage(db: Session, *, trigger: str, model_tag: str, usage: dict,
                   match_id: int | None = None, duration_ms: int = 0) -> None:
    """Log genérico de uso de LLM em analysis_logs para chamadas fora do pipeline
    de análise de partida (Oráculo em bot.py, H2H via IA em projections.py).
    Falha aqui NUNCA pode derrubar quem chamou — sempre isolado em try/except."""
    try:
        db.execute(
            text("""
                INSERT INTO analysis_logs (match_id, model_used, provider, tokens_in, tokens_out,
                    cost_usd, duration_ms, status, trigger, created_at)
                VALUES (:mid, :model, :prov, :ti, :to, :cost, :dur, 'ok', :trig, :now)
            """),
            {
                "mid": match_id, "model": model_tag, "prov": _infer_provider_type(model_tag),
                "ti": usage.get("tokens_in", 0) or 0, "to": usage.get("tokens_out", 0) or 0,
                "cost": usage.get("cost_usd", 0.0) or 0.0, "dur": duration_ms,
                "trig": trigger, "now": _utcnow(),
            },
        )
        db.commit()
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        print(f"[analysis] log_llm_usage falhou (ignorado, trigger={trigger}): {e}", flush=True)


def _call_llm(cfg: dict, prompt: str, provider_state: list | None = None, chain: list | None = None) -> tuple[dict, str, dict]:
    """
    Chama LLM com fallback automático pela cadeia (_get_provider_chain), pulando
    providers em cooldown (circuit breaker) e o fallback pago se o orçamento
    diário estourou. Sempre percorre a cadeia completa a partir de `start`.
    Se TODOS os providers restantes estiverem em cooldown, ignora o breaker
    (melhor tentar do que deixar de gerar).
    Returns (result, model_tag, usage_meta).
    """
    if chain is None:
        chain = _get_provider_chain(cfg)
    if not chain:
        raise ValueError("Nenhum provider configurado (configure Gemini ou OpenRouter)")

    start = provider_state[0] if provider_state else 0
    last_exc: Exception | None = None
    last_attempted_label: str | None = None
    last_attempted_model: str | None = None

    r = _redis_for_progress()
    remaining = chain[start:]
    all_in_cooldown = bool(remaining) and all(_cb_is_open(r, p["label"]) for p in remaining)

    for idx in range(start, len(chain)):
        p = chain[idx]

        if not all_in_cooldown and _cb_is_open(r, p["label"]):
            print(f"[analysis] {p['label']} em cooldown (circuit breaker)", flush=True)
            continue

        if p.get("paid"):
            over_budget, spent, limit = _check_daily_budget()
            if over_budget:
                print(f"[analysis] budget diário atingido ({spent:.2f}/{limit:.2f} USD) — provider pago pulado", flush=True)
                _alert_budget_exceeded(spent, limit)
                continue

        last_attempted_label = p["label"]
        last_attempted_model = p["model"]
        try:
            if p["type"] == "gemini":
                result, meta = _call_gemini(p["key"], p["model"], prompt)
            elif p["type"] == "openai":
                result, meta = _call_openai(p["key"], p["model"], prompt)
            else:
                result, meta = _call_openrouter(p["key"], p["model"], prompt)
            if provider_state is not None:
                provider_state[0] = idx
            print(f"[analysis] ✓ provider={p['label']}", flush=True)
            return result, p["label"], meta
        except Exception as e:
            last_exc = e
            err_str = str(e)
            is_quota = _is_quota_error(err_str)
            if is_quota:
                _cb_trip(r, p["label"], err_str)
            next_label = chain[idx + 1]["label"] if idx + 1 < len(chain) else None
            if is_quota and next_label:
                print(f"[analysis] {p['label']} rate-limited → tentando {next_label}", flush=True)
                continue
            elif is_quota:
                print(f"[analysis] {p['label']} rate-limited — todos os providers esgotados", flush=True)
                break
            elif isinstance(e, (ValueError, KeyError)) and next_label:
                # JSON parse / truncation errors — try next provider
                print(f"[analysis] {p['label']} output inválido → tentando {next_label}: {err_str[:80]}", flush=True)
                continue
            else:
                # Auth / network errors: raise immediately (marca provider/model
                # tentado no próprio objeto de exceção, pra quem logar erro saber quem falhou)
                print(f"[analysis] {p['label']} erro: {err_str[:120]}", flush=True)
                e.llm_provider = _infer_provider_type(p["label"])
                e.llm_model = p["label"]
                raise

    _alert_chain_dead(chain, last_exc)
    exc = ValueError(f"Todos os providers esgotados. Último erro: {last_exc}")
    exc.llm_provider = _infer_provider_type(last_attempted_label) if last_attempted_label else None
    exc.llm_model = last_attempted_label
    raise exc


def _compute_streaks(results: list, team_code: str) -> dict:
    """A partir de recent_a/recent_b (mais recente primeiro), calcula fatos honestos:
    jogos seguidos sem vencer e jogos seguidos sofrendo gol, olhando do mais recente pra trás."""
    if not results:
        return {"winless_streak": 0, "conceded_streak": 0, "total_considered": 0}

    winless, conceded_streak = 0, 0
    stop_winless, stop_conceded = False, False
    for r in results:
        gf, ga = (r["score_a"], r["score_b"]) if r["team_a"] == team_code else (r["score_b"], r["score_a"])
        if not stop_winless:
            if gf > ga:
                stop_winless = True
            else:
                winless += 1
        if not stop_conceded:
            if ga > 0:
                conceded_streak += 1
            else:
                stop_conceded = True
        if stop_winless and stop_conceded:
            break

    return {"winless_streak": winless, "conceded_streak": conceded_streak, "total_considered": len(results)}


def _get_top_scorer(team_code: str) -> dict | None:
    """Lê o cache de artilheiros (populado por GET /tournament/awards, Wikipedia)
    sem chamar a Wikipedia direto daqui — geração de análise não pode depender
    de latência/erro de fonte externa nova."""
    try:
        from routers.awards import _redis as _awards_redis, AWARDS_CACHE_KEY
        r = _awards_redis()
        cached = r.get(AWARDS_CACHE_KEY)
        if not cached:
            return None
        data = json.loads(cached)
        for s in data.get("top_scorers", []):
            if s.get("team") == team_code:
                return {"player": s["player"], "goals": s["goals"]}
    except Exception:
        pass
    return None


def _fatos_verificados(results: list, team_code: str) -> str:
    """Monta a linha de fatos reais (não-invenção) que vira base do campo 'hook'."""
    fatos = []
    scorer = _get_top_scorer(team_code)
    if scorer:
        gol_txt = "gol" if scorer["goals"] == 1 else "gols"
        fatos.append(f"Artilheiro do time: {scorer['player']} ({scorer['goals']} {gol_txt} nesta Copa)")

    s = _compute_streaks(results, team_code)
    if s["total_considered"] > 0:
        if s["winless_streak"] == 0:
            fatos.append("vem de vitória no último jogo")
        elif s["winless_streak"] == 1:
            fatos.append("sem vencer há 1 jogo")
        else:
            fatos.append(f"sem vencer há {s['winless_streak']} jogos")
        if s["conceded_streak"] == 1:
            fatos.append("sofreu gol no último jogo")
        elif s["conceded_streak"] > 1:
            fatos.append(f"sofreu gol nos últimos {s['conceded_streak']} jogos seguidos")

    return " | ".join(fatos) if fatos else "sem fato marcante disponível — use forma/ataque já fornecidos"


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
    "## Fatos verificados (não são opinião — números reais, use como base do campo \"hook\")\n"
    "{team_a_code}: {team_a_fatos}\n"
    "{team_b_code}: {team_b_fatos}\n\n"
    "## SAÍDA — JSON PURO (sem markdown, sem ```):\n"
    '{{\n'
    '  "hook": "UMA frase curta e impactante pra ABRIR a análise, tipo manchete de jornal esportivo. '
    'Use SOMENTE números da seção Fatos Verificados acima (artilheiro e gols, sequência sem vencer, jogos seguidos sofrendo gol). '
    'PROIBIDO inventar número, sequência ou estatística que não esteja literalmente nos Fatos Verificados. '
    'Se os Fatos Verificados de um time disserem \'sem fato marcante disponível\', use forma/ataque/xG já fornecidos pra esse time. '
    'Ex: \'{team_a_name} chega embalado com {team_a_name} artilheiro da Copa, enquanto {team_b_name} não vence há X jogos.\'",\n'
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

    team_a_fatos = _fatos_verificados(recent_a, team_a.code)
    team_b_fatos = _fatos_verificados(recent_b, team_b.code)

    template = custom_template.strip() if custom_template else DEFAULT_PROMPT_TEMPLATE
    return template.format(
        team_a_fatos=team_a_fatos, team_b_fatos=team_b_fatos,
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


# ─── Prompt builder — Brasileirão (futebol de clube) ─────────────────────────
#
# Variante do prompt pra competições de clube (Brasileirão): sem "convocados"
# (Player só existe pra seleções via convocação da Copa — clubes não têm essa
# tabela populada), sem ELO/histórico de Copa. Em vez disso: posição na tabela
# desta temporada, títulos históricos do clube, forma V/E/D e confronto direto
# nesta temporada. key_players vem do conhecimento real da IA sobre o elenco
# atual do clube (sem lista de convocados pra ancorar) — instrução explícita
# pra não inventar lesão/suspensão que não temos como confirmar.

BR_PROMPT_TEMPLATE = (
    "Você é um jornalista esportivo sênior especializado em futebol brasileiro, "
    "com profundo conhecimento tático do Campeonato Brasileiro Série A.\n"
    "Analise a partida {team_a_name} × {team_b_name}, válida pela rodada {rodada} "
    "do Brasileirão {season}, com rigor técnico e paixão futebolística.\n\n"
    "REGRAS OBRIGATÓRIAS:\n"
    "- Escreva em PORTUGUÊS BRASILEIRO fluente, estilo ESPN/Globo Esporte\n"
    "- Use os DADOS FORNECIDOS (posição, pontos, forma, elo) como base factual; "
    "enriqueça com conhecimento tático real de cada clube\n"
    "- key_players: cite os 3 jogadores mais relevantes de cada elenco pelo seu conhecimento real do "
    "futebol brasileiro atual — NÃO temos lista de convocados nem boletim médico, então NÃO afirme "
    "lesão/suspensão específica; se não tiver certeza de quem está em campo hoje, fale em termos de "
    "'peça-chave do sistema' em vez de cravar titularidade\n"
    "- Mencione sistemas táticos concretos (4-3-3, 4-2-3-1, 3-5-2, etc.) com base no estilo reconhecido do técnico/clube\n"
    "- Contextualize na tabela: briga por título, G4/Libertadores, meio de tabela ou risco de rebaixamento\n"
    "- Seja CIRÚRGICO em predições: placar, quem marca, em que fase do jogo\n\n"
    "## DADOS DA PARTIDA\n"
    "Rodada {rodada} de 38 | Data: {match_date}\n\n"
    "## {team_a_name} ({team_a_code})\n"
    "Posição: {team_a_pos}º lugar | {team_a_pts} pts (V{team_a_v} E{team_a_e} D{team_a_d}) | Saldo de gols: {team_a_sg}\n"
    "Elo (replay da temporada): {team_a_elo}\n"
    "Ataque: {team_a_avg_gf} gols/jogo | Defesa: {team_a_avg_ga} sofridos/jogo\n"
    "Forma — últimos 5 jogos: {team_a_form_str}\n"
    "Títulos do Brasileirão: {team_a_titles}\n"
    "Últimos resultados:\n{team_a_results}\n\n"
    "## {team_b_name} ({team_b_code})\n"
    "Posição: {team_b_pos}º lugar | {team_b_pts} pts (V{team_b_v} E{team_b_e} D{team_b_d}) | Saldo de gols: {team_b_sg}\n"
    "Elo (replay da temporada): {team_b_elo}\n"
    "Ataque: {team_b_avg_gf} gols/jogo | Defesa: {team_b_avg_ga} sofridos/jogo\n"
    "Forma — últimos 5 jogos: {team_b_form_str}\n"
    "Títulos do Brasileirão: {team_b_titles}\n"
    "Últimos resultados:\n{team_b_results}\n"
    "{mc_probs}\n"
    "## Confronto direto nesta temporada\n{h2h_season}\n\n"
    "## Fatos verificados (não são opinião — números reais, use como base do campo \"hook\")\n"
    "{team_a_code}: {team_a_fatos}\n"
    "{team_b_code}: {team_b_fatos}\n\n"
    "## SAÍDA — JSON PURO (sem markdown, sem ```):\n"
    '{{\n'
    '  "hook": "UMA frase curta e impactante pra ABRIR a análise, tipo manchete de jornal esportivo. '
    'Use SOMENTE números da seção Fatos Verificados acima (sequência sem vencer, jogos seguidos sofrendo gol) '
    'ou dados de posição/pontos/forma já fornecidos. PROIBIDO inventar número, lesão ou estatística que não '
    'esteja nos dados acima.",\n'
    '  "overview": "3 parágrafos: (1) contexto na tabela — o que está em jogo pros dois lados (título, G4, Z4); '
    '(2) retrospecto do confronto direto nesta temporada, se houver; '
    '(3) momento atual de cada clube — quem vem melhor, quem precisa reagir",\n'
    '  "team_a": {{\n'
    '    "tactical": "Sistema tático específico (ex: 4-3-3 de pressão alta), como se organiza defensiva e ofensivamente",\n'
    '    "key_players": ["Jogador 1 (posição) — papel no time", "Jogador 2 (posição) — ...", "Jogador 3 (posição) — ..."],\n'
    '    "form": "Desempenho recente na temporada: pontos conquistados, consistência, tendência (subindo/caindo na tabela)",\n'
    '    "strengths": "3-4 qualidades concretas no contexto deste confronto",\n'
    '    "weaknesses": "2-3 vulnerabilidades reais que {team_b_name} pode explorar hoje"\n'
    '  }},\n'
    '  "team_b": {{\n'
    '    "tactical": "...", "key_players": ["...", "...", "..."], "form": "...", "strengths": "...",\n'
    '    "weaknesses": "2-3 vulnerabilidades que {team_a_name} pode explorar"\n'
    '  }},\n'
    '  "matchup": "2 parágrafos: (1) batalha tática principal — onde o jogo será decidido; '
    '(2) fator X — o que pode mudar o jogo (banco de reservas, mando de campo, pressão da posição na tabela)",\n'
    '  "prediction": "2 parágrafos: (1) como o jogo deve se desenvolver; '
    '(2) cite o placar mais provável do modelo (primeiro da lista de placares acima) e os xG esperados, '
    'justifique taticamente, diga quem tende a marcar e em que período",\n'
    '  "verdict": "Uma frase direta e opinativa sobre quem leva vantagem, ou se é jogo equilibrado"\n'
    '}}'
)


def _build_prompt_br(match_row, team_a: Team, team_b: Team, ctx_a: dict, ctx_b: dict,
                      recent_a, recent_b, mc_prob, h2h_season: list, custom_template: str = "") -> str:
    def fmt_results(results):
        if not results:
            return "  Sem dados disponíveis nesta temporada"
        return "\n".join(
            f"  {r['date']}: {r['team_a']} {r['score_a']}–{r['score_b']} {r['team_b']}"
            for r in results[:5]
        )

    def fmt_form(recent, code):
        if not recent:
            return "N/D"
        out = []
        for r in recent[:5]:
            gf, ga = (r["score_a"], r["score_b"]) if r["team_a"] == code else (r["score_b"], r["score_a"])
            out.append("V" if gf > ga else ("D" if gf < ga else "E"))
        return "-".join(out)

    mc_probs = ""
    if mc_prob:
        top_sc = mc_prob.get("top_scores", [])[:5]
        scores_str = "  |  ".join(f"{s['score']} ({s['prob']:.1f}%)" for s in top_sc) if top_sc else "N/D"
        mc_probs = (
            f"## Probabilidades Dixon-Coles + Monte Carlo\n"
            f"  Vitória {team_a.name}: {mc_prob.get('prob_a', 0):.1f}% | "
            f"Empate: {mc_prob.get('prob_draw', 0):.1f}% | "
            f"Vitória {team_b.name}: {mc_prob.get('prob_b', 0):.1f}%\n"
            f"  xG esperado: {team_a.name} {mc_prob.get('lambda_a', 0):.2f} gols × "
            f"{team_b.name} {mc_prob.get('lambda_b', 0):.2f} gols\n"
            f"  Placares mais prováveis: {scores_str}\n"
        )

    if h2h_season:
        h2h_str = "\n".join(
            f"  {g['home']} {g['score_home']} × {g['score_away']} {g['away']}" for g in h2h_season
        )
    else:
        h2h_str = "  Times ainda não se enfrentaram nesta temporada"

    team_a_fatos = _fatos_verificados(recent_a, team_a.code)
    team_b_fatos = _fatos_verificados(recent_b, team_b.code)

    template = custom_template.strip() if custom_template else BR_PROMPT_TEMPLATE
    return template.format(
        team_a_fatos=team_a_fatos, team_b_fatos=team_b_fatos,
        team_a_name=team_a.name, team_a_code=team_a.code,
        team_a_pos=ctx_a["pos"], team_a_pts=ctx_a["pts"],
        team_a_v=ctx_a["v"], team_a_e=ctx_a["e"], team_a_d=ctx_a["d"],
        team_a_sg=ctx_a["sg"], team_a_titles=ctx_a["titles"],
        team_a_elo=team_a.elo_rating or "N/D",
        team_a_avg_gf=team_a.avg_goals_for or "N/D",
        team_a_avg_ga=team_a.avg_goals_against or "N/D",
        team_a_form_str=fmt_form(recent_a, team_a.code),
        team_a_results=fmt_results(recent_a),
        team_b_name=team_b.name, team_b_code=team_b.code,
        team_b_pos=ctx_b["pos"], team_b_pts=ctx_b["pts"],
        team_b_v=ctx_b["v"], team_b_e=ctx_b["e"], team_b_d=ctx_b["d"],
        team_b_sg=ctx_b["sg"], team_b_titles=ctx_b["titles"],
        team_b_elo=team_b.elo_rating or "N/D",
        team_b_avg_gf=team_b.avg_goals_for or "N/D",
        team_b_avg_ga=team_b.avg_goals_against or "N/D",
        team_b_form_str=fmt_form(recent_b, team_b.code),
        team_b_results=fmt_results(recent_b),
        rodada=match_row.get("match_number") or "?",
        season=match_row.get("season", 2026),
        match_date=str(match_row.get("match_date", ""))[:10],
        mc_probs=mc_probs,
        h2h_season=h2h_str,
    )


def _get_br_context(db: Session, comp_id: int, team_a_id: int, team_b_id: int) -> tuple[dict, dict, list]:
    """Posição/pts/V-E-D/SG (tabela desta temporada) + confronto direto desta
    temporada, pros dois times. Reusa a lógica de tabela de routers/brasileirao.py
    (import local pra evitar ciclo — brasileirao.py não importa analysis.py)."""
    from routers.brasileirao import _load_matches, _build_table, BR_TITLES
    from models import Team as _Team

    clubs = db.query(_Team).filter(_Team.competition_id == comp_id).all()
    matches = _load_matches(db, comp_id)
    table = _build_table(clubs, matches)
    club_by_id = {c.id: c for c in clubs}

    rows = []
    for cid, r in table.items():
        c = club_by_id[cid]
        rows.append({"team_id": cid, "name": c.name, **r})
    rows.sort(key=lambda r: (-r["pts"], -r["v"], -(r["gp"] - r["gc"]), -r["gp"], r["name"]))
    pos_by_id = {r["team_id"]: i for i, r in enumerate(rows, start=1)}

    def ctx(team_id: int) -> dict:
        r = table.get(team_id, {"pts": 0, "v": 0, "e": 0, "d": 0, "gp": 0, "gc": 0})
        code = club_by_id[team_id].code
        return {
            "pos": pos_by_id.get(team_id, "?"), "pts": r["pts"],
            "v": r["v"], "e": r["e"], "d": r["d"], "sg": r["gp"] - r["gc"],
            "titles": BR_TITLES.get(code, 0),
        }

    h2h_season = [
        {
            "home": club_by_id[m.team_a_id].code, "away": club_by_id[m.team_b_id].code,
            "score_home": m.result.score_a, "score_away": m.result.score_b,
        }
        for m in matches
        if m.result and {m.team_a_id, m.team_b_id} == {team_a_id, team_b_id}
    ]
    return ctx(team_a_id), ctx(team_b_id), h2h_season


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
            SELECT m.id, ta.id, tb.id, m.match_date, m.phase, ta.group_name,
                   m.competition_id, m.match_number, c.code AS comp_code
            FROM matches m
            JOIN teams ta ON ta.id = m.team_a_id
            JOIN teams tb ON tb.id = m.team_b_id
            LEFT JOIN competitions c ON c.id = m.competition_id
            WHERE m.id = :mid
        """),
        {"mid": match_id},
    ).fetchone()
    if not row:
        raise HTTPException(404, "Partida não encontrada")

    match_row = {
        "match_date": row[3], "phase": row[4], "group_name": row[5],
        "match_number": row[7],
    }
    team_a = db.query(Team).get(row[1])
    team_b = db.query(Team).get(row[2])
    comp_code = row[8]

    if comp_code == "brasileirao2026":
        ctx_a, ctx_b, h2h_season = _get_br_context(db, row[6], row[1], row[2])
        prompt = _build_prompt_br(match_row, team_a, team_b, ctx_a, ctx_b,
                                   _get_recent_results(db, team_a.code),
                                   _get_recent_results(db, team_b.code),
                                   _get_mc_prob(db, match_id),
                                   h2h_season,
                                   cfg.get("prompt_template_br", ""))
    else:
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
    provider_type = "gemini" if "gemini" in model_tag.lower() else ("openai" if "openai" in model_tag.lower() else "openrouter")
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


import threading as _threading
_bg_lock = _threading.Lock()

def _generate_all_bg(db_url: str, cfg: dict, only_pending: bool = True, only_future: bool = False, trigger: str = "manual", competition_id: int | None = None):
    if not _bg_lock.acquire(blocking=False):
        print("[analysis] background: já está em execução — pulando", flush=True)
        return
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
    if competition_id is not None:
        clauses.append("m.competition_id = :competition_id")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params = {"competition_id": competition_id} if competition_id is not None else {}

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
            """),
            params,
        ).fetchall()

        match_map = {row[0]: f"{row[1]} × {row[2]}" for row in pending}
        pending_ids = [(row[0],) for row in pending]

        chain = _get_provider_chain(cfg)
        # provider_state NOT shared: each match tries the full chain independently
        # so Gemini is retried on each match (recovers from per-minute limits)

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

        consecutive_rate_limits = 0
        RATE_LIMIT_CIRCUIT = 3  # stop batch after 3 consecutive rate limits

        for i, (mid,) in enumerate(pending_ids):
            match_label = match_map.get(mid, f"#{mid}")
            progress["current"] = match_label
            _push_progress(r, progress)

            t0 = time.time()
            try:
                _generate_one(mid, db, cfg, None, batch_id=batch_id, trigger=trigger)
                duration_ms = int((time.time() - t0) * 1000)
                consecutive_rate_limits = 0
                progress["done"] += 1
                progress["items"].append({
                    "match_id": mid, "teams": match_label,
                    "duration_ms": duration_ms,
                    "status": "ok", "finished_at": _utcnow().isoformat(),
                })
                _push_progress(r, progress)
                if i < len(pending_ids) - 1:
                    time.sleep(3)
            except Exception as e:
                err = str(e)
                duration_ms = int((time.time() - t0) * 1000)
                print(f"[analysis] ✗ match_id={mid}: {err[:120]}", flush=True)
                # _call_llm marca .llm_provider/.llm_model no último provider tentado
                # antes de levantar (ver _call_llm) — sem isso essas linhas entravam NULL.
                err_provider = getattr(e, "llm_provider", None)
                err_model = getattr(e, "llm_model", None)
                try:
                    db.execute(
                        text("""
                            INSERT INTO analysis_logs (match_id, model_used, provider, status, error_msg, batch_id, created_at)
                            VALUES (:mid, :model, :prov, 'error', :err, :bid, :now)
                        """),
                        {
                            "mid": mid,
                            "model": err_model, "prov": err_provider,
                            "err": err[:500], "bid": batch_id, "now": _utcnow(),
                        },
                    )
                    db.commit()
                except Exception:
                    db.rollback()
                progress["done"] += 1
                progress["items"].append({
                    "match_id": mid, "teams": match_label,
                    "model": "—",
                    "duration_ms": duration_ms,
                    "status": "error", "error": err[:200],
                    "finished_at": _utcnow().isoformat(),
                })
                _push_progress(r, progress)
                if _is_quota_error(err):
                    consecutive_rate_limits += 1
                    if consecutive_rate_limits >= RATE_LIMIT_CIRCUIT:
                        print(f"[analysis] circuit breaker — {RATE_LIMIT_CIRCUIT} rate limits consecutivos, encerrando batch", flush=True)
                        break
                    print(f"[analysis] rate limit — aguardando 30s ({consecutive_rate_limits}/{RATE_LIMIT_CIRCUIT})", flush=True)
                    time.sleep(30)

        progress["status"] = "done"
        progress["current"] = None
        progress["ended_at"] = _utcnow().isoformat()
        _push_progress(r, progress)

    except Exception as outer:
        progress_err = {"batch_id": batch_id, "status": "error", "error": str(outer)[:300]}
        _push_progress(r, progress_err)
    finally:
        db.close()
        _bg_lock.release()


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
    has_key_by_slot = {
        "gemini":     bool(cfg["gemini_key"]),
        "gemini2":    bool(cfg["gemini_key_2"]),
        "openai":     bool(cfg["openai_key"]),
        "openrouter": bool(cfg["openrouter_key"]),
    }
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
        "provider_chain":         [
            {"label": p["label"], "type": p["type"], "model": p.get("model"), "paid": bool(p.get("paid"))}
            for p in chain
        ],
        "best_free_or_model":     BEST_FREE_OR_MODEL,
        # ── Ordem / fallback (redesign 2026-07-18) ──────────────────────────
        "provider_order":         cfg["provider_order"],
        "provider_slots": [
            {"id": slot, "label": PROVIDER_SLOT_LABELS[slot], "has_key": has_key_by_slot[slot]}
            for slot in DEFAULT_PROVIDER_ORDER
        ],
        "fallback_enabled":       str(cfg["fallback_enabled"]).strip().lower() != "false",
        "paid_fallback_model":    cfg["paid_fallback_model"],
        "paid_fallback_enabled":  str(cfg["paid_fallback_enabled"]).strip().lower() != "false",
        "llm_daily_budget_usd":   _get_llm_daily_budget(db),
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
    provider_order:        list[str] = list(DEFAULT_PROVIDER_ORDER)
    fallback_enabled:       bool = True
    paid_fallback_model:    str = DEFAULT_PAID_FALLBACK_MODEL
    paid_fallback_enabled:  bool = True
    daily_budget_usd:       float = LLM_DAILY_BUDGET_DEFAULT_USD


def _save_config_full(db: Session, body: "AnalysisConfigIn"):
    order = [s for s in (body.provider_order or []) if isinstance(s, str) and s in VALID_PROVIDER_SLOTS]
    order = order or list(DEFAULT_PROVIDER_ORDER)
    pairs = [
        ("analysis_provider",        body.provider),
        ("openrouter_model",         body.openrouter_model),
        ("gemini_model",             body.gemini_model),
        ("openai_model",             body.openai_model),
        ("analysis_prompt_template", body.prompt_template),
        ("llm_provider_order",       json.dumps(order)),
        ("llm_fallback_enabled",     "true" if body.fallback_enabled else "false"),
        ("llm_paid_fallback_model",  body.paid_fallback_model or DEFAULT_PAID_FALLBACK_MODEL),
        ("llm_paid_fallback_enabled", "true" if body.paid_fallback_enabled else "false"),
        ("llm_daily_budget_usd",     str(body.daily_budget_usd)),
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
    try:
        content = _generate_one(match_id, db, cfg)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(503, f"Todos os providers estão com rate limit — tente em alguns minutos. ({exc})")
    except Exception as exc:
        raise HTTPException(503, f"Erro ao gerar análise: {exc}")
    return {"ok": True, "match_id": match_id, "content": content}


class GenerateAllBody(BaseModel):
    only_pending: bool = True
    only_future: bool = False
    competition: str | None = "copa2026"  # prompt é específico pra seleções — None = todas competições


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
    from competitions import get_competition_id
    comp_id = get_competition_id(db, body.competition) if body.competition else None
    background_tasks.add_task(
        _generate_all_bg, settings.database_url, cfg,
        body.only_pending, body.only_future, "manual", comp_id,
    )
    return {"ok": True, "message": "Geração iniciada em background"}


@router.get("/admin/analysis/stats")
def analysis_stats(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    totals = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status='ok')    AS ok,
            COUNT(*) FILTER (WHERE status='error') AS error,
            COALESCE(SUM(tokens_in)  FILTER (WHERE status='ok'), 0) AS ti,
            COALESCE(SUM(tokens_out) FILTER (WHERE status='ok'), 0) AS to_,
            COALESCE(SUM(cost_usd)   FILTER (WHERE status='ok'), 0) AS cost,
            COALESCE(AVG(duration_ms) FILTER (WHERE status='ok'), 0) AS avg_ms
        FROM analysis_logs
    """)).fetchone()

    by_provider = db.execute(text("""
        SELECT
            model_used,
            provider,
            COUNT(*) FILTER (WHERE status='ok')    AS ok,
            COUNT(*) FILTER (WHERE status='error') AS error,
            COALESCE(SUM(tokens_in)  FILTER (WHERE status='ok'), 0) AS ti,
            COALESCE(SUM(tokens_out) FILTER (WHERE status='ok'), 0) AS to_,
            COALESCE(SUM(cost_usd)   FILTER (WHERE status='ok'), 0) AS cost,
            COALESCE(AVG(duration_ms) FILTER (WHERE status='ok'), 0) AS avg_ms
        FROM analysis_logs
        GROUP BY model_used, provider
        ORDER BY cost DESC, ok DESC
    """)).fetchall()

    by_day = db.execute(text("""
        SELECT
            -- created_at é TIMESTAMP naive em UTC: precisa do encadeamento UTC→BRT,
            -- senão o PG trata como horário local e SOMA 3h em vez de subtrair
            DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS day,
            COUNT(*) FILTER (WHERE status='ok')    AS ok,
            COUNT(*) FILTER (WHERE status='error') AS error,
            COALESCE(SUM(tokens_in)  FILTER (WHERE status='ok'), 0) AS ti,
            COALESCE(SUM(tokens_out) FILTER (WHERE status='ok'), 0) AS to_,
            COALESCE(SUM(cost_usd)   FILTER (WHERE status='ok'), 0) AS cost
        FROM analysis_logs
        WHERE created_at >= NOW() - INTERVAL '14 days'
        GROUP BY day
        ORDER BY day ASC
    """)).fetchall()

    return {
        "totals": {
            "ok":       int(totals[0] or 0),
            "error":    int(totals[1] or 0),
            "tokens_in":  int(totals[2] or 0),
            "tokens_out": int(totals[3] or 0),
            "cost_usd": float(totals[4] or 0),
            "avg_ms":   int(totals[5] or 0),
        },
        "by_provider": [
            {
                "model": r[0] or "—",
                "provider": r[1] or "—",
                "ok": int(r[2] or 0),
                "error": int(r[3] or 0),
                "tokens_in": int(r[4] or 0),
                "tokens_out": int(r[5] or 0),
                "cost_usd": float(r[6] or 0),
                "avg_ms": int(r[7] or 0),
            }
            for r in by_provider
        ],
        "by_day": [
            {
                "day": str(r[0]),
                "ok": int(r[1] or 0),
                "error": int(r[2] or 0),
                "tokens_in": int(r[3] or 0),
                "tokens_out": int(r[4] or 0),
                "cost_usd": float(r[5] or 0),
            }
            for r in by_day
        ],
    }


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


# ─── Saúde dos provedores LLM (teste manual + relatório diário) ──────────────
# Incidente 11/07: cadeia INTEIRA ficou fora (Gemini rate-limit + OpenRouter 402)
# por dias sem ninguém perceber. Este bloco testa cada provider da cadeia
# individualmente com prompt mínimo, cacheado 5min (Redis), reusado pelo
# endpoint admin E pelo relatório diário do Telegram (mesma função, sem duplicar).

LLM_TEST_CACHE_KEY = "llm:test:last"
LLM_TEST_CACHE_TTL = 300  # 5 min
LLM_TEST_PROMPT = "Responda apenas: ok"
LLM_TEST_TIMEOUT = 15  # segundos por provider


def _test_call_gemini(api_key: str, model: str, prompt: str, timeout: int = LLM_TEST_TIMEOUT) -> str:
    """Chamada mínima via REST (sem SDK, sem JSON mode) — só valida que o provider responde.
    ⚠️ thinkingBudget=0 é OBRIGATÓRIO aqui (mesmo padrão do _call_gemini de produção):
    modelos "thinking" (ex.: gemini-3.5-flash) gastam o maxOutputTokens inteiro em
    raciocínio interno e devolvem content:{} (sem 'parts') se isso não for zerado —
    achado real testando esta função (Gemini key2 parecia "quebrada", era só isso)."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    resp = http_requests.post(
        url,
        headers={"Content-Type": "application/json"},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": 20,
                "temperature": 0,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    rj = resp.json()
    parts = rj["candidates"][0].get("content", {}).get("parts")
    if not parts:
        raise ValueError(f"resposta sem conteúdo (finishReason={rj['candidates'][0].get('finishReason')})")
    return parts[0]["text"]


def _test_call_openai(api_key: str, model: str, prompt: str, timeout: int = LLM_TEST_TIMEOUT) -> str:
    resp = http_requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 20, "temperature": 0},
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def _test_call_openrouter(api_key: str, model: str, prompt: str, timeout: int = LLM_TEST_TIMEOUT) -> str:
    resp = http_requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://predicts.info",
            "X-Title": "Predicts Copa 2026",
        },
        json={"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 20, "temperature": 0},
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        raise ValueError(f"OpenRouter error: {data['error'].get('message', data['error'])}")
    return data["choices"][0]["message"]["content"]


def _get_openrouter_credits(api_key: str) -> dict | None:
    """GET /api/v1/credits — saldo real da conta OpenRouter (não é por-modelo)."""
    if not api_key:
        return None
    try:
        resp = http_requests.get(
            "https://openrouter.ai/api/v1/credits",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        total = float(data.get("total_credits", 0) or 0)
        used = float(data.get("total_usage", 0) or 0)
        return {"total_credits": total, "total_usage": used, "remaining": round(total - used, 4)}
    except Exception as e:
        return {"error": str(e)[:200]}


def _get_llm_consumption_7d(db: Session) -> list[dict]:
    """Consumo do NOSSO lado (analysis_logs já persiste tokens/custo por chamada) —
    agregado por provider (gemini/openai/openrouter) nos últimos 7 dias."""
    rows = db.execute(text("""
        SELECT
            COALESCE(provider, '—') AS provider,
            COUNT(*) FILTER (WHERE status = 'ok')    AS calls_ok,
            COUNT(*) FILTER (WHERE status = 'error') AS calls_error,
            COALESCE(SUM(tokens_in)  FILTER (WHERE status='ok'), 0)
                + COALESCE(SUM(tokens_out) FILTER (WHERE status='ok'), 0) AS tokens_total,
            COALESCE(SUM(cost_usd) FILTER (WHERE status='ok'), 0) AS cost_usd
        FROM analysis_logs
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY provider
        ORDER BY cost_usd DESC, calls_ok DESC
    """)).fetchall()
    return [
        {
            "provider": r[0],
            "calls_ok": int(r[1] or 0),
            "calls_error": int(r[2] or 0),
            "tokens_total": int(r[3] or 0),
            "cost_usd": float(r[4] or 0),
        }
        for r in rows
    ]


def _run_llm_chain_test(db: Session) -> dict:
    """Percorre a CADEIA INTEIRA (mesma _get_provider_chain da produção) testando
    cada provider individualmente — não usa _call_llm (que para no 1º sucesso)."""
    cfg = _get_config(db)
    chain = _get_provider_chain(cfg)

    providers_result = []
    any_ok = False
    for p in chain:
        t0 = time.time()
        try:
            if p["type"] == "gemini":
                _test_call_gemini(p["key"], p["model"], LLM_TEST_PROMPT)
            elif p["type"] == "openai":
                _test_call_openai(p["key"], p["model"], LLM_TEST_PROMPT)
            else:
                _test_call_openrouter(p["key"], p["model"], LLM_TEST_PROMPT)
            providers_result.append({
                "label": p["label"], "ok": True,
                "latency_ms": int((time.time() - t0) * 1000), "error": None,
            })
            any_ok = True
        except Exception as e:
            providers_result.append({
                "label": p["label"], "ok": False,
                "latency_ms": int((time.time() - t0) * 1000), "error": str(e)[:200],
            })

    return {
        "tested_at": _utcnow().isoformat(),
        "providers": providers_result,
        "any_ok": any_ok,
        "openrouter_credits": _get_openrouter_credits(cfg.get("openrouter_key", "")),
        "consumption_7d": _get_llm_consumption_7d(db),
    }


def get_llm_health(db: Session, force: bool = False) -> dict:
    """Wrapper cache-aware (Redis, 5min) — usado pelo endpoint admin E pelo
    relatório diário do Telegram. `force=True` ignora o cache (não usado hoje,
    reservado pra uso futuro)."""
    r = _redis_for_progress()
    if r and not force:
        try:
            cached = r.get(LLM_TEST_CACHE_KEY)
            if cached:
                data = json.loads(cached)
                data["cached"] = True
                return data
        except Exception:
            pass

    result = _run_llm_chain_test(db)
    result["cached"] = False

    if r:
        try:
            r.setex(LLM_TEST_CACHE_KEY, LLM_TEST_CACHE_TTL, json.dumps(result))
        except Exception:
            pass

    return result


@router.post("/admin/llm/test")
def test_llm_providers(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Testa a cadeia INTEIRA de providers LLM individualmente (prompt mínimo,
    timeout curto). Cacheado 5min pra não gastar quota clicando repetido."""
    return get_llm_health(db)


# ─── Custos & Consumo LLM (dashboard admin) ───────────────────────────────────
# GET /admin/llm/costs — série diária + KPIs + quebra por trigger/modelo, tudo
# lido de analysis_logs. Datas exibidas em BRT (banco grava UTC via _utcnow()).
# ⚠️ created_at é TIMESTAMP naive representando UTC — conversão pra BRT correta
# exige o encadeamento "AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'"
# (uma conversão só, como o by_day de /admin/analysis/stats faz, SOMA 3h em vez
# de subtrair — bug pré-existente daquele endpoint, não usado aqui).
_BRT_EXPR = "(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')"

TRIGGER_LABELS = {
    "manual":    "Análise (manual)",
    "auto":      "Análise (auto)",
    "pre_match": "Análise (pré-jogo)",
    "oracle":    "Oráculo",
    "h2h":       "H2H",
}


def _get_llm_daily_budget(db: Session) -> float:
    try:
        row = db.execute(
            text("SELECT value FROM site_config WHERE key = 'llm_daily_budget_usd'")
        ).fetchone()
        if row and row[0]:
            return float(row[0])
    except Exception:
        pass
    return LLM_DAILY_BUDGET_DEFAULT_USD


@router.get("/admin/llm/costs")
def llm_costs(days: int = 30, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Dashboard de custos LLM — KPIs (hoje/7d/30d/projeção mensal), série diária
    (14 dias, BRT, dias sem custo aparecem como zero), quebra por trigger e por
    modelo no período pedido, e aviso de orçamento (llm_daily_budget_usd, default
    US$1,50). Cada bloco isolado em try/except — analysis_logs pode estar vazia."""
    days = max(1, min(days, 90))
    budget_limit = _get_llm_daily_budget(db)

    # ── KPIs (hoje BRT / 7d / 30d) ────────────────────────────────────────────
    kpis = {"cost_today": 0.0, "cost_7d": 0.0, "cost_30d": 0.0}
    try:
        row = db.execute(text(f"""
            SELECT
                COALESCE(SUM(cost_usd) FILTER (
                    WHERE status = 'ok'
                      AND DATE({_BRT_EXPR}) = DATE(NOW() AT TIME ZONE 'America/Sao_Paulo')
                ), 0) AS cost_today,
                COALESCE(SUM(cost_usd) FILTER (WHERE status = 'ok' AND created_at >= NOW() - INTERVAL '7 days'), 0) AS cost_7d,
                COALESCE(SUM(cost_usd) FILTER (WHERE status = 'ok' AND created_at >= NOW() - INTERVAL '30 days'), 0) AS cost_30d
            FROM analysis_logs
        """)).fetchone()
        kpis = {
            "cost_today": float(row[0] or 0),
            "cost_7d":    float(row[1] or 0),
            "cost_30d":   float(row[2] or 0),
        }
    except Exception as e:
        print(f"[llm_costs] KPIs falharam (analysis_logs vazia/ausente?): {e}", flush=True)

    # Projeção mensal: ritmo atual (média diária dos últimos 7 dias) × 30 —
    # mais sensível a mudança recente de uso que a média dos 30 dias inteiros.
    avg_daily_7d = kpis["cost_7d"] / 7
    monthly_projection = round(avg_daily_7d * 30, 4)

    over_budget_pct = round((kpis["cost_today"] / budget_limit) * 100, 1) if budget_limit > 0 else 0.0
    budget_alert = over_budget_pct >= 80

    # ── Série diária (14 dias, BRT, zero-fill) ────────────────────────────────
    daily = []
    try:
        rows = db.execute(text(f"""
            WITH days AS (
                SELECT generate_series(
                    (DATE(NOW() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '13 days')::date,
                    DATE(NOW() AT TIME ZONE 'America/Sao_Paulo')::date,
                    INTERVAL '1 day'
                )::date AS day
            ),
            agg AS (
                SELECT
                    DATE({_BRT_EXPR}) AS day,
                    COUNT(*) FILTER (WHERE status = 'ok')    AS calls_ok,
                    COUNT(*) FILTER (WHERE status = 'error') AS calls_error,
                    COALESCE(SUM(tokens_in)  FILTER (WHERE status = 'ok'), 0)
                        + COALESCE(SUM(tokens_out) FILTER (WHERE status = 'ok'), 0) AS tokens,
                    COALESCE(SUM(cost_usd) FILTER (WHERE status = 'ok'), 0) AS cost_usd
                FROM analysis_logs
                WHERE created_at >= NOW() - INTERVAL '15 days'
                GROUP BY 1
            )
            SELECT days.day, COALESCE(agg.calls_ok, 0), COALESCE(agg.calls_error, 0),
                   COALESCE(agg.tokens, 0), COALESCE(agg.cost_usd, 0)
            FROM days
            LEFT JOIN agg ON agg.day = days.day
            ORDER BY days.day ASC
        """)).fetchall()
        daily = [
            {
                "day": str(r[0]),
                "calls_ok": int(r[1] or 0),
                "calls_error": int(r[2] or 0),
                "tokens": int(r[3] or 0),
                "cost_usd": float(r[4] or 0),
            }
            for r in rows
        ]
    except Exception as e:
        print(f"[llm_costs] série diária falhou: {e}", flush=True)

    # ── Quebra por trigger (período `days`) ───────────────────────────────────
    by_trigger = []
    try:
        rows = db.execute(text("""
            SELECT
                COALESCE(trigger, 'manual') AS trig,
                COUNT(*) FILTER (WHERE status = 'ok')    AS calls_ok,
                COUNT(*) FILTER (WHERE status = 'error') AS calls_error,
                COALESCE(SUM(tokens_in)  FILTER (WHERE status = 'ok'), 0)
                    + COALESCE(SUM(tokens_out) FILTER (WHERE status = 'ok'), 0) AS tokens,
                COALESCE(SUM(cost_usd) FILTER (WHERE status = 'ok'), 0) AS cost_usd
            FROM analysis_logs
            WHERE created_at >= NOW() - (:days || ' days')::interval
            GROUP BY 1
            ORDER BY cost_usd DESC, calls_ok DESC
        """), {"days": days}).fetchall()
        by_trigger = [
            {
                "trigger": r[0],
                "label": TRIGGER_LABELS.get(r[0], r[0]),
                "calls_ok": int(r[1] or 0),
                "calls_error": int(r[2] or 0),
                "tokens": int(r[3] or 0),
                "cost_usd": float(r[4] or 0),
            }
            for r in rows
        ]
    except Exception as e:
        print(f"[llm_costs] quebra por trigger falhou: {e}", flush=True)

    # ── Quebra por modelo (período `days`) ────────────────────────────────────
    by_model = []
    try:
        rows = db.execute(text("""
            SELECT
                COALESCE(model_used, '—') AS model,
                COALESCE(provider, '—')   AS provider,
                COUNT(*) FILTER (WHERE status = 'ok')    AS calls_ok,
                COUNT(*) FILTER (WHERE status = 'error') AS calls_error,
                COALESCE(SUM(tokens_in)  FILTER (WHERE status = 'ok'), 0)
                    + COALESCE(SUM(tokens_out) FILTER (WHERE status = 'ok'), 0) AS tokens,
                COALESCE(SUM(cost_usd) FILTER (WHERE status = 'ok'), 0) AS cost_usd
            FROM analysis_logs
            WHERE created_at >= NOW() - (:days || ' days')::interval
            GROUP BY 1, 2
            ORDER BY cost_usd DESC, calls_ok DESC
        """), {"days": days}).fetchall()
        by_model = [
            {
                "model": r[0],
                "provider": r[1],
                "calls_ok": int(r[2] or 0),
                "calls_error": int(r[3] or 0),
                "tokens": int(r[4] or 0),
                "cost_usd": float(r[5] or 0),
            }
            for r in rows
        ]
    except Exception as e:
        print(f"[llm_costs] quebra por modelo falhou: {e}", flush=True)

    return {
        "days": days,
        "kpis": {
            "cost_today_usd": round(kpis["cost_today"], 4),
            "cost_7d_usd":    round(kpis["cost_7d"], 4),
            "cost_30d_usd":   round(kpis["cost_30d"], 4),
            "monthly_projection_usd": monthly_projection,
        },
        "budget": {
            "limit_usd": budget_limit,
            "spent_today_usd": round(kpis["cost_today"], 4),
            "pct_used": over_budget_pct,
            "alert": budget_alert,
        },
        "daily": daily,
        "by_trigger": by_trigger,
        "by_model": by_model,
    }
