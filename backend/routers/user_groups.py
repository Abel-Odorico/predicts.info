import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session, joinedload

from auth_utils import get_current_user
from database import get_db
from models import Bet, GroupInviteStatus, Ranking, User, UserGroup, UserGroupInvite, UserGroupMember

router = APIRouter(prefix="/user-groups", tags=["user-groups"])


class UserGroupCreate(BaseModel):
    name: str


class GroupInviteCreate(BaseModel):
    user_id: int | None = None
    email: EmailStr | None = None


def _group_payload(group: UserGroup) -> dict:
    accepted_members = sorted(group.members, key=lambda member: (not member.is_owner, member.user.name.lower() if member.user else ""))
    pending_invites = [
        invite for invite in group.invites
        if invite.status == GroupInviteStatus.pending
    ]
    return {
        "id": group.id,
        "name": group.name,
        "owner_user_id": group.owner_user_id,
        "created_at": group.created_at,
        "members": [
            {
                "id": member.id,
                "user_id": member.user_id,
                "name": member.user.name if member.user else "",
                "email": member.user.email if member.user else "",
                "is_owner": member.is_owner,
                "joined_at": member.joined_at,
            }
            for member in accepted_members
        ],
        "pending_invites": [
            {
                "id": invite.id,
                "invitee_user_id": invite.invitee_user_id,
                "invitee_email": invite.invitee_email,
                "inviter_user_id": invite.inviter_user_id,
                "created_at": invite.created_at,
            }
            for invite in pending_invites
        ],
    }


def _load_group(group_id: int, db: Session) -> UserGroup | None:
    return (
        db.query(UserGroup)
        .options(
            joinedload(UserGroup.members).joinedload(UserGroupMember.user),
            joinedload(UserGroup.invites),
        )
        .filter(UserGroup.id == group_id)
        .first()
    )


def _ensure_group_owner(group: UserGroup, user: User) -> None:
    if group.owner_user_id != user.id:
        raise HTTPException(403, "Somente o dono do grupo pode gerenciar convites")


