"""
Bot Telegram interativo — menus gerenciais em formato de cards, consultáveis sob demanda.

Webhook: POST /telegram/webhook   (chamado pelo Telegram)
Admin:   POST /admin/telegram/setup-webhook | GET /admin/telegram/webhook-info

Segurança:
- Header secreto X-Telegram-Bot-Api-Secret-Token validado contra site_config.
- Só responde aos chat_id autorizados (telegram_chat_id, vírgula-separável).
O bot é de consulta: /start ou /menu abre o menu; botões editam a mensagem (card
por card, grade 2 colunas). Navegação usa editMessageText — só manda mensagem
nova se o edit falhar por outro motivo que não "conteúdo idêntico".
"""

import secrets as _secrets
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from config import settings
from auth_utils import require_admin
from models import User, SiteConfig
from routers.report import (
    _telegram_config, _now_utc, _today_utc, _build_report, _format_text,
)

router = APIRouter(tags=["telegram"])
_FRONTEND_URL = "https://predicts.info"
_SEP = "─────────────"


# ── Config helpers ────────────────────────────────────────────────────────────
def _get_cfg(db: Session, key: str) -> str:
    row = db.query(SiteConfig).filter(SiteConfig.key == key).first()
    return (row.value if row else "") or ""


def _set_cfg(db: Session, key: str, value: str):
    row = db.query(SiteConfig).filter(SiteConfig.key == key).first()
    if row:
        row.value = value
    else:
        db.add(SiteConfig(key=key, value=value))
    db.commit()


def _allowed_chats(db: Session) -> set[str]:
    _, chat = _telegram_config(db)
    extra = _get_cfg(db, "telegram_allowed_chats")
    raw = ",".join(x for x in [chat, extra] if x)
    return {c.strip() for c in raw.split(",") if c.strip()}


# ── Fuso: banco em UTC, exibição sempre em Brasília (UTC-3) ──────────────────────
def _now_brt() -> datetime:
    return _now_utc() - timedelta(hours=3)


def _brt_today_start_utc() -> datetime:
    """Timestamp UTC correspondente à meia-noite de HOJE em Brasília — usado
    pra filtrar 'hoje' em queries sobre colunas created_at (UTC)."""
    brt_midnight = _now_brt().replace(hour=0, minute=0, second=0, microsecond=0)
    return brt_midnight + timedelta(hours=3)


def _footer_brt() -> str:
    return _now_brt().strftime("🕐 %d/%m %H:%M") + "h (Brasília)"


def _usd(v) -> str:
    v = float(v or 0)
    if v == 0:
        return "US$ 0.00"
    if v < 0.01:
        return f"US$ {v:.4f}"
    return f"US$ {v:.2f}"


# ── Card ──────────────────────────────────────────────────────────────────────
def _card(emoji: str, title: str, body: list[str]) -> str:
    """Monta o card padrão: cabeçalho (emoji + título em negrito), separador,
    corpo, separador, rodapé com timestamp BRT."""
    parts = [f"{emoji} <b>{title}</b>", _SEP, ""]
    parts += body
    parts += ["", _SEP, _footer_brt()]
    return "\n".join(parts)


# ── Telegram API ────────────────────────────────────────────────────────────────
async def _tg(token: str, method: str, payload: dict) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(url, json=payload)
    return r.json() if r.content else {}


async def _edit_or_send(token: str, chat_id: str, message_id: int, html: str, kb: dict):
    """Edita a mensagem existente (menos poluição no chat). Se o edit falhar
    por motivo real (mensagem antiga demais, apagada etc.) cai pra sendMessage.
    'message is not modified' (conteúdo idêntico, ex.: refresh no mesmo minuto
    sem mudança de dado) é tratado como sucesso silencioso, não gera mensagem nova."""
    res = await _tg(token, "editMessageText", {
        "chat_id": chat_id, "message_id": message_id,
        "text": html, "parse_mode": "HTML",
        "disable_web_page_preview": True, "reply_markup": kb,
    })
    if res.get("ok"):
        return
    desc = (res.get("description") or "").lower()
    if "message is not modified" in desc:
        return
    await _tg(token, "sendMessage", {
        "chat_id": chat_id, "text": html, "parse_mode": "HTML",
        "disable_web_page_preview": True, "reply_markup": kb,
    })


