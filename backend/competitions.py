"""Helpers de multi-competição (Fase 1 Brasileirão).

Uso:
    from competitions import COPA_2026, get_competition_id
    cid = get_competition_id(db)               # copa2026 (default)
    cid = get_competition_id(db, "brasileirao2026")

IDs de competição são imutáveis — cache de módulo é seguro e evita
uma query por request nos hot paths (ranking, pontuação, WhatsApp).
"""
from sqlalchemy.orm import Session

from models import Competition

COPA_2026 = "copa2026"

_id_cache: dict[str, int] = {}


def get_competition_id(db: Session, code: str = COPA_2026) -> int | None:
    """Resolve code -> id com cache. None se a competição não existe."""
    if code in _id_cache:
        return _id_cache[code]
    row = db.query(Competition.id).filter(Competition.code == code).first()
    if row:
        _id_cache[code] = row[0]
        return row[0]
    return None


def get_competition(db: Session, code: str = COPA_2026) -> Competition | None:
    return db.query(Competition).filter(Competition.code == code).first()
