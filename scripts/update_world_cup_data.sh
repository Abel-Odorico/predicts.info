#!/usr/bin/env bash
set -euo pipefail

echo "=== $(date '+%Y-%m-%dT%H:%M:%S%z') ==="
docker exec predicts_api python3 /app/update_world_cup_data.py
