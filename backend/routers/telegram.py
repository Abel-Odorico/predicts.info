"""
Bot Telegram interativo — menus gerenciais consultáveis sob demanda.

Webhook: POST /telegram/webhook   (chamado pelo Telegram)
Admin:   POST /admin/telegram/setup-webhook | GET /admin/telegram/webhook-info

Segurança:
- Header secreto X-Telegram-Bot-Api-Secret-Token validado contra site_config.
- Só responde aos chat_id autorizados (telegram_chat_id, vírgula-separável).
O bot é de consulta: /start ou /menu abre o menu; botões editam a mensagem.
"""

import secrets as _secrets
from datetime import timedelta

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


# ── Telegram API ────────────────────────────────────────────────────────────────
async def _tg(token: str, method: str, payload: dict) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(url, json=payload)
    return r.json() if r.content else {}


def _menu_kb() -> dict:
    return {"inline_keyboard": [
        [{"text": "👥 Usuários", "callback_data": "u"}, {"text": "📈 Acessos", "callback_data": "a"}],
        [{"text": "🔐 Logins", "callback_data": "l"}, {"text": "🎯 Apostas", "callback_data": "b"}],
        [{"text": "🏆 Ranking", "callback_data": "r"}, {"text": "🌍 Geografia", "callback_data": "g"}],
        [{"text": "📱 Dispositivos", "callback_data": "d"}, {"text": "📊 Resumo completo", "callback_data": "f"}],
        [{"text": "🔄 Atualizar", "callback_data": "m"}],
    ]}


def _back_kb() -> dict:
    return {"inline_keyboard": [[{"text": "⬅️ Menu", "callback_data": "m"}]]}


# ── Queries gerenciais ──────────────────────────────────────────────────────────
def _scalar(db, sql, **p):
    return db.execute(text(sql), p).scalar() or 0


def _periods():
    today = _today_utc()
    return today, today - timedelta(days=7), today - timedelta(days=30)


def _sec_users(db) -> str:
    today, week, month = _periods()
    total = _scalar(db, "SELECT COUNT(*) FROM users")
    n_today = _scalar(db, "SELECT COUNT(*) FROM users WHERE created_at >= :d", d=today)
    n_week = _scalar(db, "SELECT COUNT(*) FROM users WHERE created_at >= :d", d=week)
    n_month = _scalar(db, "SELECT COUNT(*) FROM users WHERE created_at >= :d", d=month)
    logged_today = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM page_views WHERE user_id IS NOT NULL AND created_at >= :d", d=today)
    bettors = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM bets")
    never = total - bettors
    return (
        "👥 <b>USUÁRIOS</b>\n"
        f"• Total cadastrados: <b>{total}</b>\n"
        f"• Novos hoje: <b>{n_today}</b>\n"
        f"• Novos 7 dias: <b>{n_week}</b>\n"
        f"• Novos 30 dias: <b>{n_month}</b>\n"
        f"• Ativos logados hoje: <b>{logged_today}</b>\n"
        f"• Já apostaram: <b>{bettors}</b> · Nunca: <b>{never}</b>"
    )


def _sec_access(db) -> str:
    today, week, _ = _periods()
    vt = _scalar(db, "SELECT COUNT(*) FROM page_views WHERE created_at >= :d", d=today)
    ut = _scalar(db, "SELECT COUNT(DISTINCT ip) FROM page_views WHERE created_at >= :d", d=today)
    vw = _scalar(db, "SELECT COUNT(*) FROM page_views WHERE created_at >= :d", d=week)
    uw = _scalar(db, "SELECT COUNT(DISTINCT ip) FROM page_views WHERE created_at >= :d", d=week)
    logged_t = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM page_views WHERE user_id IS NOT NULL AND created_at >= :d", d=today)
    return (
        "📈 <b>ACESSOS</b>\n"
        f"• Hoje: <b>{vt}</b> views · <b>{ut}</b> visitantes únicos\n"
        f"• 7 dias: <b>{vw}</b> views · <b>{uw}</b> únicos\n"
        f"• Logados únicos hoje: <b>{logged_t}</b>"
    )


def _sec_logins(db) -> str:
    today, week, month = _periods()
    has_audit = _scalar(db, "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='audit_logs'")
    if not has_audit:
        return "🔐 <b>LOGINS</b>\nSem dados de auditoria."
    lt = _scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='login' AND created_at >= :d", d=today)
    ut = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE action='login' AND created_at >= :d", d=today)
    lw = _scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='login' AND created_at >= :d", d=week)
    uw = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE action='login' AND created_at >= :d", d=week)
    lm = _scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='login' AND created_at >= :d", d=month)
    return (
        "🔐 <b>LOGINS</b>\n"
        f"• Hoje: <b>{lt}</b> logins · <b>{ut}</b> usuários distintos\n"
        f"• 7 dias: <b>{lw}</b> logins · <b>{uw}</b> distintos\n"
        f"• 30 dias: <b>{lm}</b> logins"
    )


