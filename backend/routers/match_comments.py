"""
GET    /matches/{match_id}/comments              — list comments (public)
POST   /matches/{match_id}/comments              — post comment (auth)
DELETE /matches/{match_id}/comments/{comment_id} — delete own or admin
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, text
from pydantic import BaseModel

from database import Base, get_db
from auth_utils import get_current_user
from models import Match, User

router = APIRouter(tags=["match-comments"])


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class MatchComment(Base):
    __tablename__ = "match_comments"
    id         = Column(Integer, primary_key=True)
    match_id   = Column(Integer, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False)
    user_id    = Column(Integer, ForeignKey("users.id",   ondelete="CASCADE"), nullable=False)
    content    = Column(String(280), nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class CommentBody(BaseModel):
    content: str


def _serialize(row, user_name: str) -> dict:
    return {
        "id":         row.id,
        "match_id":   row.match_id,
        "user_id":    row.user_id,
        "user_name":  user_name,
        "content":    row.content,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/matches/{match_id}/comments")
def list_comments(
    match_id: int,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text("""
            SELECT mc.id, mc.match_id, mc.user_id, mc.content, mc.created_at, u.name
            FROM match_comments mc
            JOIN users u ON u.id = mc.user_id
            WHERE mc.match_id = :mid
            ORDER BY mc.created_at ASC
            LIMIT :lim
        """),
        {"mid": match_id, "lim": limit},
    ).fetchall()
    return [
        {
            "id": r[0], "match_id": r[1], "user_id": r[2],
            "content": r[3],
            "created_at": r[4].isoformat() if r[4] else None,
            "user_name": r[5],
        }
        for r in rows
    ]


@router.post("/matches/{match_id}/comments", status_code=201)
def post_comment(
    match_id: int,
    body: CommentBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    content = body.content.strip()
    if not content:
        raise HTTPException(400, "Comentário não pode ser vazio")
    if len(content) > 280:
        raise HTTPException(400, "Máximo 280 caracteres")
    match = db.query(Match).filter(Match.id == match_id).first()
    if not match:
        raise HTTPException(404, "Partida não encontrada")

    comment = MatchComment(match_id=match_id, user_id=user.id, content=content)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {"id": comment.id, "match_id": match_id, "user_id": user.id,
            "user_name": user.name, "content": comment.content,
            "created_at": comment.created_at.isoformat() if comment.created_at else None}


@router.delete("/matches/{match_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    match_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = db.query(MatchComment).filter(
        MatchComment.id == comment_id,
        MatchComment.match_id == match_id,
    ).first()
    if not comment:
        raise HTTPException(404, "Comentário não encontrado")
    if comment.user_id != user.id and user.role.value != "admin":
        raise HTTPException(403, "Sem permissão")
    db.delete(comment)
    db.commit()
