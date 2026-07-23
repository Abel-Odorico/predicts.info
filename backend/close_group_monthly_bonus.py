#!/usr/bin/env python3
"""Fecha o bônus mensal dos bolões (passo 11 do plano predicts-grupos-bonus).

Roda 1x/dia via cron (`0 5 * * *`, madrugada BRT — mesmo padrão de
cleanup_notifications.py). Se HOJE é dia 1 do mês em BRT E existe grupo com
`monthly_bonus.enabled=true` no `GroupFeatureConfig` sem linha em
`GroupMonthlyBonus` pro (group_id, ano, mês ANTERIOR), calcula o top 3 do
mês FECHADO (mesma query de `monthly_ranking` de
`routers/user_groups.py::group_highlights`, mas com o mês anterior fixo, não
o corrente), grava 3 linhas com pts_awarded/pe_credit/ve_credit vindos do
config do grupo, notifica (sino + WhatsApp, reusa `group_mechanics.
_notify_group_members`). Idempotente pelo unique
`(group_id, year, month, rank)` — não recalcula retroativo se bets mudarem
depois (decisão 5 do plan.md: evita ranking de mês passado balançar meses
depois por correção tardia de resultado).

docker exec predicts_api python3 /app/close_group_monthly_bonus.py
"""
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, func

from competitions import get_competition_id
from database import SessionLocal
from models import Bet, GroupMonthlyBonus, Match, MatchStatus, UserGroup, UserGroupMember

# Brasil não tem horário de verão desde 2019 — offset fixo BRT = UTC-3.
BRT_OFFSET = timedelta(hours=3)


def _now_brt() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - BRT_OFFSET


def _previous_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def main() -> int:
    now_brt = _now_brt()
    if now_brt.day != 1:
        print(f"[close-monthly-bonus] hoje não é dia 1 BRT ({now_brt.date()}) — nada a fazer")
        return 0

    prev_year, prev_month = _previous_month(now_brt.year, now_brt.month)

    # Janela do mês fechado em BRT, convertida pra UTC (soma 3h) pra comparar
    # com match_date (armazenado UTC naive, mesma convenção do resto do banco).
    month_start_brt = datetime(prev_year, prev_month, 1)
    next_year, next_month = (prev_year + 1, 1) if prev_month == 12 else (prev_year, prev_month + 1)
    month_end_brt = datetime(next_year, next_month, 1)
    month_start_utc = month_start_brt + BRT_OFFSET
    month_end_utc = month_end_brt + BRT_OFFSET

    db = SessionLocal()
    closed = 0
    try:
        from group_mechanics import _notify_group_members
        from routers.user_groups import _get_feature_config

        comp_id = get_competition_id(db, "brasileirao2026")

        for group in db.query(UserGroup).all():
            config = _get_feature_config(db, group.id)
            if not config["monthly_bonus"]["enabled"]:
                continue

            already = (
                db.query(GroupMonthlyBonus)
                .filter(
                    GroupMonthlyBonus.group_id == group.id,
                    GroupMonthlyBonus.year == prev_year,
                    GroupMonthlyBonus.month == prev_month,
                )
                .first()
            )
            if already:
                continue

            member_ids = [
                r[0] for r in db.query(UserGroupMember.user_id).filter(UserGroupMember.group_id == group.id).all()
            ]
            if not member_ids:
                continue

            rows = (
                db.query(Bet.user_id, func.sum(Bet.points_earned).label("pts_month"))
                .join(Match, Bet.match_id == Match.id)
                .filter(
                    Bet.user_id.in_(member_ids),
                    Match.status == MatchStatus.finished,
                    Match.match_date >= month_start_utc,
                    Match.match_date < month_end_utc,
                    Match.competition_id == comp_id,
                )
                .group_by(Bet.user_id)
                .order_by(desc(func.sum(Bet.points_earned)))
                .limit(3)
                .all()
            )
            if not rows:
                continue  # ninguém apostou no mês fechado nesse grupo — nada pra premiar

            pts_by_rank = config["monthly_bonus"]["pts_by_rank"]
            credits_by_rank = config["monthly_bonus"]["credits_by_rank"]

            top3_summary = []
            for i, r in enumerate(rows, start=1):
                rank_key = str(i)
                credits = credits_by_rank.get(rank_key, {})
                db.add(GroupMonthlyBonus(
                    group_id=group.id, year=prev_year, month=prev_month, rank=i,
                    user_id=r.user_id,
                    pts_awarded=int(pts_by_rank.get(rank_key, 0)),
                    pe_credit=int(credits.get("pe", 0)),
                    ve_credit=int(credits.get("ve", 0)),
                ))
                top3_summary.append({"rank": i, "user_id": r.user_id, "pts_month": int(r.pts_month or 0)})
            db.commit()
            closed += 1
            print(f"[close-monthly-bonus] grupo={group.id} {prev_month:02d}/{prev_year} top3={top3_summary}")

            if config.get("notifications_enabled", True):
                title = "🏆 Bônus mensal fechado"
                body = f"Ranking de {prev_month:02d}/{prev_year} do bolão \"{group.name}\" fechado — confira o pódio do mês."
                meta = {"group_id": group.id, "year": prev_year, "month": prev_month, "top3": top3_summary}
                wa_message = (
                    f"🏆 *Bônus mensal fechado* no bolão \"{group.name}\"\n\n"
                    f"O ranking de {prev_month:02d}/{prev_year} foi fechado — confira o pódio do mês em "
                    f"predicts.info/meus-grupos/{group.id}"
                )
                try:
                    _notify_group_members(db, group, member_ids, "group_monthly_bonus", title, body, meta, wa_message)
                    db.commit()
                except Exception as e:
                    print(f"[close-monthly-bonus] notificação falhou group={group.id}: {e}", flush=True)

        print(f"[close-monthly-bonus] concluído — grupos fechados={closed} mês={prev_month:02d}/{prev_year}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
