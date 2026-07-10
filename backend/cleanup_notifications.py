#!/usr/bin/env python3
"""Apaga notificações antigas (regra de retenção).

Roda via cron 1x/dia (docker exec predicts_api python3 /app/cleanup_notifications.py).
Retenção definida em routers/notifications.py::NOTIFICATION_RETENTION_DAYS —
mesma constante usada pelo endpoint manual DELETE /admin/notifications/cleanup.
"""
import sys
from datetime import timedelta

from database import SessionLocal
from models import Notification
from routers.notifications import NOTIFICATION_RETENTION_DAYS, _utcnow


def main() -> int:
    db = SessionLocal()
    try:
        cutoff = _utcnow() - timedelta(days=NOTIFICATION_RETENTION_DAYS)
        deleted = (
            db.query(Notification)
            .filter(Notification.created_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        print(f"[cleanup_notifications] deleted={deleted} cutoff={cutoff.isoformat()}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