def _menu_kb() -> dict:
    return {"inline_keyboard": [
        [{"text": "👥 Usuários", "callback_data": "u"}, {"text": "📈 Acessos", "callback_data": "a"}],
        [{"text": "🔐 Logins", "callback_data": "l"}, {"text": "🎯 Apostas", "callback_data": "b"}],
        [{"text": "🏆 Ranking", "callback_data": "r"}, {"text": "🌍 Geografia", "callback_data": "g"}],
        [{"text": "📱 Dispositivos", "callback_data": "d"}, {"text": "🔮 Oráculo IA", "callback_data": "o"}],
        [{"text": "🧠 LLM / IA", "callback_data": "il"}, {"text": "💰 Custos", "callback_data": "ic"}],
        [{"text": "📊 Resumo completo", "callback_data": "f"}, {"text": "🔄 Atualizar", "callback_data": "m"}],
    ]}


def _nav_kb(code: str) -> dict:
    """Grade 2 colunas: atualizar a mesma tela (reusa o código) + voltar ao menu."""
    return {"inline_keyboard": [
        [{"text": "🔄 Atualizar", "callback_data": code}, {"text": "⬅️ Menu", "callback_data": "m"}],
    ]}


# ── Queries gerenciais ──────────────────────────────────────────────────────────
def _scalar(db, sql, **p):
    return db.execute(text(sql), p).scalar() or 0


def _periods():
    today = _today_utc()
    return today, today - timedelta(days=7), today - timedelta(days=30)


def _sec_users(db) -> tuple[str, str, list[str]]:
    today, week, month = _periods()
    total = _scalar(db, "SELECT COUNT(*) FROM users")
    n_today = _scalar(db, "SELECT COUNT(*) FROM users WHERE created_at >= :d", d=today)
    n_week = _scalar(db, "SELECT COUNT(*) FROM users WHERE created_at >= :d", d=week)
    n_month = _scalar(db, "SELECT COUNT(*) FROM users WHERE created_at >= :d", d=month)
    logged_today = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM page_views WHERE user_id IS NOT NULL AND created_at >= :d", d=today)
    bettors = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM bets")
    never = total - bettors
    lines = [
        f"• Total cadastrados: <b>{total}</b>",
        f"• Novos hoje: <b>{n_today}</b>",
        f"• Novos 7 dias: <b>{n_week}</b>",
        f"• Novos 30 dias: <b>{n_month}</b>",
        f"• Ativos logados hoje: <b>{logged_today}</b>",
        f"• Já apostaram: <b>{bettors}</b> · Nunca: <b>{never}</b>",
    ]
    return "👥", "USUÁRIOS", lines


def _sec_access(db) -> tuple[str, str, list[str]]:
    today, week, _m = _periods()
    vt = _scalar(db, "SELECT COUNT(*) FROM page_views WHERE created_at >= :d", d=today)
    ut = _scalar(db, "SELECT COUNT(DISTINCT ip) FROM page_views WHERE created_at >= :d", d=today)
    vw = _scalar(db, "SELECT COUNT(*) FROM page_views WHERE created_at >= :d", d=week)
    uw = _scalar(db, "SELECT COUNT(DISTINCT ip) FROM page_views WHERE created_at >= :d", d=week)
    logged_t = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM page_views WHERE user_id IS NOT NULL AND created_at >= :d", d=today)
    lines = [
        f"• Hoje: <b>{vt}</b> views · <b>{ut}</b> visitantes únicos",
        f"• 7 dias: <b>{vw}</b> views · <b>{uw}</b> únicos",
        f"• Logados únicos hoje: <b>{logged_t}</b>",
    ]
    return "📈", "ACESSOS", lines


def _sec_logins(db) -> tuple[str, str, list[str]]:
    today, week, month = _periods()
    has_audit = _scalar(db, "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='audit_logs'")
    if not has_audit:
        return "🔐", "LOGINS", ["Sem dados de auditoria."]
    lt = _scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='login' AND created_at >= :d", d=today)
    ut = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE action='login' AND created_at >= :d", d=today)
    lw = _scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='login' AND created_at >= :d", d=week)
    uw = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE action='login' AND created_at >= :d", d=week)
    lm = _scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='login' AND created_at >= :d", d=month)
    lines = [
        f"• Hoje: <b>{lt}</b> logins · <b>{ut}</b> usuários distintos",
        f"• 7 dias: <b>{lw}</b> logins · <b>{uw}</b> distintos",
        f"• 30 dias: <b>{lm}</b> logins",
    ]
    return "🔐", "LOGINS", lines