def _sec_bets(db) -> str:
    today, week, _ = _periods()
    total = _scalar(db, "SELECT COUNT(*) FROM bets")
    bt = _scalar(db, "SELECT COUNT(*) FROM bets WHERE created_at >= :d", d=today)
    pt = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM bets WHERE created_at >= :d", d=today)
    bw = _scalar(db, "SELECT COUNT(*) FROM bets WHERE created_at >= :d", d=week)
    pw = _scalar(db, "SELECT COUNT(DISTINCT user_id) FROM bets WHERE created_at >= :d", d=week)
    return (
        "🎯 <b>APOSTAS</b>\n"
        f"• Total geral: <b>{total}</b>\n"
        f"• Hoje: <b>{bt}</b> · <b>{pt}</b> apostadores\n"
        f"• 7 dias: <b>{bw}</b> · <b>{pw}</b> apostadores"
    )


def _sec_ranking(db) -> str:
    from html import escape as e
    rows = db.execute(text("""
        SELECT u.name, r.total_points AS pts, r.exact_scores AS ex
        FROM rankings r JOIN users u ON u.id = r.user_id
        ORDER BY r.total_points DESC, r.exact_scores DESC LIMIT 10
    """)).fetchall()
    medals = ["🥇", "🥈", "🥉"]
    out = ["🏆 <b>RANKING GERAL — Top 10</b>"]
    for i, r in enumerate(rows):
        m = medals[i] if i < 3 else f"{i+1}."
        out.append(f"{m} {e(r.name)} — <b>{r.pts} pts</b> ({r.ex} exatos)")
    return "\n".join(out) if rows else "🏆 <b>RANKING</b>\nSem dados."


def _sec_geo(db) -> str:
    from html import escape as e
    _, week, _ = _periods()
    countries = db.execute(text("""
        SELECT COALESCE(NULLIF(country_name,''), country, '??') AS c, COUNT(*) n
        FROM page_views WHERE created_at >= :d GROUP BY 1 ORDER BY n DESC LIMIT 6
    """), {"d": week}).fetchall()
    cities = db.execute(text("""
        SELECT COALESCE(NULLIF(city,''),'??') AS c, COUNT(*) n
        FROM page_views WHERE created_at >= :d GROUP BY 1 ORDER BY n DESC LIMIT 6
    """), {"d": week}).fetchall()
    out = ["🌍 <b>GEOGRAFIA (7 dias)</b>", "", "<b>Países</b>"]
    out += [f"• {e(str(r.c))}: <b>{r.n}</b>" for r in countries] or ["• —"]
    out += ["", "<b>Cidades</b>"]
    out += [f"• {e(str(r.c))}: <b>{r.n}</b>" for r in cities] or ["• —"]
    return "\n".join(out)


def _sec_devices(db) -> str:
    from html import escape as e
    _, week, _ = _periods()
    def top(col):
        return db.execute(text(f"""
            SELECT COALESCE(NULLIF({col},''),'??') AS v, COUNT(*) n
            FROM page_views WHERE created_at >= :d GROUP BY 1 ORDER BY n DESC LIMIT 5
        """), {"d": week}).fetchall()
    out = ["📱 <b>DISPOSITIVOS (7 dias)</b>", "", "<b>Tipo</b>"]
    out += [f"• {e(str(r.v))}: <b>{r.n}</b>" for r in top("device")] or ["• —"]
    out += ["", "<b>Navegador</b>"]
    out += [f"• {e(str(r.v))}: <b>{r.n}</b>" for r in top("browser")] or ["• —"]
    out += ["", "<b>Sistema</b>"]
    out += [f"• {e(str(r.v))}: <b>{r.n}</b>" for r in top("os")] or ["• —"]
    return "\n".join(out)


_RENDERERS = {
    "u": _sec_users, "a": _sec_access, "l": _sec_logins, "b": _sec_bets,
    "r": _sec_ranking, "g": _sec_geo, "d": _sec_devices,
}


def _render(db: Session, data: str) -> tuple[str, dict]:
    if data == "f":
        return _format_text(_build_report(db)), _back_kb()
    fn = _RENDERERS.get(data)
    if fn:
        return fn(db), _back_kb()
    # menu (m) ou desconhecido
    return ("🤖 <b>PREDICTS — Painel Gerencial</b>\n"
            "Escolha uma consulta abaixo:"), _menu_kb()


# ── Webhook ─────────────────────────────────────────────────────────────────────
@router.post("/telegram/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)):
    secret = _get_cfg(db, "telegram_webhook_secret")
    if secret and request.headers.get("X-Telegram-Bot-Api-Secret-Token") != secret:
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
        await _tg(token, "editMessageText", {
            "chat_id": chat_id, "message_id": cq["message"]["message_id"],
            "text": html, "parse_mode": "HTML",
            "disable_web_page_preview": True, "reply_markup": kb,
        })
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
