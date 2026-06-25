import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr
from datetime import timedelta

from sqlalchemy import case, desc, func, or_
from sqlalchemy.orm import Session, joinedload

from auth_utils import get_current_user
from database import get_db
from models import Bet, GroupInviteStatus, GroupMessage, Match, MatchPhase, MatchStatus, Ranking, Team, User, UserGroup, UserGroupInvite, UserGroupMember
from routers.audit import log_action

router = APIRouter(prefix="/user-groups", tags=["user-groups"])


class UserGroupCreate(BaseModel):
    name: str


class GroupInviteCreate(BaseModel):
    user_id: int | None = None
    email: EmailStr | None = None


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    masked_local = local[0] + "*" * min(len(local) - 1, 4) if len(local) > 1 else local
    parts = domain.split(".")
    masked_domain = parts[0][0] + "*" * max(len(parts[0]) - 1, 1) + "." + ".".join(parts[1:]) if len(parts) > 1 else domain
    return f"{masked_local}@{masked_domain}"


def _group_payload(group: UserGroup, ranking_map: dict | None = None, recent_form_map: dict | None = None) -> dict:
    accepted_members = sorted(group.members, key=lambda member: (not member.is_owner, member.user.name.lower() if member.user else ""))
    pending_invites = [
        invite for invite in group.invites
        if invite.status == GroupInviteStatus.pending
    ]
    members_out = []
    total_bets_g = total_exacts_g = 0
    for member in accepted_members:
        pts = exact = bets = correct = 0
        if ranking_map and member.user_id in ranking_map:
            pts, exact, bets, correct = ranking_map[member.user_id]
        total_bets_g += bets
        total_exacts_g += exact
        form = (recent_form_map or {}).get(member.user_id, [])
        members_out.append({
            "id": member.id,
            "user_id": member.user_id,
            "name": member.user.name if member.user else "",
            "email_masked": _mask_email(member.user.email if member.user else ""),
            "is_owner": member.is_owner,
            "joined_at": member.joined_at,
            "total_points": pts,
            "exact_scores": exact,
            "total_bets": bets,
            "correct_results": correct,
            "recent_form": form,
        })
    member_count = len(accepted_members)
    group_xp = total_bets_g * 10 + total_exacts_g * 20 + member_count * 50
    group_level = max(1, group_xp // 500 + 1)
    return {
        "id": group.id,
        "name": group.name,
        "owner_user_id": group.owner_user_id,
        "created_at": group.created_at,
        "invite_token": group.invite_token,
        "members": members_out,
        "group_xp": group_xp,
        "group_level": group_level,
        "group_level_xp_next": group_level * 500,
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
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    memberships = (
        db.query(UserGroupMember)
        .options(
            joinedload(UserGroupMember.group).joinedload(UserGroup.members).joinedload(UserGroupMember.user),
            joinedload(UserGroupMember.group).joinedload(UserGroup.invites),
        )
        .filter(UserGroupMember.user_id == user.id)
        .all()
    )
    all_member_ids: set[int] = set()
    for m in memberships:
        if m.group:
            for gm in m.group.members:
                all_member_ids.add(gm.user_id)

    ranking_map: dict = {}
    recent_form_map: dict = {}

    if all_member_ids:
        bet_counts = (
            db.query(Bet.user_id, func.count(Bet.id).label("total_bets"))
            .filter(Bet.user_id.in_(all_member_ids))
            .group_by(Bet.user_id)
            .subquery()
        )
        ranking_rows = (
            db.query(
                User.id.label("user_id"),
                func.coalesce(Ranking.total_points, 0).label("total_points"),
                func.coalesce(Ranking.exact_scores, 0).label("exact_scores"),
                func.coalesce(bet_counts.c.total_bets, 0).label("total_bets"),
                func.coalesce(Ranking.correct_results, 0).label("correct_results"),
            )
            .outerjoin(Ranking, User.id == Ranking.user_id)
            .outerjoin(bet_counts, User.id == bet_counts.c.user_id)
            .filter(User.id.in_(all_member_ids))
            .all()
        )
        ranking_map = {
            r.user_id: (r.total_points or 0, r.exact_scores or 0, r.total_bets or 0, r.correct_results or 0)
            for r in ranking_rows
        }

        # Recent form (last 5 finished bets per user)
        recent_bets_raw = (
            db.query(Bet.user_id, Bet.points_earned)
            .join(Match, Bet.match_id == Match.id)
            .filter(Bet.user_id.in_(all_member_ids), Match.status == MatchStatus.finished)
            .order_by(Bet.user_id, Match.match_date.asc())
            .all()
        )
        user_bets_asc: dict[int, list[int]] = {}
        for b in recent_bets_raw:
            user_bets_asc.setdefault(b.user_id, []).append(b.points_earned)
        for uid, bets_list in user_bets_asc.items():
            form = []
            for pts in reversed(bets_list):
                if len(form) >= 5:
                    break
                form.append("E" if pts == 3 else "C" if pts == 1 else "X")
            recent_form_map[uid] = form

    groups = [_group_payload(member.group, ranking_map, recent_form_map) for member in memberships if member.group]

    # Next scheduled match + whether current user has bet on it
    next_match_db = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.status == MatchStatus.scheduled, Match.match_date > now)
        .order_by(Match.match_date.asc())
        .first()
    )
    next_match_out = None
    my_bet_next = False
    if next_match_db:
        next_match_out = {
            "id": next_match_db.id,
            "match_date": next_match_db.match_date.isoformat() if next_match_db.match_date else None,
            "team_a": {"name": next_match_db.team_a.name, "code": next_match_db.team_a.code} if next_match_db.team_a else {},
            "team_b": {"name": next_match_db.team_b.name, "code": next_match_db.team_b.code} if next_match_db.team_b else {},
        }
        my_bet_next = bool(
            db.query(Bet.id)
            .filter(Bet.match_id == next_match_db.id, Bet.user_id == user.id)
            .first()
        )

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
    return {"groups": groups, "pending_invites": pending_invites, "next_match": next_match_out, "my_bet_next": my_bet_next}


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
    log_action(db, user.id, "group.create", {"group_id": group.id, "group_name": group.name})
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
        {"id": row.id, "name": row.name, "email_masked": _mask_email(row.email)}
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
    db.flush()
    log_action(db, user.id, "group.invite_sent", {
        "group_id": group_id,
        "invite_id": invite.id,
        "invitee_email": invitee_email,
    })
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
    invite.responded_at = datetime.now(timezone.utc).replace(tzinfo=None)
    log_action(db, user.id, "group.invite_accept", {"group_id": invite.group_id, "invite_id": invite.id})
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
    invite.responded_at = datetime.now(timezone.utc).replace(tzinfo=None)
    log_action(db, user.id, "group.invite_reject", {"group_id": invite.group_id, "invite_id": invite.id})
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

    members = db.query(UserGroupMember).filter(UserGroupMember.group_id == group_id).all()
    member_ids = [m.user_id for m in members]
    if user.id not in member_ids:
        raise HTTPException(403, "Você não faz parte deste grupo")

    # ── Champion bonus ────────────────────────────────────────
    final_match = (
        db.query(Match)
        .options(joinedload(Match.result))
        .filter(Match.phase == MatchPhase.final, Match.status == MatchStatus.finished)
        .first()
    )
    champion_team_id = None
    champion_team = None
    if final_match and final_match.result:
        if final_match.result.result == "a":
            champion_team_id = final_match.team_a_id
        elif final_match.result.result == "b":
            champion_team_id = final_match.team_b_id
        if champion_team_id:
            champion_team = db.query(Team).filter(Team.id == champion_team_id).first()

    picks_map = {m.user_id: m.champion_pick_team_id for m in members}
    correct_pickers = {uid for uid, pick in picks_map.items() if pick == champion_team_id} if champion_team_id else set()
    count_correct = len(correct_pickers)
    total_members = len(member_ids)
    # Proportional: fewer correct pickers → bigger bonus. Floor 10, inverse scale.
    champion_bonus_pts = min(100, round(10 * total_members / count_correct)) if count_correct > 0 else 0

    # ── Ranking query ─────────────────────────────────────────
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
        .all()
    )

    def effective_pts(r):
        bonus = champion_bonus_pts if r.user_id in correct_pickers else 0
        return (int(r.total_points or 0) + bonus, int(r.exact_scores or 0), int(r.total_bets or 0))

    rows_sorted = sorted(rows, key=lambda r: effective_pts(r), reverse=True)

    return {
        "group_id": group.id,
        "group_name": group.name,
        "is_owner": group.owner_user_id == user.id,
        "champion": {
            "team_id": champion_team_id,
            "name": champion_team.name if champion_team else None,
            "code": champion_team.code if champion_team else None,
            "flag_url": champion_team.flag_url if champion_team else None,
        } if champion_team_id else None,
        "champion_bonus_pts": champion_bonus_pts,
        "ranking": [
            {
                "position": i + 1,
                "user_id": r.user_id,
                "name": r.name,
                "total_points": int(r.total_points or 0),
                "exact_scores": int(r.exact_scores or 0),
                "correct_results": int(r.correct_results or 0),
                "total_bets": int(r.total_bets or 0),
                "champion_bonus": champion_bonus_pts if r.user_id in correct_pickers else 0,
                "effective_points": int(r.total_points or 0) + (champion_bonus_pts if r.user_id in correct_pickers else 0),
                "is_me": r.user_id == user.id,
                "is_owner": r.user_id == group.owner_user_id,
            }
            for i, r in enumerate(rows_sorted)
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
    log_action(db, user.id, "group.join", {"group_id": group.id, "group_name": group.name})
    db.commit()
    return {"status": "joined", "group_id": group.id, "group_name": group.name}


# ── Rename group ──────────────────────────────────────────────────────────────

class GroupRename(BaseModel):
    name: str


@router.put("/{group_id}")
def rename_group(
    group_id: int,
    payload: GroupRename,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    if group.owner_user_id != user.id:
        raise HTTPException(403, "Apenas o dono pode renomear o grupo")
    name = payload.name.strip()
    if len(name) < 3:
        raise HTTPException(400, "Nome deve ter ao menos 3 caracteres")
    old_name = group.name
    group.name = name[:120]
    log_action(db, user.id, "group.rename", {"group_id": group.id, "from": old_name, "to": name},
               request.client.host if request.client else None)
    db.commit()
    return {"id": group.id, "name": group.name}


# ── Leave group (non-owner) ───────────────────────────────────────────────────

@router.delete("/{group_id}/leave")
def leave_group(
    group_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    if group.owner_user_id == user.id:
        raise HTTPException(400, "O dono não pode sair do grupo — transfira a propriedade ou exclua o grupo")
    member = db.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == user.id,
    ).first()
    if not member:
        raise HTTPException(404, "Você não faz parte deste grupo")
    log_action(db, user.id, "group.leave", {"group_id": group_id, "group_name": group.name},
               request.client.host if request.client else None)
    db.delete(member)
    db.commit()
    return {"status": "left", "group_id": group_id}


# ── Delete group ──────────────────────────────────────────────────────────────

@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    if group.owner_user_id != user.id:
        raise HTTPException(403, "Apenas o dono pode excluir o grupo")
    log_action(db, user.id, "group.delete", {"group_id": group.id, "group_name": group.name},
               request.client.host if request.client else None)
    db.delete(group)
    db.commit()
    return {"status": "deleted", "group_id": group_id}


# ── Remove member ─────────────────────────────────────────────────────────────

@router.delete("/{group_id}/members/{target_user_id}")
def remove_member(
    group_id: int,
    target_user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    if group.owner_user_id != user.id:
        raise HTTPException(403, "Apenas o dono pode remover membros")
    if target_user_id == user.id:
        raise HTTPException(400, "O dono não pode se remover do grupo")
    member = db.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == target_user_id,
    ).first()
    if not member:
        raise HTTPException(404, "Membro não encontrado")
    target = db.query(User).filter(User.id == target_user_id).first()
    log_action(db, user.id, "group.remove_member",
               {"group_id": group_id, "removed_user_id": target_user_id,
                "removed_user_name": target.name if target else None},
               request.client.host if request.client else None)
    db.delete(member)
    db.commit()
    return {"status": "removed", "user_id": target_user_id}


# ── Cancel pending invite (owner only) ───────────────────────────────────────

@router.delete("/{group_id}/invites/{invite_id}")
def cancel_invite(
    group_id: int,
    invite_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    if group.owner_user_id != user.id:
        raise HTTPException(403, "Apenas o dono pode cancelar convites")
    invite = db.query(UserGroupInvite).filter(
        UserGroupInvite.id == invite_id,
        UserGroupInvite.group_id == group_id,
        UserGroupInvite.status == GroupInviteStatus.pending,
    ).first()
    if not invite:
        raise HTTPException(404, "Convite pendente não encontrado")
    log_action(db, user.id, "group.cancel_invite",
               {"group_id": group_id, "invite_id": invite_id, "invitee_email": invite.invitee_email})
    db.delete(invite)
    db.commit()
    return {"status": "cancelled", "invite_id": invite_id}


# ── Highlights do grupo ───────────────────────────────────────────────────────

@router.get("/{group_id}/highlights")
def group_highlights(
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

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    week_ago = now - timedelta(days=7)

    # Member names (single query reused throughout)
    members_with_names = {
        r.id: r.name for r in db.query(User.id, User.name).filter(User.id.in_(member_ids)).all()
    }

    # Próximo jogo aberto
    next_match = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.status == MatchStatus.scheduled, Match.match_date > now)
        .order_by(Match.match_date.asc())
        .first()
    )

    next_match_out = None
    members_bet_next = []
    members_no_bet_next = []

    if next_match:
        next_match_out = {
            "id": next_match.id,
            "match_date": next_match.match_date.isoformat() if next_match.match_date else None,
            "team_a": {"name": next_match.team_a.name, "code": next_match.team_a.code, "flag_url": next_match.team_a.flag_url} if next_match.team_a else {},
            "team_b": {"name": next_match.team_b.name, "code": next_match.team_b.code, "flag_url": next_match.team_b.flag_url} if next_match.team_b else {},
            "group_name": next_match.group_name,
        }
        bet_user_ids = {
            r[0] for r in db.query(Bet.user_id)
            .filter(Bet.match_id == next_match.id, Bet.user_id.in_(member_ids)).all()
        }
        members_bet_next = [{"user_id": uid, "name": members_with_names.get(uid, "")} for uid in member_ids if uid in bet_user_ids]
        members_no_bet_next = [{"user_id": uid, "name": members_with_names.get(uid, "")} for uid in member_ids if uid not in bet_user_ids]

    # Combined bet data for streaks + recent form (single query, asc order)
    all_bets_data = (
        db.query(Bet.user_id, Bet.points_earned, Match.match_date)
        .join(Match, Bet.match_id == Match.id)
        .filter(Bet.user_id.in_(member_ids), Match.status == MatchStatus.finished)
        .order_by(Bet.user_id, Match.match_date.asc())
        .all()
    )
    user_bets_asc: dict[int, list[int]] = {}
    for b in all_bets_data:
        user_bets_asc.setdefault(b.user_id, []).append(b.points_earned)

    # Streaks (ascending order — counts consecutive 3-pt runs)
    streak_list = []
    for uid, bets_list in user_bets_asc.items():
        max_streak = cur = 0
        for pts in bets_list:
            if pts == 3:
                cur += 1
                max_streak = max(max_streak, cur)
            else:
                cur = 0
        if max_streak > 0:
            streak_list.append({"user_id": uid, "name": members_with_names.get(uid, ""), "streak": max_streak})
    streak_list.sort(key=lambda x: -x["streak"])

    # Recent form per user (last 5 bets, most recent first)
    recent_form: dict[int, list[str]] = {}
    for uid, bets_list in user_bets_asc.items():
        form: list[str] = []
        for pts in reversed(bets_list):
            if len(form) >= 5:
                break
            form.append("E" if pts == 3 else "C" if pts == 1 else "X")
        recent_form[uid] = form

    # Weekly ranking (last 7 days)
    weekly_rows = (
        db.query(Bet.user_id, func.sum(Bet.points_earned).label("pts_week"))
        .join(Match, Bet.match_id == Match.id)
        .filter(
            Bet.user_id.in_(member_ids),
            Match.status == MatchStatus.finished,
            Match.match_date >= week_ago,
        )
        .group_by(Bet.user_id)
        .order_by(desc(func.sum(Bet.points_earned)))
        .all()
    )
    weekly_ranking = [
        {"user_id": r.user_id, "name": members_with_names.get(r.user_id, ""), "pts_week": int(r.pts_week or 0)}
        for r in weekly_rows
    ]

    # Top 3 most audacious bets (highest combined score)
    top_bets_rows = (
        db.query(
            Bet.user_id, Bet.score_a, Bet.score_b,
            User.name.label("user_name"),
            Match.group_name,
        )
        .join(User, Bet.user_id == User.id)
        .join(Match, Bet.match_id == Match.id)
        .filter(Bet.user_id.in_(member_ids), Match.status == MatchStatus.finished)
        .order_by(desc(Bet.score_a + Bet.score_b), desc(Bet.score_a))
        .limit(3)
        .all()
    )
    top_bets = [
        {"score_a": r.score_a, "score_b": r.score_b, "user_name": r.user_name, "group": r.group_name}
        for r in top_bets_rows
    ]

    # Group XP & level (based on all bets by members)
    xp_row = (
        db.query(
            func.count(Bet.id).label("total_bets"),
            func.sum(case((Bet.points_earned == 3, 1), else_=0)).label("total_exacts"),
        )
        .filter(Bet.user_id.in_(member_ids))
        .first()
    )
    total_bets_all = int(xp_row.total_bets or 0) if xp_row else 0
    total_exacts_all = int(xp_row.total_exacts or 0) if xp_row else 0
    group_xp = total_bets_all * 10 + total_exacts_all * 20 + len(member_ids) * 50
    group_level = max(1, group_xp // 500 + 1)
    next_level_xp = group_level * 500

    return {
        "next_match": next_match_out,
        "members_bet_next": members_bet_next,
        "members_no_bet_next": members_no_bet_next,
        "top_bet": top_bets[0] if top_bets else None,
        "top_bets": top_bets,
        "streaks": streak_list,
        "recent_form": recent_form,
        "weekly_ranking": weekly_ranking,
        "group_xp": group_xp,
        "group_level": group_level,
        "next_level_xp": next_level_xp,
    }


# ── Apostas reveladas (bets de todos os membros num jogo) ─────────────────────

@router.get("/{group_id}/matches/{match_id}/bets")
def group_match_bets(
    group_id: int,
    match_id: int,
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
    match = db.query(Match).filter(Match.id == match_id).first()
    if not match:
        raise HTTPException(404, "Partida não encontrada")
    if match.status != MatchStatus.finished:
        raise HTTPException(400, "Apostas só reveladas após o jogo encerrar")
    bets = (
        db.query(Bet, User.name)
        .join(User, Bet.user_id == User.id)
        .filter(Bet.match_id == match_id, Bet.user_id.in_(member_ids))
        .order_by(desc(Bet.points_earned), Bet.score_a + Bet.score_b)
        .all()
    )
    return [
        {
            "user_id": bet.user_id,
            "name": name,
            "score_a": bet.score_a,
            "score_b": bet.score_b,
            "points_earned": bet.points_earned,
            "is_me": bet.user_id == user.id,
        }
        for bet, name in bets
    ]


# ── Partidas recentes do grupo (para apostas reveladas) ───────────────────────

@router.get("/{group_id}/recent-matches")
def group_recent_matches(
    group_id: int,
    limit: int = Query(default=5, le=20),
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
    matches = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
        .filter(Match.status == MatchStatus.finished)
        .order_by(desc(Match.match_date))
        .limit(limit)
        .all()
    )
    return [
        {
            "id": m.id,
            "match_date": m.match_date.isoformat() if m.match_date else None,
            "team_a": {"name": m.team_a.name, "code": m.team_a.code, "flag_url": m.team_a.flag_url} if m.team_a else {},
            "team_b": {"name": m.team_b.name, "code": m.team_b.code, "flag_url": m.team_b.flag_url} if m.team_b else {},
            "result": {"score_a": m.result.score_a, "score_b": m.result.score_b} if m.result else None,
            "phase": m.phase.value if m.phase else None,
        }
        for m in matches
    ]


# ── Pick do campeão ───────────────────────────────────────────────────────────

class ChampionPickBody(BaseModel):
    team_id: int


@router.get("/{group_id}/champion")
def get_champion_picks(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    members = (
        db.query(UserGroupMember)
        .options(
            joinedload(UserGroupMember.user),
            joinedload(UserGroupMember.champion_pick),
        )
        .filter(UserGroupMember.group_id == group_id)
        .all()
    )
    if not any(m.user_id == user.id for m in members):
        raise HTTPException(403, "Você não faz parte deste grupo")
    return [
        {
            "user_id": m.user_id,
            "name": m.user.name if m.user else "",
            "is_me": m.user_id == user.id,
            "champion": {
                "id": m.champion_pick.id,
                "name": m.champion_pick.name,
                "code": m.champion_pick.code,
                "flag_url": m.champion_pick.flag_url,
            } if m.champion_pick else None,
        }
        for m in members
    ]


@router.post("/{group_id}/champion")
def set_champion_pick(
    group_id: int,
    body: ChampionPickBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = db.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == user.id,
    ).first()
    if not member:
        raise HTTPException(403, "Você não faz parte deste grupo")
    team = db.query(Team).filter(Team.id == body.team_id).first()
    if not team:
        raise HTTPException(404, "Time não encontrado")
    member.champion_pick_team_id = body.team_id
    log_action(db, user.id, "group.champion_pick", {"group_id": group_id, "team_id": body.team_id, "team": team.name})
    db.commit()
    return {"team_id": body.team_id, "team_name": team.name, "team_code": team.code}


# ── Chat do bolão ─────────────────────────────────────────────────────────────

class MessageBody(BaseModel):
    content: str


@router.get("/{group_id}/messages")
def get_messages(
    group_id: int,
    limit: int = Query(default=30, le=100),
    before_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = db.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == user.id,
    ).first()
    if not member:
        raise HTTPException(403, "Você não faz parte deste grupo")
    q = db.query(GroupMessage).options(joinedload(GroupMessage.user)).filter(
        GroupMessage.group_id == group_id
    )
    if before_id:
        q = q.filter(GroupMessage.id < before_id)
    messages = q.order_by(desc(GroupMessage.id)).limit(limit).all()
    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "name": m.user.name if m.user else "",
            "content": m.content,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "is_me": m.user_id == user.id,
        }
        for m in reversed(messages)
    ]


@router.post("/{group_id}/messages", status_code=201)
def post_message(
    group_id: int,
    body: MessageBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = db.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == user.id,
    ).first()
    if not member:
        raise HTTPException(403, "Você não faz parte deste grupo")
    content = body.content.strip()
    if not content or len(content) > 500:
        raise HTTPException(400, "Mensagem deve ter entre 1 e 500 caracteres")
    msg = GroupMessage(group_id=group_id, user_id=user.id, content=content)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return {
        "id": msg.id,
        "user_id": msg.user_id,
        "name": user.name,
        "content": msg.content,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
        "is_me": True,
    }


# ── Evolução de posições ──────────────────────────────────────────────────────

@router.get("/{group_id}/evolution")
def group_evolution(
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

    members_names = {
        r.id: r.name for r in db.query(User.id, User.name).filter(User.id.in_(member_ids)).all()
    }

    # All finished matches ordered by date
    finished_matches = (
        db.query(Match.id, Match.match_date)
        .filter(Match.status == MatchStatus.finished)
        .order_by(Match.match_date.asc())
        .all()
    )
    if not finished_matches:
        return {"labels": [], "series": []}

    # All bets by group members on finished matches
    all_bets = (
        db.query(Bet.user_id, Bet.match_id, Bet.points_earned)
        .filter(Bet.user_id.in_(member_ids), Bet.match_id.in_([m.id for m in finished_matches]))
        .all()
    )
    pts_by_user_match: dict[int, dict[int, int]] = {uid: {} for uid in member_ids}
    for b in all_bets:
        pts_by_user_match[b.user_id][b.match_id] = b.points_earned

    # Build cumulative points per match checkpoint (every 3 matches)
    step = max(1, len(finished_matches) // 10)
    checkpoints = finished_matches[step - 1::step]
    if not checkpoints or checkpoints[-1].id != finished_matches[-1].id:
        checkpoints = list(checkpoints) + [finished_matches[-1]]

    match_id_set_upto: list[set] = []
    for cp in checkpoints:
        cp_idx = next(i for i, m in enumerate(finished_matches) if m.id == cp.id)
        match_id_set_upto.append({m.id for m in finished_matches[: cp_idx + 1]})

    labels = [
        cp.match_date.strftime("%d/%m") if cp.match_date else f"J{i+1}"
        for i, cp in enumerate(checkpoints)
    ]

    series = []
    for uid in member_ids:
        pts_timeline = []
        for match_set in match_id_set_upto:
            total = sum(pts_by_user_match[uid].get(mid, 0) for mid in match_set)
            pts_timeline.append(total)
        # Compute positions at each checkpoint
        pos_timeline = []
        for ci, match_set in enumerate(match_id_set_upto):
            scores = {u: sum(pts_by_user_match[u].get(mid, 0) for mid in match_set) for u in member_ids}
            sorted_uids = sorted(member_ids, key=lambda u: -scores[u])
            pos = sorted_uids.index(uid) + 1
            pos_timeline.append(pos)
        series.append({
            "user_id": uid,
            "name": members_names.get(uid, ""),
            "is_me": uid == user.id,
            "pts": pts_timeline,
            "positions": pos_timeline,
        })

    return {"labels": labels, "series": series}


# ── Ranking por fase ──────────────────────────────────────────────────────────

@router.get("/{group_id}/ranking-phase")
def group_ranking_by_phase(
    group_id: int,
    phase: str = Query(default="all"),
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

    q = (
        db.query(
            Bet.user_id,
            User.name,
            func.sum(Bet.points_earned).label("total_points"),
            func.sum(case((Bet.points_earned == 3, 1), else_=0)).label("exact_scores"),
            func.sum(case((Bet.points_earned == 1, 1), else_=0)).label("correct_results"),
            func.count(Bet.id).label("total_bets"),
        )
        .join(User, Bet.user_id == User.id)
        .join(Match, Bet.match_id == Match.id)
        .filter(Bet.user_id.in_(member_ids), Match.status == MatchStatus.finished)
    )
    if phase != "all":
        try:
            q = q.filter(Match.phase == MatchPhase(phase))
        except ValueError:
            raise HTTPException(400, f"Fase inválida: {phase}")
    rows = (
        q.group_by(Bet.user_id, User.name)
        .order_by(desc(func.sum(Bet.points_earned)), desc(func.sum(case((Bet.points_earned == 3, 1), else_=0))))
        .all()
    )
    return [
        {
            "position": i + 1,
            "user_id": r.user_id,
            "name": r.name,
            "total_points": int(r.total_points or 0),
            "exact_scores": int(r.exact_scores or 0),
            "correct_results": int(r.correct_results or 0),
            "total_bets": int(r.total_bets or 0),
            "is_me": r.user_id == user.id,
        }
        for i, r in enumerate(rows)
    ]