def _sec_bets(db) -> tuple[str, str, list[str]]:
    today, week, _m = _periods()
    total = _scalar(db, "SELECT COUNT(*) FROM bets")
    bt = _scalar(db, "SELECT COUNT(*) FROM bets WHERE created_at >= :d", d=today)
    pt = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM bets WHERE created_at >= :d", d=today)
    bw = _scalar(db, "SELECT COUNT(*) FROM bets WHERE created_at >= :d", d=week)
    pw = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM bets WHERE created_at >= :d", d=week)
    lines = [
        f"• Total geral: <b>{total}</b>",
        f"• Hoje: <b>{bt}</b> · <b>{pt}</b> apostadores",
        f"• 7 dias: <b>{bw}</b> · <b>{pw}</b> apostadores",
    ]
    return "🎯", "APOSTAS", lines


def _sec_ranking(db) -> tuple[str, str, list[str]]:
    from html import escape as e
    rows = db.execute(text("""
        SELECT u.name, r.total_points AS pts, r.exact_scores AS ex
        FROM rankings r JOIN users u ON u.id = r.user_id
        ORDER BY r.total_points DESC, r.exact_scores DESC LIMIT 10
    """)).fetchall()
    medals = ["🥇", "🥈", "🥉"]
    if not rows:
        return "🏆", "RANKING GERAL — TOP 10", ["Sem dados."]
    lines = []
    for i, r in enumerate(rows):
        m = medals[i] if i < 3 else f"{i+1}."
        lines.append(f"{m} {e(r.name)} — <b>{r.pts} pts</b> ({r.ex} exatos)")
    return "🏆", "RANKING GERAL — TOP 10", lines


def _sec_geo(db) -> tuple[str, str, list[str]]:
    from html import escape as e
    _, week, _m = _periods()
    countries = db.execute(text("""
        SELECT COALESCE(NULLIF(country_name,''), country, '??') AS c, COUNT(*) n
        FROM page_views WHERE created_at >= :d GROUP BY 1 ORDER BY n DESC LIMIT 6
    """), {"d": week}).fetchall()
    cities = db.execute(text("""
        SELECT COALESCE(NULLIF(city,''),'??') AS c, COUNT(*) n
        FROM page_views WHERE created_at >= :d GROUP BY 1 ORDER BY n DESC LIMIT 6
    """), {"d": week}).fetchall()
    lines = ["<b>Países</b>"]
    lines += [f"• {e(str(r.c))}: <b>{r.n}</b>" for r in countries] or ["• —"]
    lines += ["", "<b>Cidades</b>"]
    lines += [f"• {e(str(r.c))}: <b>{r.n}</b>" for r in cities] or ["• —"]
    return "🌍", "GEOGRAFIA (7 DIAS)", lines


def _sec_devices(db) -> tuple[str, str, list[str]]:
    from html import escape as e
    _, week, _m = _periods()

    def top(col):
        return db.execute(text(f"""
            SELECT COALESCE(NULLIF({col},''),'??') AS v, COUNT(*) n
            FROM page_views WHERE created_at >= :d GROUP BY 1 ORDER BY n DESC LIMIT 5
        """), {"d": week}).fetchall()

    lines = ["<b>Tipo</b>"]
    lines += [f"• {e(str(r.v))}: <b>{r.n}</b>" for r in top("device")] or ["• —"]
    lines += ["", "<b>Navegador</b>"]
    lines += [f"• {e(str(r.v))}: <b>{r.n}</b>" for r in top("browser")] or ["• —"]
    lines += ["", "<b>Sistema</b>"]
    lines += [f"• {e(str(r.v))}: <b>{r.n}</b>" for r in top("os")] or ["• —"]
    return "📱", "DISPOSITIVOS (7 DIAS)", lines


