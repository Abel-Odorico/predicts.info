#!/usr/bin/env python3
"""
Reconstrói a base real da Copa do Mundo 2026:
- grupos e jogos atuais
- convocados
- Elo, gols médios e forma recente

Uso:
  docker exec copa_api python3 /app/update_world_cup_data.py
"""

from config import settings
from world_cup_sync import (
    apply_world_cup_snapshot,
    fetch_world_cup_snapshot,
    invalidate_simulation_cache,
    sync_team_stats,
)


def log(message: str) -> None:
    print(message, flush=True)


def main() -> None:
    log("=== COPA 2026 — Sync completo ===")
    snapshot = fetch_world_cup_snapshot(log=log)
    summary = apply_world_cup_snapshot(settings.database_url, snapshot, log=log)
    log(
        f"Base aplicada: {summary['teams']} seleções, "
        f"{summary['matches']} jogos, {summary['players']} jogadores"
    )
    stats = sync_team_stats(settings.database_url, log=log)
    log(f"Estatísticas atualizadas: {stats['updated']} seleções")
    if stats["errors"]:
        log(f"Erros no EloRatings: {', '.join(stats['errors'])}")
    invalidate_simulation_cache(log=log)
    log("Pronto.")


if __name__ == "__main__":
    main()
