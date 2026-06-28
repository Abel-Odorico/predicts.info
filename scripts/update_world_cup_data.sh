#!/usr/bin/env bash
set -euo pipefail

docker exec predicts_api python3 /app/update_world_cup_data.py