def _sec_oracle(db) -> tuple[str, str, list[str]]:
    from html import escape as e
    rows = db.execute(text("""
        SELECT action, new_a, new_b, source, confidence, reason, created_at,
               meta->>'team_a'              AS ta,
               meta->>'team_b'              AS tb,
               (meta->'baseline'->>0)       AS ba,
               (meta->'baseline'->>1)       AS bb
        FROM bot_decision_logs
        ORDER BY created_at DESC
        LIMIT 6
    """)).fetchall()
    if not rows:
        return "🔮", "ORÁCULO PREDICTOR", [
            "Nenhuma re-análise registrada ainda.",
            "A IA reavalia cada jogo ~1h antes do apito.",
        ]
    act = {"changed": "🔁", "created": "🆕", "kept": "✅", "skipped": "⏭"}
    lines = []
    for i, r in enumerate(rows):
        ico = act.get(r.action, "•")
        base = f"{r.ba}×{r.bb}" if r.ba is not None else "—"
        final = f"{r.new_a}×{r.new_b}"
        overrode = (str(r.ba), str(r.bb)) != (str(r.new_a), str(r.new_b))
        tag = " 🔥" if overrode else ""
        conf = f" · {r.confidence}%" if r.confidence is not None else ""
        if i:
            lines.append("")
        lines.append(f"{ico} <b>{e(str(r.ta or '?'))}×{e(str(r.tb or '?'))}</b> — "
                      f"Modelo {base} → IA <b>{final}</b>{tag}{conf}")
        if r.reason:
            lines.append(f"<i>{e(r.reason[:240])}</i>")
    return "🔮", "ORÁCULO PREDICTOR — ÚLTIMAS ANÁLISES", lines


# ── LLM / IA (saúde da cadeia + consumo) ─────────────────────────────────────────
def _llm_consumption(db, since) -> list[dict]:
    """Chamadas ok/erro, tokens totais e custo USD por provider, desde `since`.
    Tabela analysis_logs pode estar vazia/ausente — sempre try/except."""
    try:
        rows = db.execute(text("""
            SELECT COALESCE(provider, '—') AS provider,
                   COUNT(*) FILTER (WHERE status = 'ok')    AS calls_ok,
                   COUNT(*) FILTER (WHERE status = 'error') AS calls_err,
                   COALESCE(SUM(tokens_in)  FILTER (WHERE status='ok'), 0)
                       + COALESCE(SUM(tokens_out) FILTER (WHERE status='ok'), 0) AS tokens,
                   COALESCE(SUM(cost_usd) FILTER (WHERE status='ok'), 0) AS cost
            FROM analysis_logs
            WHERE created_at >= :d
            GROUP BY 1
            ORDER BY cost DESC, calls_ok DESC
        """), {"d": since}).fetchall()
        return [
            {"provider": r[0], "calls_ok": int(r[1] or 0), "calls_err": int(r[2] or 0),
             "tokens": int(r[3] or 0), "cost": float(r[4] or 0)}
            for r in rows
        ]
    except Exception:
        return []


def _sec_llm(db) -> tuple[str, str, list[str]]:
    from html import escape as e

    try:
        from routers.analysis import get_llm_health
        health = get_llm_health(db)
    except Exception as ex:
        return "🧠", "LLM / INTELIGÊNCIA ARTIFICIAL", [f"⚠️ erro ao consultar saúde da IA: {e(str(ex)[:200])}"]

    lines: list[str] = []

    if health.get("error"):
        lines.append(f"⚠️ {e(str(health['error'])[:200])}")
        return "🧠", "LLM / INTELIGÊNCIA ARTIFICIAL", lines

    providers = health.get("providers") or []
    lines.append("<b>Provedores</b>")
    if providers:
        for p in providers:
            ico = "✓" if p.get("ok") else "✗"
            lat = f" · {p['latency_ms']}ms" if p.get("latency_ms") is not None else ""
            err = f" — {e(str(p['error'])[:80])}" if not p.get("ok") and p.get("error") else ""
            lines.append(f"{ico} {e(str(p.get('label', '?')))}{lat}{err}")
    else:
        lines.append("⚠️ nenhum provider configurado")
    if health.get("cached"):
        lines.append("<i>(dado em cache, até 5min)</i>")

    lines.append("")
    lines.append("<b>Créditos OpenRouter</b>")
    cred = health.get("openrouter_credits")
    if cred is None:
        lines.append("• sem chave OpenRouter configurada")
    elif cred.get("error"):
        lines.append(f"• ⚠️ erro: {e(str(cred['error'])[:100])}")
    else:
        total = cred.get("total_credits", 0) or 0
        used = cred.get("total_usage", 0) or 0
        rem = cred.get("remaining", 0) or 0
        lines.append(f"• Total: <b>${total:.2f}</b> · Usado: <b>${used:.2f}</b> · Restante: <b>${rem:.2f}</b>")

    today_rows = _llm_consumption(db, _brt_today_start_utc())
    week_rows = _llm_consumption(db, _now_utc() - timedelta(days=7))

    lines.append("")
    lines.append("<b>Consumo hoje</b> (BRT, desde 00:00)")
    if today_rows:
        for r in today_rows:
            lines.append(f"• {e(r['provider'])}: {r['calls_ok']} ok / {r['calls_err']} erro · "
                          f"{r['tokens']} tokens · {_usd(r['cost'])}")
    else:
        lines.append("• sem chamadas hoje")

    lines.append("")
    lines.append("<b>Consumo 7 dias</b>")
    if week_rows:
        for r in week_rows:
            lines.append(f"• {e(r['provider'])}: {r['calls_ok']} ok / {r['calls_err']} erro · "
                          f"{r['tokens']} tokens · {_usd(r['cost'])}")
    else:
        lines.append("• sem chamadas nos últimos 7 dias")

    return "🧠", "LLM / INTELIGÊNCIA ARTIFICIAL", lines