@router.get("")
def list_user_groups(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    memberships = (
        db.query(UserGroupMember)
        .options(
            joinedload(UserGroupMember.group).joinedload(UserGroup.members).joinedload(UserGroupMember.user),
            joinedload(UserGroupMember.group).joinedload(UserGroup.invites),
        )
        .filter(UserGroupMember.user_id == user.id)
        .all()
    )
    groups = [_group_payload(member.group) for member in memberships if member.group]

    invites = (
        db.query(UserGroupInvite)
        .options(joinedload(UserGroupInvite.group), joinedload(UserGroupInvite.inviter))
        .filter(
            UserGroupInvite.status == GroupInviteStatus.pending,
            or_(
                UserGroupInvite.invitee_user_id == user.id,
                UserGroupInvite.invitee_email == user.email,
            ),
        )
        .order_by(UserGroupInvite.created_at.desc())
        .all()
    )
    pending_invites = [
        {
            "id": invite.id,
            "group_id": invite.group_id,
            "group_name": invite.group.name if invite.group else "",
            "invitee_email": invite.invitee_email,
            "inviter_name": invite.inviter.name if invite.inviter else "",
            "created_at": invite.created_at,
        }
        for invite in invites
    ]
    return {"groups": groups, "pending_invites": pending_invites}


@router.post("", status_code=201)
def create_group(
    payload: UserGroupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    name = payload.name.strip()
    if len(name) < 3:
        raise HTTPException(400, "Nome do grupo deve ter pelo menos 3 caracteres")

    group = UserGroup(name=name[:120], owner_user_id=user.id)
    db.add(group)
    db.flush()
    db.add(UserGroupMember(group_id=group.id, user_id=user.id, is_owner=True))
    db.commit()
    loaded = _load_group(group.id, db)
    return _group_payload(loaded)


@router.get("/users/search")
def search_users(
    q: str = Query(default="", min_length=2),
    limit: int = Query(default=8, le=20),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    term = q.strip()
    rows = (
        db.query(User)
        .filter(
            User.id != user.id,
            or_(
                User.name.ilike(f"%{term}%"),
                User.email.ilike(f"%{term}%"),
            ),
        )
        .order_by(User.name.asc())
        .limit(limit)
        .all()
    )
    return [
        {"id": row.id, "name": row.name, "email": row.email}
        for row in rows
    ]


@router.post("/{group_id}/invites", status_code=201)
def invite_to_group(
    group_id: int,
    payload: GroupInviteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = _load_group(group_id, db)
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    _ensure_group_owner(group, user)

    invitee_user = None
    invitee_email = (payload.email or "").strip().lower()
    if payload.user_id:
        invitee_user = db.query(User).filter(User.id == payload.user_id).first()
        if not invitee_user:
            raise HTTPException(404, "Usuário não encontrado")
        invitee_email = invitee_user.email.lower()
    elif invitee_email:
        invitee_user = db.query(User).filter(User.email == invitee_email).first()
    else:
        raise HTTPException(400, "Informe um usuário ou email para convidar")

    member_user_ids = {member.user_id for member in group.members}
    if invitee_user and invitee_user.id in member_user_ids:
        raise HTTPException(409, "Usuário já faz parte do grupo")
    if invitee_email == user.email.lower():
        raise HTTPException(409, "Você já faz parte deste grupo")

    existing_pending = (
        db.query(UserGroupInvite)
        .filter(
            UserGroupInvite.group_id == group_id,
            UserGroupInvite.status == GroupInviteStatus.pending,
            UserGroupInvite.invitee_email == invitee_email,
        )
        .first()
    )
    if existing_pending:
        raise HTTPException(409, "Já existe convite pendente para este email")

    invite = UserGroupInvite(
        group_id=group_id,
        inviter_user_id=user.id,
        invitee_user_id=invitee_user.id if invitee_user else None,
        invitee_email=invitee_email,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return {
        "id": invite.id,
        "group_id": invite.group_id,
        "invitee_user_id": invite.invitee_user_id,
        "invitee_email": invite.invitee_email,
        "status": invite.status.value,
    }


@router.post("/invites/{invite_id}/accept")
def accept_group_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invite = (
        db.query(UserGroupInvite)
        .options(joinedload(UserGroupInvite.group))
        .filter(UserGroupInvite.id == invite_id)
        .first()
    )
    if not invite:
        raise HTTPException(404, "Convite não encontrado")
    if invite.status != GroupInviteStatus.pending:
        raise HTTPException(409, "Convite já respondido")
    if invite.invitee_email.lower() != user.email.lower() and invite.invitee_user_id not in (None, user.id):
        raise HTTPException(403, "Este convite não pertence ao usuário atual")

    existing_member = (
        db.query(UserGroupMember)
        .filter(UserGroupMember.group_id == invite.group_id, UserGroupMember.user_id == user.id)
        .first()
    )
    if not existing_member:
        db.add(UserGroupMember(group_id=invite.group_id, user_id=user.id, is_owner=False))
    invite.invitee_user_id = user.id
    invite.status = GroupInviteStatus.accepted
    invite.responded_at = datetime.utcnow()
    db.commit()
    group = _load_group(invite.group_id, db)
    return _group_payload(group)


@router.post("/invites/{invite_id}/reject")
def reject_group_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invite = db.query(UserGroupInvite).filter(UserGroupInvite.id == invite_id).first()
    if not invite:
        raise HTTPException(404, "Convite não encontrado")
    if invite.status != GroupInviteStatus.pending:
        raise HTTPException(409, "Convite já respondido")
    if invite.invitee_email.lower() != user.email.lower() and invite.invitee_user_id not in (None, user.id):
        raise HTTPException(403, "Este convite não pertence ao usuário atual")

    invite.invitee_user_id = user.id
    invite.status = GroupInviteStatus.rejected
    invite.responded_at = datetime.utcnow()
    db.commit()
    return {"status": "rejected", "invite_id": invite.id}


# ── Ranking do grupo ──────────────────────────────────────────────────────────

@router.get("/{group_id}/ranking")
def group_ranking(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")

    member_ids = [
        r[0] for r in db.query(UserGroupMember.user_id)
        .filter(UserGroupMember.group_id == group_id).all()
    ]
    if user.id not in member_ids:
        raise HTTPException(403, "Você não faz parte deste grupo")

    bet_counts = (
        db.query(Bet.user_id, func.count(Bet.id).label("total_bets"))
        .filter(Bet.user_id.in_(member_ids))
        .group_by(Bet.user_id)
        .subquery()
    )
    rows = (
        db.query(
            User.id.label("user_id"),
            User.name.label("name"),
            func.coalesce(Ranking.total_points, 0).label("total_points"),
            func.coalesce(Ranking.exact_scores, 0).label("exact_scores"),
            func.coalesce(Ranking.correct_results, 0).label("correct_results"),
            func.coalesce(bet_counts.c.total_bets, 0).label("total_bets"),
        )
        .outerjoin(Ranking, User.id == Ranking.user_id)
        .outerjoin(bet_counts, User.id == bet_counts.c.user_id)
        .filter(User.id.in_(member_ids))
        .order_by(
            desc(func.coalesce(Ranking.total_points, 0)),
            desc(func.coalesce(Ranking.exact_scores, 0)),
            desc(func.coalesce(bet_counts.c.total_bets, 0)),
            User.name.asc(),
        )
        .all()
    )
    return {
        "group_id": group.id,
        "group_name": group.name,
        "ranking": [
            {
                "position": i + 1,
                "user_id": r.user_id,
                "name": r.name,
                "total_points": r.total_points,
                "exact_scores": r.exact_scores,
                "correct_results": r.correct_results,
                "total_bets": r.total_bets,
                "is_me": r.user_id == user.id,
            }
            for i, r in enumerate(rows)
        ],
    }


# ── Link de convite compartilhável ───────────────────────────────────────────

@router.post("/{group_id}/invite-link")
def generate_invite_link(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    if group.owner_user_id != user.id:
        raise HTTPException(403, "Apenas o dono pode gerar link de convite")
    if not group.invite_token:
        group.invite_token = secrets.token_urlsafe(24)
        db.commit()
    return {"token": group.invite_token}


@router.delete("/{group_id}/invite-link")
def revoke_invite_link(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    if group.owner_user_id != user.id:
        raise HTTPException(403, "Apenas o dono pode revogar o link")
    group.invite_token = None
    db.commit()
    return {"status": "revoked"}


@router.get("/join/{token}")
def get_group_by_token(token: str, db: Session = Depends(get_db)):
    group = db.query(UserGroup).options(
        joinedload(UserGroup.members).joinedload(UserGroupMember.user)
    ).filter(UserGroup.invite_token == token).first()
    if not group:
        raise HTTPException(404, "Link inválido ou expirado")
    return {
        "group_id": group.id,
        "group_name": group.name,
        "member_count": len(group.members),
    }


@router.post("/join/{token}")
def join_group_by_token(
    token: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.invite_token == token).first()
    if not group:
        raise HTTPException(404, "Link inválido ou expirado")
    existing = db.query(UserGroupMember).filter(
        UserGroupMember.group_id == group.id,
        UserGroupMember.user_id == user.id,
    ).first()
    if existing:
        raise HTTPException(409, "Você já faz parte deste grupo")
    db.add(UserGroupMember(group_id=group.id, user_id=user.id, is_owner=False))
    db.commit()
    return {"status": "joined", "group_id": group.id, "group_name": group.name}
