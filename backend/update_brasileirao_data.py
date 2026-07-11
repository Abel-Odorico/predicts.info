"""
Sync do Brasileirão (Fase 2) — rodar manual ou via cron (Fase 3):
    docker exec predicts_api python3 /app/update_brasileirao_data.py

Ordem: clubes → fixtures/resultados → replay de Elo/forma/gols.
Usa 2 requisições na football-data.org (free tier 10/min).
"""
from database import SessionLocal
from routers.brasileirao_sync import sync_all


def main() -> None:
    db = SessionLocal()
    try:
        out = sync_all(db)
        t, m, s = out["teams"], out["matches"], out["stats"]
        print(f"Clubes: {t['created']} criados, {t['updated']} atualizados, erros: {t['errors'] or 'nenhum'}")
        print(f"Jogos: {m['created']} criados, {m['updated']} atualizados, "
              f"{m['results']} resultados, {m['skipped']} pulados")
        print(f"Stats: {s['clubs']} clubes recalculados sobre {s['finished_matches']} jogos finalizados")
    finally:
        db.close()


if __name__ == "__main__":
    main()
