"""
Waitlist de novas competições (Brasileirão etc.) — captura interesse pré-lançamento.
POST /waitlist            entra na lista (logado: user_id; anônimo: email)
GET  /waitlist/status     estado do usuário logado (ou email via query)
GET  /admin/waitlist/summary  contagem + últimos inscritos
"""

import re
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import get_db
from auth_utils import get_optional_user, require_admin
from models import User

router = APIRouter(tags=["waitlist"])

VALID_COMPETITIONS = {"brasileirao"}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# rate limit simples por IP (público, evita flood de emails)
_RATE: dict[str, list[float]] = {}
_RATE_MAX, _RATE_WINDOW = 10, 3600


def _check_rate(ip: str):
    now = time.time()
    hits = [t for t in _RATE.get(ip, []) if now - t < _RATE_WINDOW]
    if len(hits) >= _RATE_MAX:
        raise HTTPException(429, "Muitas tentativas. Tenta de novo mais tarde.")
    hits.append(now)
    _RATE[ip] = hits


class WaitlistPayload(BaseModel):
    competition: str = "brasileirao"
    email: str | None = None


@router.post("/waitlist")
def join_waitlist(
    payload: WaitlistPayload,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    comp = payload.competition.strip().lower()
    if comp not in VALID_COMPETITIONS:
        raise HTTPException(400, "Competição inválida.")

    ip = request.headers.get("X-Real-IP", "").strip() or (request.client.host if request.client else "?")
    _check_rate(ip)

    email = (payload.email or "").strip().lower() or None
    if not user and not email:
        raise HTTPException(400, "Informe um e-mail ou faça login.")
    if email and (len(email) > 255 or not _EMAIL_RE.match(email)):
        raise HTTPException(400, "E-mail inválido.")

    if user:
        exists = db.execute(text(
            "SELECT 1 FROM competition_waitlist WHERE competition = :c AND user_id = :u"
        ), {"c": comp, "u": user.id}).first()
        if exists:
            return {"ok": True, "already": True}
        db.execute(text("""
            INSERT INTO competition_waitlist (competition, user_id, email, ip, created_at)
            VALUES (:c, :u, :e, :ip, :now)
        """), {"c": comp, "u": user.id, "e": email or user.email, "ip": ip,
               "now": datetime.now(timezone.utc).replace(tzinfo=None)})
    else:
        exists = db.execute(text(
            "SELECT 1 FROM competition_waitlist WHERE competition = :c AND lower(email) = :e"
        ), {"c": comp, "e": email}).first()
        if exists:
            return {"ok": True, "already": True}
        db.execute(text("""
            INSERT INTO competition_waitlist (competition, email, ip, created_at)
            VALUES (:c, :e, :ip, :now)
        """), {"c": comp, "e": email, "ip": ip,
               "now": datetime.now(timezone.utc).replace(tzinfo=None)})

    db.commit()
    return {"ok": True, "already": False}


@router.get("/waitlist/status")
def waitlist_status(
    competition: str = "brasileirao",
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    comp = competition.strip().lower()
    if not user:
        return {"joined": False}
    row = db.execute(text(
        "SELECT 1 FROM competition_waitlist WHERE competition = :c AND user_id = :u"
    ), {"c": comp, "u": user.id}).first()
    return {"joined": bool(row)}


@router.get("/admin/waitlist/summary")
def waitlist_summary(
    competition: str = "brasileirao",
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    comp = competition.strip().lower()
    total = db.execute(text(
        "SELECT COUNT(*) FROM competition_waitlist WHERE competition = :c"
    ), {"c": comp}).scalar() or 0
    with_user = db.execute(text(
        "SELECT COUNT(*) FROM competition_waitlist WHERE competition = :c AND user_id IS NOT NULL"
    ), {"c": comp}).scalar() or 0
    recent = db.execute(text("""
        SELECT w.id, w.email, w.created_at, u.name
        FROM competition_waitlist w
        LEFT JOIN users u ON u.id = w.user_id
        WHERE w.competition = :c
        ORDER BY w.created_at DESC
        LIMIT 20
    """), {"c": comp}).fetchall()
    return {
        "competition": comp,
        "total": total,
        "with_account": with_user,
        "anonymous": total - with_user,
        "recent": [
            {"id": r.id, "name": r.name, "email": r.email,
             "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in recent
        ],
    }
