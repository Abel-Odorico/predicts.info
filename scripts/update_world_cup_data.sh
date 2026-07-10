#!/usr/bin/env bash
set -euo pipefail

echo "=== $(date '+%Y-%m-%dT%H:%M:%S%z') ==="
# flock: sync que passar de 5min não sobrepõe o próximo tick do cron
# (execução concorrente duplicou avisos no grupo WhatsApp em 10/07)
exec flock -n /var/lock/predicts-world-cup-sync.lock \
  docker exec predicts_api python3 /app/update_world_cup_data.py
