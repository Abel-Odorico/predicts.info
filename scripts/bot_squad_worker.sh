#!/bin/bash
# Bot Squad — apostas persona + revisão T-3h. flock evita corrida com execução manual.
exec 9>/tmp/bot_squad.lock
flock -n 9 || { echo "[bot_squad] já rodando, pulando"; exit 0; }
docker exec predicts_api python3 /app/bot_squad_worker.py
