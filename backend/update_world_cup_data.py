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
from routers.live import sync_finished_from_live_feed
from world_cup_official import sync_knockout_matches
from world_cup_sync import (
    apply_world_cup_snapshot,
    fetch_world_cup_snapshot,
    invalidate_simulation_cache,
    sync_team_stats,
)
from projections import send_pending_projections


def log(message: str) -> None:
    print(message, flush=True)


def main() -> None:
    log("=== COPA 2026 — Sync completo ===")

    # Fallback tropatech ANTES do snapshot: grava resultado de jogo do mata-mata
    # já encerrado no feed ao vivo mas ainda ausente na Wikipedia, pra o loop de
    # pontuação do apply_world_cup_snapshot avaliar as apostas no MESMO ciclo.
    # Isolado: qualquer falha aqui não pode derrubar o sync principal.
    try:
        fb = sync_finished_from_live_feed(settings.database_url, log=log)
        log(f"Fallback ao vivo: {fb.get('inserted', 0)} resultado(s) gravado(s), {fb.get('skipped', 0)} já existiam")
    except Exception as exc:
        log(f"Fallback ao vivo falhou (ignorado): {exc}")

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
    ko = sync_knockout_matches(settings.database_url, log=log)
    log(f"Eliminatórias R32: {ko['created']} criadas, {ko['updated']} atualizadas, {ko['skipped']} puladas")
    invalidate_simulation_cache(log=log)

    try:
        result = send_pending_projections(log=log)
        log(f"Projeções Telegram: {result['sent']} enviada(s)" + (f", erros: {result['errors']}" if result["errors"] else ""))
    except Exception as exc:
        log(f"Projeções Telegram falharam (ignorado): {exc}")

    log("Pronto.")


if __name__ == "__main__":
    main()
