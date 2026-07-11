#!/bin/bash
# Sync do Brasileirão (Fase 3) — fixtures/resultados BSA + Elo replay + bets/ranking.
# flock evita rodar em paralelo com execução manual (lição do incidente 2026-07-10).
exec 9>/tmp/predicts_brasileirao_sync.lock
flock -n 9 || { echo "[brasileirao] já rodando, pulando"; exit 0; }
docker exec predicts_api python3 /app/update_brasileirao_data.py
