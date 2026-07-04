#!/usr/bin/env python3
"""Detecta gols em partidas ao vivo e notifica (push) quem apostou no jogo.

Roda via cron a cada 1 min (docker exec predicts_api python3 /app/check_goals.py).
Compara o placar ao vivo (fetch_world_cup_live_games, mesma fonte usada por
GET /matches) com o último placar visto por partida, guardado no Redis.
Na primeira vez que vê uma partida ao vivo só grava o placar atual (baseline) —
não dispara notificação de "gol" pro placar que a partida já tinha ao ser detectada.
"""
import json
import sys
from datetime import datetime, timezone

import redis as redis_lib
from sqlalchemy.orm import joinedload

from config import settings
from database import SessionLocal
from models import Bet, Match, MatchStatus
from routers.matches import _build_live_lookup, _live_match_key
from routers.notifications import create_notification

GOAL_KEY_PREFIX = "goal:last:"
GOAL_TTL = 6 * 3600

# Linha do tempo dos gols (ordem + minuto), consumida pelo popup ao vivo
GOAL_EVENTS_PREFIX = "goal:events:"
GOAL_EVENTS_MAX = 30


def _redis():
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


def main() -> int:
    db = SessionLocal()
    r = _redis()
    goals_notified = 0
    try:
        _, live_lookup = _build_live_lookup()
        if not live_lookup:
            print("[check-goals] sem jogos ao vivo")
            return 0

        matches = (
            db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .filter(Match.status.in_([MatchStatus.scheduled, MatchStatus.live]))
            .all()
        )

        for m in matches:
            live = live_lookup.get(_live_match_key(m.team_a.name, m.team_b.name))
            if not live or live.get("status") != "live":
                continue
            raw_sa, raw_sb = live.get("score_a"), live.get("score_b")
            if raw_sa is None or raw_sb is None or raw_sa == "" or raw_sb == "":
                continue
            try:
                sa, sb = int(raw_sa), int(raw_sb)
            except (TypeError, ValueError):
                continue

            key = f"{GOAL_KEY_PREFIX}{m.id}"
            prev_raw = r.get(key)
            r.setex(key, GOAL_TTL, f"{sa}-{sb}")

            if prev_raw is None:
                continue  # baseline — evita notificar gol "retroativo"

            prev_sa, prev_sb = (int(x) for x in prev_raw.split("-"))
            delta_a, delta_b = sa - prev_sa, sb - prev_sb
            if delta_a <= 0 and delta_b <= 0:
                continue

            minute_label = str(live.get("status_raw") or live.get("time_label") or "").strip()
            events_key = f"{GOAL_EVENTS_PREFIX}{m.id}"
            running_a, running_b = prev_sa, prev_sb
            # Registra um evento por gol (cobre o raro caso de 2+ gols entre polls)
            for side, delta in (("a", delta_a), ("b", delta_b)):
                for _ in range(max(delta, 0)):
                    if side == "a":
                        running_a += 1
                    else:
                        running_b += 1
                    r.rpush(events_key, json.dumps({
                        "side": side,
                        "team": m.team_a.code if side == "a" else m.team_b.code,
                        "score_a": running_a,
                        "score_b": running_b,
                        "minute_label": minute_label,
                        "at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
                    }))
            r.ltrim(events_key, -GOAL_EVENTS_MAX, -1)
            r.expire(events_key, GOAL_TTL)

            scorer = m.team_a.name if delta_a > 0 else m.team_b.name
            title = f"⚽ GOL! {scorer}"
            body = f"{m.team_a.name} {sa} x {sb} {m.team_b.name}"

            bettor_ids = {row[0] for row in db.query(Bet.user_id).filter(Bet.match_id == m.id).all()}
            for uid in bettor_ids:
                create_notification(
                    db,
                    user_id=uid,
                    type_="goal",
                    title=title,
                    body=body,
                    meta={"match_id": m.id, "score_a": sa, "score_b": sb, "team_a": m.team_a.code, "team_b": m.team_b.code},
                )
            goals_notified += 1

        db.commit()
        print(f"[check-goals] {goals_notified} gol(es) notificado(s) a {len(matches)} partidas checadas")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
