"""
Worker do Bot Squad — roda via cron horário (minuto :20, fora dos ticks dos syncs).
1) place_pending_bets: aposta persona-based nos jogos da janela rolante de 7 dias
   (Copa + Brasileirão), com jitter por (persona, jogo).
2) run_t3_reviews: revisão T-3h antes do kickoff + aviso Telegram.
Master switch: site_config.bot_squad_enabled ("true"/"false").
Uso: docker exec predicts_api python3 /app/bot_squad_worker.py
"""
from database import SessionLocal
from models import SiteConfig
from bot_squad import place_pending_bets, run_t3_reviews


def main() -> None:
    db = SessionLocal()
    try:
        row = db.query(SiteConfig).filter(SiteConfig.key == "bot_squad_enabled").first()
        if not row or (row.value or "").strip().lower() != "true":
            print("[bot_squad_worker] bot_squad_enabled != true — nada a fazer", flush=True)
            return
    finally:
        db.close()

    placed = place_pending_bets()
    reviews = run_t3_reviews()
    print(f"[bot_squad_worker] apostas: {placed} | revisões: {reviews}", flush=True)


if __name__ == "__main__":
    main()
