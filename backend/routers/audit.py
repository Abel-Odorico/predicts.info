import json
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models import AuditLog, User
from auth_utils import require_admin

router = APIRouter(prefix="/audit", tags=["audit"])


def log_action(db: Session, user_id: int | None, action: str, details: dict | None = None, ip: str | None = None):
    db.add(AuditLog(
        user_id=user_id,
        action=action,
        details=json.dumps(details, default=str) if details else None,
        ip=ip,
        created_at=datetime.utcnow(),
    ))
    db.flush()


@router.get("/logs")
def list_audit_logs(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0),
    action: str | None = Query(default=None),
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        q = q.filter(AuditLog.action.ilike(f"%{action}%"))
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)

    total = q.count()
    rows = q.offset(offset).limit(limit).all()

    return {
        "total": total,
        "logs": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "user_name": r.user.name if r.user else None,
                "user_email": r.user.email if r.user else None,
                "action": r.action,
                "details": json.loads(r.details) if r.details else None,
                "ip": r.ip,
                "created_at": r.created_at,
            }
            for r in rows
        ],
    }