# ── Custos (financeiro) ──────────────────────────────────────────────────────────
_TRIGGER_LABELS = {
    "auto": "Análise", "manual": "Análise", "pre_match": "Análise",
    "oracle": "Oráculo", "h2h": "H2H",
}


def _sec_costs(db) -> tuple[str, str, list[str]]:
    from html import escape as e

    since_8d = _now_utc() - timedelta(days=8)
    lines: list[str] = []

    try:
        daily = db.execute(text("""
            SELECT (created_at - interval '3 hours')::date AS dia,
                   COALESCE(SUM(cost_usd) FILTER (WHERE status='ok'), 0) AS custo,
                   COUNT(*) FILTER (WHERE status='ok') AS chamadas
            FROM analysis_logs
            WHERE created_at >= :d
            GROUP BY 1
            ORDER BY 1 DESC
            LIMIT 7
        """), {"d": since_8d}).fetchall()
    except Exception as ex:
        return "💰", "CUSTOS DE IA", [f"⚠️ erro ao consultar custos: {e(str(ex)[:200])}"]

    today_date = _now_brt().date()
    yesterday_date = today_date - timedelta(days=1)

    lines.append("<b>Consumo por dia</b> (últimos 7 dias, BRT)")
    total_7d = 0.0
    if daily:
        for r in daily:
            dia, custo, chamadas = r[0], float(r[1] or 0), int(r[2] or 0)
            total_7d += custo
            if dia == today_date:
                label = "Hoje"
            elif dia == yesterday_date:
                label = "Ontem"
            else:
                label = dia.strftime("%d/%m")
            lines.append(f"• {label}: {_usd(custo)} · {chamadas} {'chamada' if chamadas == 1 else 'chamadas'}")
    else:
        lines.append("• sem dados no período")

    try:
        by_trigger = db.execute(text("""
            SELECT COALESCE(trigger, 'manual') AS trig,
                   COALESCE(SUM(cost_usd) FILTER (WHERE status='ok'), 0) AS custo,
                   COUNT(*) FILTER (WHERE status='ok') AS chamadas
            FROM analysis_logs
            WHERE created_at >= :d
            GROUP BY 1
        """), {"d": since_8d}).fetchall()
    except Exception:
        by_trigger = []

    # agrupa em analysis/oracle/h2h/outros (dá pra ter mais de 1 trigger cru por categoria)
    grouped: dict[str, dict] = {}
    for r in by_trigger:
        cat = _TRIGGER_LABELS.get(r[0], r[0] or "—")
        g = grouped.setdefault(cat, {"custo": 0.0, "chamadas": 0})
        g["custo"] += float(r[1] or 0)
        g["chamadas"] += int(r[2] or 0)

    lines.append("")
    lines.append("<b>Custo por tipo</b> (7 dias)")
    if grouped:
        for cat, g in sorted(grouped.items(), key=lambda kv: -kv[1]["custo"]):
            n = g["chamadas"]
            lines.append(f"• {e(cat)}: {_usd(g['custo'])} · {n} {'chamada' if n == 1 else 'chamadas'}")
    else:
        lines.append("• sem dados no período")

    proj = (total_7d / 7 * 30) if total_7d else 0.0
    lines.append("")
    lines.append("<b>Projeção mensal</b>")
    lines.append(f"• Média diária × 30 ≈ <b>{_usd(proj)}</b>")

    return "💰", "CUSTOS DE IA", lines


