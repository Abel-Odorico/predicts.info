#!/usr/bin/env python3
"""Detecta partidas que acabaram de começar e notifica (push) quem apostou nelas.

Roda via cron a cada 1 min (docker exec predicts_api python3 /app/check_kickoff.py).
Mesma fonte ao vivo do check_goals.py. Marca no Redis quem já foi notificado
pra disparar só uma vez por partida. Push aponta direto pra /partida/{id}
("Abrir partida") em vez do genérico /apostas.
"""
import sys

import redis as redis_lib
from sqlalchemy.orm import joinedload

from config import settings
from database import SessionLocal
from models import Bet, Match, MatchStatus
from routers.matches import _build_live_lookup, _live_match_key
from routers.notifications import create_notification

KICKOFF_KEY_PREFIX = "kickoff:notified:"
KICKOFF_TTL = 12 * 3600


def _redis():
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


def main() -> int:
    db = SessionLocal()
    r = _redis()
    notified = 0
    try:
        _, live_lookup = _build_live_lookup()
        if not live_lookup:
            print("[check-kickoff] sem jogos ao vivo")
            return 0

        matches = (
            db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .filter(Match.status == MatchStatus.scheduled)
            .all()
        )

        for m in matches:
            live = live_lookup.get(_live_match_key(m.team_a.name, m.team_b.name))
            if not live or live.get("status") != "live":
                continue

            key = f"{KICKOFF_KEY_PREFIX}{m.id}"
            if r.get(key):
                continue
            r.setex(key, KICKOFF_TTL, "1")

            title = f"⚽ Começou! {m.team_a.name} x {m.team_b.name}"
            body = "Acompanhe o jogo ao vivo e veja sua simulação"

            bettor_ids = {row[0] for row in db.query(Bet.user_id).filter(Bet.match_id == m.id).all()}
            for uid in bettor_ids:
                create_notification(
                    db,
                    user_id=uid,
                    type_="match_live",
                    title=title,
                    body=body,
                    meta={"match_id": m.id, "team_a": m.team_a.code, "team_b": m.team_b.code},
                    push_url=f"/partida/{m.id}",
                )
            notified += 1

        db.commit()
        print(f"[check-kickoff] {notified} partida(s) iniciada(s) notificada(s) de {len(matches)} agendadas checadas")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
