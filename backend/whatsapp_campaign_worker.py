"""
Drena a fila de whatsapp_campaign_recipients pendente, 1 msg por vez com delay
randômico 3-8s (anti-ban). Roda via cron a cada 1min; cada execução processa até
BATCH_SIZE pendentes e sai — não segura o processo rodando pra sempre.
Uso: docker exec predicts_api python3 /app/whatsapp_campaign_worker.py
"""
import random
import time
from datetime import datetime, timezone

from database import SessionLocal
from models import WhatsappCampaign, WhatsappCampaignRecipient, WhatsappMessage
import whatsapp_client as wa

BATCH_SIZE = 20
DELAY_MIN, DELAY_MAX = 3, 8


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def run():
    db = SessionLocal()
    try:
        if wa.is_quiet_now(db):
            # modo silêncio: pula o tick inteiro — recipients ficam "pending" e a
            # campanha retoma sozinha no primeiro tick fora da janela (nada vira "failed")
            return
        pending = (
            db.query(WhatsappCampaignRecipient)
            .join(WhatsappCampaign, WhatsappCampaignRecipient.campaign_id == WhatsappCampaign.id)
            .filter(WhatsappCampaignRecipient.status == "pending", WhatsappCampaign.status == "running")
            .limit(BATCH_SIZE)
            .all()
        )
        for recipient in pending:
            campaign = db.query(WhatsappCampaign).filter(WhatsappCampaign.id == recipient.campaign_id).first()
            ok = wa.send_text(db, recipient.phone, campaign.message)
            recipient.status = "sent" if ok else "failed"
            recipient.sent_at = _utcnow()
            db.add(WhatsappMessage(direction="outbound", phone=recipient.phone, body=campaign.message, status=recipient.status))
            db.commit()
            time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

        # marca campanhas sem mais pendente como done
        running = db.query(WhatsappCampaign).filter(WhatsappCampaign.status == "running").all()
        for campaign in running:
            still_pending = db.query(WhatsappCampaignRecipient).filter(
                WhatsappCampaignRecipient.campaign_id == campaign.id,
                WhatsappCampaignRecipient.status == "pending",
            ).count()
            if still_pending == 0:
                campaign.status = "done"
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    run()
