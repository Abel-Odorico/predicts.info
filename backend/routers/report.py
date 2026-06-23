"""
Relatório diário consolidado — para envio no Telegram ou cópia manual.
GET  /admin/daily-report          gera e retorna o texto do relatório
POST /admin/daily-report/send     envia via Telegram Bot API
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, text
import httpx

from database import get_db
from config import settings
from auth_utils import require_admin
from models import User, Bet, Match, MatchStatus, Ranking, PageView, SiteConfig


def _telegram_config(db: Session) -> tuple[str, str]:
    rows = {r.key: r.value for r in db.query(SiteConfig).filter(
        SiteConfig.key.in_(["telegram_bot_token", "telegram_chat_id"])
    ).all()}
    token   = rows.get("telegram_bot_token") or settings.telegram_bot_token
    chat_id = rows.get("telegram_chat_id")   or settings.telegram_chat_id
    return token, chat_id

router = APIRouter(prefix="/admin", tags=["admin"])

_BR = "America/Sao_Paulo"


def _now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _today_utc():
    n = _now_utc()
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


def _build_report(db: Session) -> dict:
    now = _now_utc()
    today = _today_utc()
    yesterday = today - timedelta(days=1)
    week_ago = today - timedelta(days=7)

    # ── Usuários ────────────────────────────────────────
    total_users = db.execute(text("SELECT COUNT(*) FROM users")).scalar() or 0
    new_today = db.execute(
        text("SELECT COUNT(*) FROM users WHERE created_at >= :d"), {"d": today}
    ).scalar() or 0
    new_week = db.execute(
        text("SELECT COUNT(*) FROM users WHERE created_at >= :d"), {"d": week_ago}
    ).scalar() or 0

    # ── Acessos (page_views) ────────────────────────────
    views_today = db.execute(
        text("SELECT COUNT(*) FROM page_views WHERE created_at >= :d"), {"d": today}
    ).scalar() or 0
    unique_today = db.execute(
        text("SELECT COUNT(DISTINCT ip) FROM page_views WHERE created_at >= :d"), {"d": today}
    ).scalar() or 0
    views_week = db.execute(
        text("SELECT COUNT(*) FROM page_views WHERE created_at >= :d"), {"d": week_ago}
    ).scalar() or 0
    unique_week = db.execute(
        text("SELECT COUNT(DISTINCT ip) FROM page_views WHERE created_at >= :d"), {"d": week_ago}
    ).scalar() or 0

    # ── Apostas ─────────────────────────────────────────
    total_bets = db.execute(text("SELECT COUNT(*) FROM bets")).scalar() or 0
    bets_today = db.execute(
        text("SELECT COUNT(*) FROM bets WHERE created_at >= :d"), {"d": today}
    ).scalar() or 0
    bettors_today = db.execute(
        text("SELECT COUNT(DISTINCT user_id) FROM bets WHERE created_at >= :d"), {"d": today}
    ).scalar() or 0
    bets_week = db.execute(
        text("SELECT COUNT(*) FROM bets WHERE created_at >= :d"), {"d": week_ago}
    ).scalar() or 0
    bettors_week = db.execute(
        text("SELECT COUNT(DISTINCT user_id) FROM bets WHERE created_at >= :d"), {"d": week_ago}
    ).scalar() or 0

    # ── Ranking geral (top 10) ──────────────────────────
    top_rows = db.execute(text("""
        SELECT u.name, r.total_points, r.exact_scores
        FROM rankings r
        JOIN users u ON u.id = r.user_id
        ORDER BY r.total_points DESC, r.exact_scores DESC
        LIMIT 10
    """)).fetchall()

    # ── Ranking do dia (pontos em apostas de hoje) ──────
    top_day_rows = db.execute(text("""
        SELECT u.name, SUM(b.points_earned) AS pts
        FROM bets b
        JOIN users u ON u.id = b.user_id
        WHERE b.created_at >= :d AND b.evaluated_at IS NOT NULL
        GROUP BY u.id, u.name
        ORDER BY pts DESC
        LIMIT 5
    """), {"d": today}).fetchall()

    # ── Próxima partida ─────────────────────────────────
    next_match = db.execute(text("""
        SELECT m.match_date, ta.name AS team_a, tb.name AS team_b,
               (SELECT COUNT(DISTINCT b.user_id) FROM bets b WHERE b.match_id = m.id) AS bettors
        FROM matches m
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        WHERE m.status = 'scheduled' AND m.match_date > :now
        ORDER BY m.match_date ASC
        LIMIT 1
    """), {"now": now}).fetchone()

    # ── Último resultado ─────────────────────────────────
    last_result = db.execute(text("""
        SELECT ta.name AS team_a, tb.name AS team_b,
               mr.score_a, mr.score_b
        FROM match_results mr
        JOIN matches m ON m.id = mr.match_id
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        ORDER BY m.match_date DESC
        LIMIT 1
    """)).fetchone()

    return {
        "generated_at": now.isoformat(),
        "users": {
            "total": total_users,
            "new_today": new_today,
            "new_week": new_week,
        },
        "views": {
            "today": views_today,
            "unique_today": unique_today,
            "week": views_week,
            "unique_week": unique_week,
        },
        "bets": {
            "total": total_bets,
            "today": bets_today,
            "bettors_today": bettors_today,
            "week": bets_week,
            "bettors_week": bettors_week,
        },
        "ranking_top10": [
            {"pos": i + 1, "name": r.name, "pts": r.total_points, "exact": r.exact_scores}
            for i, r in enumerate(top_rows)
        ],
        "ranking_day": [
            {"pos": i + 1, "name": r.name, "pts": r.pts}
            for i, r in enumerate(top_day_rows)
        ] if top_day_rows else [],
        "next_match": {
            "team_a": next_match.team_a,
            "team_b": next_match.team_b,
            "match_date": next_match.match_date.isoformat() if next_match.match_date else None,
            "bettors": next_match.bettors,
        } if next_match else None,
        "last_result": {
            "team_a": last_result.team_a,
            "team_b": last_result.team_b,
            "score": f"{last_result.score_a}x{last_result.score_b}",
        } if last_result else None,
    }


def _format_text(data: dict) -> str:
    from datetime import datetime
    from html import escape as _e

    dt = datetime.fromisoformat(data["generated_at"])
    br_str = dt.strftime("%d/%m/%Y às %H:%Mh (UTC)")

    u = data["users"]
    v = data["views"]
    b = data["bets"]

    MEDALS = ["🥇", "🥈", "🥉"]

    lines = [
        "📊 <b>PREDICTS — Relatório da Plataforma</b>",
        f"📅 {_e(br_str)}",
        "",
        "━━━━━━━━━━━━━━━━━",
        "👥 <b>USUÁRIOS</b>",
        f"• Total: <b>{u['total']}</b> cadastrados",
        f"• Novos hoje: <b>{u['new_today']}</b> | Semana: <b>{u['new_week']}</b>",
        "",
        "📈 <b>ACESSOS</b>",
        f"• Hoje: <b>{v['today']}</b> views · <b>{v['unique_today']}</b> únicos",
        f"• Semana: <b>{v['week']}</b> views · <b>{v['unique_week']}</b> únicos",
        "",
        "🎯 <b>APOSTAS</b>",
        f"• Total geral: <b>{b['total']}</b>",
        f"• Hoje: <b>{b['today']}</b> apostas · <b>{b['bettors_today']}</b> apostadores",
        f"• Semana: <b>{b['week']}</b> apostas · <b>{b['bettors_week']}</b> apostadores",
    ]

    # Último resultado
    lr = data.get("last_result")
    if lr:
        lines += ["", "⚽ <b>ÚLTIMO RESULTADO</b>", f"• {_e(lr['team_a'])} {_e(str(lr['score']))} {_e(lr['team_b'])}"]

    # Próxima partida
    nm = data.get("next_match")
    if nm:
        try:
            dt_match = datetime.fromisoformat(nm["match_date"])
            match_str = dt_match.strftime("%d/%m %H:%Mh UTC")
        except Exception:
            match_str = nm.get("match_date", "?")
        lines += [
            "",
            "📅 <b>PRÓXIMA PARTIDA</b>",
            f"• {_e(nm['team_a'])} × {_e(nm['team_b'])}",
            f"• {_e(match_str)} · {nm['bettors']} apostadores",
        ]

    # Ranking geral top 10
    lines += ["", "━━━━━━━━━━━━━━━━━", "🏆 <b>RANKING GERAL — Top 10</b>"]
    for r in data["ranking_top10"]:
        medal = MEDALS[r["pos"] - 1] if r["pos"] <= 3 else f"{r['pos']}."
        lines.append(f"{medal} {_e(r['name'])} — <b>{r['pts']} pts</b> ({r['exact']} exatos)")

    # Ranking do dia
    if data["ranking_day"]:
        lines += ["", "🌟 <b>DESTAQUE DO DIA</b>"]
        for r in data["ranking_day"]:
            medal = MEDALS[r["pos"] - 1] if r["pos"] <= 3 else f"{r['pos']}."
            lines.append(f"{medal} {_e(r['name'])} — <b>{r['pts']} pts</b>")

    lines += [
        "",
        "━━━━━━━━━━━━━━━━━",
        '🔗 <a href="https://predicts.info">predicts.info</a>',
    ]

    return "\n".join(lines)


@router.get("/daily-report")
def get_daily_report(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    data = _build_report(db)
    text_md = _format_text(data)
    tg_token, tg_chat = _telegram_config(db)
    return {
        "data": data,
        "text": text_md,
        "telegram_configured": bool(tg_token and tg_chat),
    }


@router.post("/daily-report/send")
async def send_daily_report(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tg_token, tg_chat = _telegram_config(db)
    if not tg_token or not tg_chat:
        raise HTTPException(400, "Telegram não configurado. Adicione o token e chat_id no painel de Configurações.")

    data = _build_report(db)
    msg = _format_text(data)

    url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
    payload = {
        "chat_id": tg_chat,
        "text": msg,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload)

    if resp.status_code != 200:
        detail = resp.json() if resp.content else resp.text
        raise HTTPException(502, f"Telegram recusou: {detail}")

    return {"ok": True, "message_id": resp.json().get("result", {}).get("message_id")}
