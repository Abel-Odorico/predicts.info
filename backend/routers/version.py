from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from auth_utils import require_admin
from models import AppVersion, User, WhatsappMessage

router = APIRouter(tags=["version"])


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _serialize(v: AppVersion) -> dict:
    return {
        "id": v.id,
        "version": v.version,
        "title": v.title,
        "description": v.description,
        "changes": v.changes or [],
        "notified_at": v.notified_at,
        "created_at": v.created_at,
    }


@router.get("/version/latest")
def get_latest(db: Session = Depends(get_db)):
    v = db.query(AppVersion).order_by(AppVersion.id.desc()).first()
    if not v:
        return {"version": "1.0.0", "title": "Predicts.info", "description": None, "changes": [], "notified_at": None, "created_at": None}
    return _serialize(v)


@router.get("/version/list")
def list_versions(db: Session = Depends(get_db)):
    rows = db.query(AppVersion).order_by(AppVersion.id.desc()).limit(30).all()
    return [_serialize(v) for v in rows]


class VersionPayload(BaseModel):
    version: str
    title: str
    description: str | None = None
    changes: list[str] = []


@router.post("/admin/version")
def create_version(
    payload: VersionPayload,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    v = AppVersion(
        version=payload.version.strip(),
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        changes=[c.strip() for c in payload.changes if c.strip()],
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return _serialize(v)


@router.post("/admin/version/{version_id}/notify")
def notify_version(
    version_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from routers.notifications import create_notification

    v = db.query(AppVersion).filter(AppVersion.id == version_id).first()
    if not v:
        raise HTTPException(404, "Versão não encontrada")
    if v.notified_at:
        raise HTTPException(409, "Essa versão já foi notificada — não envia de novo")

    from routers.whatsapp import _wants
    import whatsapp_client as wa

    users = db.query(User).all()
    wa_sent = 0
    for user in users:
        create_notification(
            db, user.id,
            type_="version_update",
            title=f"🚀 v{v.version} — {v.title}",
            body=v.description or (v.changes[0] if v.changes else None),
            meta={"version_id": v.id, "version": v.version, "changes": v.changes},
        )
        if user.whatsapp_opt_in and user.phone and _wants(user.whatsapp_prefs, "version_update"):
            changes_txt = "\n".join(f"• {c}" for c in (v.changes or [])[:5])
            msg = (
                f"🚀 *Novidade no Predicts — v{v.version}*\n"
                f"{v.title}\n\n"
                + (f"{v.description}\n\n" if v.description else "")
                + (f"{changes_txt}\n\n" if changes_txt else "")
                + "predicts.info/changelog"
            )
            ok = wa.send_text(db, user.phone, msg)
            db.add(WhatsappMessage(direction="outbound", phone=user.phone, body=msg, status="sent" if ok else "failed"))
            if ok:
                wa_sent += 1

    v.notified_at = _utcnow()
    db.commit()
    return {"sent": len(users), "whatsapp_sent": wa_sent, "version": v.version}
