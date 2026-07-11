"""
Drena a fila de whatsapp_campaign_recipients pendente, 1 msg por vez com delay
randômico 3-8s (anti-ban). Roda via cron a cada 1min; cada execução processa até
BATCH_SIZE pendentes e sai — não segura o processo rodando pra sempre.
Uso: docker exec predicts_api python3 /app/whatsapp_campaign_worker.py
"""
import random
import time
from datetime import datetime, timezone

from sqlalchemy import or_

from database import SessionLocal
from models import Ranking, User, WhatsappCampaign, WhatsappCampaignRecipient, WhatsappMessage
import whatsapp_client as wa

BATCH_SIZE = 20
DELAY_MIN, DELAY_MAX = 3, 8


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _render_message(template: str, user: User | None, pos_by_user: dict) -> str:
    """Variáveis por destinatário: {nome}, {primeiro_nome}, {pontos}, {posicao}.
    Sem user vinculado (ou sem ranking), variável vira texto neutro — nunca quebra o envio."""
    if "{" not in template:
        return template
    nome = (user.name if user else "") or "torcedor(a)"
    pos, pts = pos_by_user.get(user.id, (None, None)) if user else (None, None)
    return (
        template
        .replace("{nome}", nome)
        .replace("{primeiro_nome}", nome.split()[0])
        .replace("{pontos}", str(pts) if pts is not None else "0")
        .replace("{posicao}", f"{pos}º" if pos else "—")
    )


def run():
    db = SessionLocal()
    try:
        if wa.is_quiet_now(db):
            # modo silêncio: pula o tick inteiro — recipients ficam "pending" e a
            # campanha retoma sozinha no primeiro tick fora da janela (nada vira "failed")
            return
        now = _utcnow()
        pending = (
            db.query(WhatsappCampaignRecipient)
            .join(WhatsappCampaign, WhatsappCampaignRecipient.campaign_id == WhatsappCampaign.id)
            .filter(
                WhatsappCampaignRecipient.status == "pending",
                WhatsappCampaign.status == "running",
                or_(WhatsappCampaign.scheduled_at.is_(None), WhatsappCampaign.scheduled_at <= now),
            )
            .limit(BATCH_SIZE)
            .all()
        )
        pos_by_user = {}
        if pending:
            from competitions import get_competition_id
            rows = (
                db.query(Ranking)
                .filter(Ranking.competition_id == get_competition_id(db))
                .order_by(Ranking.total_points.desc(), Ranking.exact_scores.desc())
                .all()
            )
            pos_by_user = {r.user_id: (i + 1, r.total_points) for i, r in enumerate(rows)}

        for recipient in pending:
            campaign = db.query(WhatsappCampaign).filter(WhatsappCampaign.id == recipient.campaign_id).first()
            user = db.query(User).filter(User.id == recipient.user_id).first() if recipient.user_id else None
            message = _render_message(campaign.message, user, pos_by_user)
            msg_id = wa.send_text_full(db, recipient.phone, message)
            recipient.status = "sent" if msg_id else "failed"
            recipient.sent_at = _utcnow()
            recipient.wa_message_id = msg_id if msg_id and msg_id != "sent-no-id" else None
            db.add(WhatsappMessage(
                direction="outbound", phone=recipient.phone, body=message,
                status=recipient.status, wa_message_id=recipient.wa_message_id,
                meta={"campaign_id": campaign.id},
            ))
            db.commit()
            time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

        # marca campanhas sem mais pendente como done (agendada pro futuro tem pendentes, não fecha)
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