_RENDERERS = {
    "u": _sec_users, "a": _sec_access, "l": _sec_logins, "b": _sec_bets,
    "r": _sec_ranking, "g": _sec_geo, "d": _sec_devices, "o": _sec_oracle,
    "il": _sec_llm, "ic": _sec_costs,
}


def _render(db: Session, data: str) -> tuple[str, dict]:
    if data == "f":
        return _format_text(_build_report(db)), _nav_kb("f")
    fn = _RENDERERS.get(data)
    if fn:
        emoji, title, body = fn(db)
        return _card(emoji, title, body), _nav_kb(data)
    # menu (m) ou desconhecido
    return _card("🤖", "PREDICTS — PAINEL GERENCIAL", ["Escolha uma consulta abaixo 👇"]), _menu_kb()


# ── Webhook ─────────────────────────────────────────────────────────────────────
@router.post("/telegram/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)):
    # Fail-closed: sem secret configurado o webhook fica fechado (não aceita POST
    # anônimo). Configurar via POST /admin/telegram/setup-webhook.
    secret = _get_cfg(db, "telegram_webhook_secret")
    if not secret or request.headers.get("X-Telegram-Bot-Api-Secret-Token") != secret:
        return {"ok": False}

    token, _chat = _telegram_config(db)
    if not token:
        return {"ok": False}

    try:
        update = await request.json()
    except Exception:
        return {"ok": False}

    allowed = _allowed_chats(db)
    msg = update.get("message") or update.get("edited_message")
    cq = update.get("callback_query")

    if cq:
        chat_id = str(cq["message"]["chat"]["id"])
        await _tg(token, "answerCallbackQuery", {"callback_query_id": cq["id"]})
        if allowed and chat_id not in allowed:
            return {"ok": True}
        html, kb = _render(db, cq.get("data") or "m")
        await _edit_or_send(token, chat_id, cq["message"]["message_id"], html, kb)
        return {"ok": True}

    if msg:
        chat_id = str(msg["chat"]["id"])
        if allowed and chat_id not in allowed:
            await _tg(token, "sendMessage", {
                "chat_id": chat_id,
                "text": "🚫 Acesso restrito. Este painel é privado.",
            })
            return {"ok": True}
        html, kb = _render(db, "m")
        await _tg(token, "sendMessage", {
            "chat_id": chat_id, "text": html, "parse_mode": "HTML",
            "disable_web_page_preview": True, "reply_markup": kb,
        })
    return {"ok": True}


# ── Admin: setup do webhook ───────────────────────────────────────────────────────
@router.post("/admin/telegram/setup-webhook")
async def setup_webhook(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    token, _chat = _telegram_config(db)
    if not token:
        return {"ok": False, "reason": "telegram_not_configured"}
    secret = _get_cfg(db, "telegram_webhook_secret")
    if not secret:
        secret = _secrets.token_urlsafe(32)
        _set_cfg(db, "telegram_webhook_secret", secret)
    res = await _tg(token, "setWebhook", {
        "url": f"{_FRONTEND_URL}/api/telegram/webhook",
        "secret_token": secret,
        "allowed_updates": ["message", "callback_query"],
        "drop_pending_updates": True,
    })
    # registra comandos do bot (autocomplete)
    await _tg(token, "setMyCommands", {"commands": [
        {"command": "menu", "description": "Abrir painel gerencial"},
        {"command": "start", "description": "Iniciar"},
    ]})
    return {"ok": res.get("ok", False), "telegram": res}


@router.get("/admin/telegram/webhook-info")
async def webhook_info(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    token, _chat = _telegram_config(db)
    if not token:
        return {"ok": False, "reason": "telegram_not_configured"}
    return await _tg(token, "getWebhookInfo", {})
