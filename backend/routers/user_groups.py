import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr
from datetime import timedelta

from sqlalchemy import case, desc, func, or_, and_
from sqlalchemy.orm import Session, joinedload

from auth_utils import get_current_user
from competitions import get_competition_id
from database import get_db
from models import (
    Bet, Competition, GroupClassificationBet, GroupDoubleMatch, GroupFeatureConfig, GroupInviteStatus,
    GroupLanterna, GroupMessage, GroupMonthlyBonus, Match, MatchPhase, MatchResult, MatchStatus,
    Notification, Ranking, Team, User, UserGroup, UserGroupInvite, UserGroupJoinRequest, UserGroupMember,
)
from routers.audit import log_action
from routers.report import notify_new_group_telegram

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
    if domain == "squad.predicts.local":
        # Conta interna (Bot Squad): máscara fabricada neutra — o domínio real
        # não roteável denunciaria a conta em payloads de grupo/busca.
        return f"{local[0]}****@g****.com"
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
    pending_join_requests = [
        req for req in group.join_requests
        if req.status == GroupInviteStatus.pending
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
            "username": member.user.username if member.user else None,
            "email_masked": _mask_email(member.user.email if member.user else ""),
            "is_owner": member.is_owner,
            "joined_at": member.joined_at,
            "total_points": pts,
            "exact_scores": exact,
            "total_bets": bets,
            "correct_results": correct,
            "recent_form": form,
            "invited_by_user_id": member.invited_by_user_id,
            "invited_by_name": member.invited_by.name if member.invited_by else None,
            "invited_by_username": member.invited_by.username if member.invited_by else None,
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
        "pending_join_requests": [
            {
                "id": req.id,
                "user_id": req.user_id,
                "name": req.user.name if req.user else "",
                "username": req.user.username if req.user else None,
                "email_masked": _mask_email(req.user.email if req.user else ""),
                "invited_by_user_id": req.invited_by_user_id,
                "invited_by_name": req.invited_by.name if req.invited_by else None,
                "invited_by_username": req.invited_by.username if req.invited_by else None,
                "created_at": req.created_at,
            }
            for req in pending_join_requests
        ],
    }


def _load_group(group_id: int, db: Session) -> UserGroup | None:
    return (
        db.query(UserGroup)
        .options(
            joinedload(UserGroup.members).joinedload(UserGroupMember.user),
            joinedload(UserGroup.members).joinedload(UserGroupMember.invited_by),
            joinedload(UserGroup.invites),
            joinedload(UserGroup.join_requests).joinedload(UserGroupJoinRequest.user),
            joinedload(UserGroup.join_requests).joinedload(UserGroupJoinRequest.invited_by),
        )
        .filter(UserGroup.id == group_id)
        .first()
    )


def _ensure_group_owner(group: UserGroup, user: User) -> None:
    if group.owner_user_id != user.id:
        raise HTTPException(403, "Somente o dono do grupo pode gerenciar convites")


# ── Mecânicas extras de bolão (config + bônus classificação + dobro + lanterna + mensal) ──
# Overlay aditivo por cima do Ranking/Bet globais — nunca escreve neles. Escopo
# de EFEITO é só Brasileirão (aplicado em group_ranking() só quando
# competition == 'brasileirao2026', passo 12); a config em si não é presa a
# competição (grupo não tem competição fixa) — decisão técnica de
# implementação (documentada, não travada por endpoint) pra não reintroduzir
# o conceito de "competição do grupo" que não existe hoje. Ver plan.md em
# /root/.dev-plans/predicts-grupos-bonus/.

def _default_feature_config() -> dict:
    return {
        "classification_bonus": {
            "enabled": False,
            "pts_per_hit": 3,
        },
        "double_match": {
            "enabled": False,
            # seed default = par pedido originalmente (Cruzeiro x Atlético-MG),
            # lista CONFIGURÁVEL pelo dono — não é regra fixa (ver plan.md decisão 3)
            "auto_double_derbies": [["CRU", "CAM"]],
        },
        "lanterna": {
            "enabled": False,
            "pix_value": 10.0,
            "fund_split": [50, 30, 20],
        },
        "monthly_bonus": {
            "enabled": False,
            "pts_by_rank": {"1": 6, "2": 3, "3": 1},
            "credits_by_rank": {"1": {"pe": 2}, "2": {"pe": 1}, "3": {"ve": 1}},
        },
        "notifications_enabled": True,
    }


def _merge_feature_config(base: dict, patch: dict) -> dict:
    """Merge raso recursivo — só mescla chaves que já existem no default
    (proteção extra além do `extra=forbid` do Pydantic)."""
    result = dict(base)
    for k, v in patch.items():
        if k not in result:
            continue
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _merge_feature_config(result[k], v)
        else:
            result[k] = v
    return result


def _get_feature_config(db: Session, group_id: int) -> dict:
    row = db.query(GroupFeatureConfig).filter(GroupFeatureConfig.group_id == group_id).first()
    config = _default_feature_config()
    if row and row.config:
        config = _merge_feature_config(config, row.config)
    return config


class _ClassificationBonusConfigPatch(BaseModel):
    model_config = {"extra": "forbid"}
    enabled: bool | None = None
    pts_per_hit: int | None = None


class _DoubleMatchConfigPatch(BaseModel):
    model_config = {"extra": "forbid"}
    enabled: bool | None = None
    auto_double_derbies: list[list[str]] | None = None


class _LanternaConfigPatch(BaseModel):
    model_config = {"extra": "forbid"}
    enabled: bool | None = None
    pix_value: float | None = None
    fund_split: list[int] | None = None


class _MonthlyBonusConfigPatch(BaseModel):
    model_config = {"extra": "forbid"}
    enabled: bool | None = None
    pts_by_rank: dict[str, int] | None = None
    credits_by_rank: dict[str, dict[str, int]] | None = None


class GroupFeatureConfigPatch(BaseModel):
    model_config = {"extra": "forbid"}
    classification_bonus: _ClassificationBonusConfigPatch | None = None
    double_match: _DoubleMatchConfigPatch | None = None
    lanterna: _LanternaConfigPatch | None = None
    monthly_bonus: _MonthlyBonusConfigPatch | None = None
    notifications_enabled: bool | None = None


@router.get("/{group_id}/feature-config")
def get_group_feature_config(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    is_member = (
        db.query(UserGroupMember)
        .filter(UserGroupMember.group_id == group_id, UserGroupMember.user_id == user.id)
        .first()
    )
    if not is_member:
        raise HTTPException(403, "Você não faz parte deste grupo")

    return {
        "group_id": group_id,
        "config": _get_feature_config(db, group_id),
        "is_owner": group.owner_user_id == user.id,
    }


@router.patch("/{group_id}/feature-config")
def patch_group_feature_config(
    group_id: int,
    payload: GroupFeatureConfigPatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    _ensure_group_owner(group, user)

    current = _get_feature_config(db, group_id)
    patch_dict = payload.model_dump(exclude_unset=True)

    if "double_match" in patch_dict and patch_dict["double_match"] and patch_dict["double_match"].get("auto_double_derbies") is not None:
        derbies = patch_dict["double_match"]["auto_double_derbies"]
        valid_codes = {t.code for t in db.query(Team.code).filter(Team.competition_id == get_competition_id(db, "brasileirao2026")).all()}
        for pair in derbies:
            if len(pair) != 2 or pair[0] == pair[1]:
                raise HTTPException(400, f"Par de clássico inválido: {pair}")
            for code in pair:
                if code.upper() not in valid_codes:
                    raise HTTPException(400, f"Código de clube inválido (não é clube do Brasileirão): {code}")

    merged = _merge_feature_config(current, patch_dict)

    row = db.query(GroupFeatureConfig).filter(GroupFeatureConfig.group_id == group_id).first()
    if not row:
        row = GroupFeatureConfig(group_id=group_id, config=merged)
        db.add(row)
    else:
        row.config = merged
    db.commit()
    db.refresh(row)
    log_action(db, user.id, "group_feature_config.update", {"group_id": group_id, "patch": patch_dict})

    return {"group_id": group_id, "config": row.config}


# ── Bônus de classificação do returno ────────────────────────────────────────

def _returno_deadline(db: Session) -> datetime | None:
    """MIN(match_date) da rodada 20 (1º jogo do returno) do Brasileirão — deadline
    do bônus de classificação. Calculado em runtime (não hardcoda "rodada 20" como
    data fixa), naive-UTC igual todo o resto do banco (ver `_match_now` em bets.py)."""
    comp_id = get_competition_id(db, "brasileirao2026")
    return (
        db.query(func.min(Match.match_date))
        .filter(Match.competition_id == comp_id, Match.match_number == 20)
        .scalar()
    )


def _now_naive_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _require_group_member(db: Session, group_id: int, user: User) -> UserGroup:
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    is_member = (
        db.query(UserGroupMember)
        .filter(UserGroupMember.group_id == group_id, UserGroupMember.user_id == user.id)
        .first()
    )
    if not is_member:
        raise HTTPException(403, "Você não faz parte deste grupo")
    return group


class ClassificationBetCreate(BaseModel):
    model_config = {"extra": "forbid"}
    team_ids: list[int]  # ordem = posição final palpitada, 1º ao último


@router.post("/{group_id}/classification-bet")
def save_classification_bet(
    group_id: int,
    payload: ClassificationBetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_group_member(db, group_id, user)

    deadline = _returno_deadline(db)
    if deadline and _now_naive_utc() > deadline:
        raise HTTPException(403, "Prazo do bônus de classificação encerrado (rodada 20 do returno já começou)")

    comp_id = get_competition_id(db, "brasileirao2026")
    # Não hardcoda "20" — usa a contagem real de clubes da competição (defensivo
    # contra mudança de formato em temporada futura, mesmo espírito do resto do projeto).
    valid_team_ids = {row[0] for row in db.query(Team.id).filter(Team.competition_id == comp_id).all()}
    total_teams = len(valid_team_ids)

    if len(payload.team_ids) != total_teams:
        raise HTTPException(400, f"Envie exatamente {total_teams} clubes ordenados (recebido {len(payload.team_ids)})")
    if len(set(payload.team_ids)) != len(payload.team_ids):
        raise HTTPException(400, "Palpite tem clube repetido")
    invalid = [tid for tid in payload.team_ids if tid not in valid_team_ids]
    if invalid:
        raise HTTPException(400, f"Clube(s) inválido(s) pro Brasileirão: {invalid}")

    db.query(GroupClassificationBet).filter(
        GroupClassificationBet.group_id == group_id,
        GroupClassificationBet.user_id == user.id,
    ).delete()
    for position, team_id in enumerate(payload.team_ids, start=1):
        db.add(GroupClassificationBet(
            group_id=group_id, user_id=user.id, team_id=team_id, predicted_position=position,
        ))
    db.commit()
    log_action(db, user.id, "group_classification_bet.save", {"group_id": group_id})

    return {"saved": True, "count": len(payload.team_ids)}


@router.get("/{group_id}/classification-bet")
def get_classification_bet(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_group_member(db, group_id, user)

    deadline = _returno_deadline(db)
    locked = bool(deadline and _now_naive_utc() > deadline)

    rows = (
        db.query(GroupClassificationBet)
        .filter(GroupClassificationBet.group_id == group_id, GroupClassificationBet.user_id == user.id)
        .order_by(GroupClassificationBet.predicted_position)
        .all()
    )

    return {
        "group_id": group_id,
        "deadline": deadline,
        "locked": locked,
        "has_bet": len(rows) > 0,
        "team_ids": [r.team_id for r in rows],
    }


def _final_standings_team_ids(db: Session, comp_id: int) -> list[int]:
    """Tabela final ordenada por posição (mesmo critério CBF/desempate de
    `routers/brasileirao.py::_build_table`/`_sort_key`, reusado aqui pra não
    duplicar a lógica de apuração)."""
    from routers.brasileirao import _build_table, _load_matches, _sort_key

    clubs = db.query(Team).filter(Team.competition_id == comp_id).all()
    matches = _load_matches(db, comp_id)
    table = _build_table(clubs, matches)
    club_by_id = {c.id: c for c in clubs}
    rows = [{"team_id": cid, "name": club_by_id[cid].name, **r} for cid, r in table.items()]
    rows.sort(key=_sort_key)
    return [r["team_id"] for r in rows]


def _classification_hits(db: Session, group_id: int, user_id: int) -> int:
    """Conta quantos clubes o usuário acertou a posição EXATA no bônus de
    classificação. Só apura com `competitions.status == 'finished'` pro
    Brasileirão (plan.md decisão 7) — antes disso não há posição final real pra
    comparar, retorna 0 (não é 'ninguém acertou ainda', é 'não apurável ainda')."""
    comp_id = get_competition_id(db, "brasileirao2026")
    comp = db.query(Competition).filter(Competition.id == comp_id).first()
    if not comp or comp.status != "finished":
        return 0

    final_order = _final_standings_team_ids(db, comp_id)
    final_position_by_team = {team_id: i + 1 for i, team_id in enumerate(final_order)}

    bets = (
        db.query(GroupClassificationBet)
        .filter(GroupClassificationBet.group_id == group_id, GroupClassificationBet.user_id == user_id)
        .all()
    )
    return sum(1 for b in bets if final_position_by_team.get(b.team_id) == b.predicted_position)


# ── Jogo em dobro ─────────────────────────────────────────────────────────────

def _find_auto_double_match(matches_da_rodada: list[Match], derby_pairs: list[list[str]]) -> tuple[Match | None, list[str] | None]:
    """Função pura: percorre a lista CONFIGURADA de clássicos (`config.
    auto_double_derbies`, não hardcoded) na ordem cadastrada = prioridade se
    mais de um clássico da lista cair na mesma rodada. `matches_da_rodada`
    precisa ter `team_a`/`team_b` carregados (joinedload). Retorna
    `(match, par_que_bateu)` ou `(None, None)`."""
    matches_by_pair: dict[frozenset, Match] = {}
    for m in matches_da_rodada:
        if not m.team_a or not m.team_b:
            continue
        matches_by_pair[frozenset((m.team_a.code, m.team_b.code))] = m
    for pair in derby_pairs:
        if len(pair) != 2:
            continue
        key = frozenset(code.upper() for code in pair)
        if key in matches_by_pair:
            return matches_by_pair[key], pair
    return None, None


def _load_rodada_matches(db: Session, comp_id: int, match_number: int) -> list[Match]:
    return (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.competition_id == comp_id, Match.match_number == match_number)
        .all()
    )


def _match_summary(match: Match | None) -> dict:
    if not match:
        return {"team_a": None, "team_b": None}
    return {
        "team_a": match.team_a.name if match.team_a else None,
        "team_b": match.team_b.name if match.team_b else None,
        "team_a_code": match.team_a.code if match.team_a else None,
        "team_b_code": match.team_b.code if match.team_b else None,
    }


@router.get("/{group_id}/double-match")
def get_double_match(
    group_id: int,
    rodada: int = Query(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_group_member(db, group_id, user)
    comp_id = get_competition_id(db, "brasileirao2026")
    config = _get_feature_config(db, group_id)
    derby_pairs = config["double_match"]["auto_double_derbies"]

    matches = _load_rodada_matches(db, comp_id, rodada)
    auto_match, auto_pair = _find_auto_double_match(matches, derby_pairs)

    if auto_match:
        return {
            "group_id": group_id, "match_number": rodada, "is_auto": True,
            "match_id": auto_match.id, "matched_pair": auto_pair,
            **_match_summary(auto_match),
        }

    row = (
        db.query(GroupDoubleMatch)
        .filter(GroupDoubleMatch.group_id == group_id, GroupDoubleMatch.match_number == rodada)
        .first()
    )
    if not row:
        return {"group_id": group_id, "match_number": rodada, "is_auto": False, "match_id": None, **_match_summary(None)}

    match = db.query(Match).options(joinedload(Match.team_a), joinedload(Match.team_b)).filter(Match.id == row.match_id).first()
    return {
        "group_id": group_id, "match_number": rodada, "is_auto": row.is_auto,
        "match_id": row.match_id, "set_by_user_id": row.set_by_user_id,
        **_match_summary(match),
    }


class DoubleMatchCreate(BaseModel):
    model_config = {"extra": "forbid"}
    match_number: int
    match_id: int


@router.post("/{group_id}/double-match")
def set_double_match(
    group_id: int,
    payload: DoubleMatchCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    _ensure_group_owner(group, user)

    comp_id = get_competition_id(db, "brasileirao2026")
    config = _get_feature_config(db, group_id)
    derby_pairs = config["double_match"]["auto_double_derbies"]

    matches = _load_rodada_matches(db, comp_id, payload.match_number)
    auto_match, auto_pair = _find_auto_double_match(matches, derby_pairs)
    if auto_match:
        raise HTTPException(
            409,
            f"Rodada {payload.match_number} já tem clássico automático "
            f"({auto_pair[0]} x {auto_pair[1]}) definindo o dobro — escolha manual bloqueada",
        )

    match = (
        db.query(Match)
        .filter(Match.id == payload.match_id, Match.competition_id == comp_id, Match.match_number == payload.match_number)
        .first()
    )
    if not match:
        raise HTTPException(400, "Partida inválida pra essa rodada do Brasileirão")

    row = (
        db.query(GroupDoubleMatch)
        .filter(GroupDoubleMatch.group_id == group_id, GroupDoubleMatch.match_number == payload.match_number)
        .first()
    )
    if row:
        row.match_id = payload.match_id
        row.is_auto = False
        row.set_by_user_id = user.id
    else:
        row = GroupDoubleMatch(
            group_id=group_id, match_number=payload.match_number, match_id=payload.match_id,
            is_auto=False, set_by_user_id=user.id,
        )
        db.add(row)
    db.commit()
    log_action(db, user.id, "group_double_match.set", {"group_id": group_id, "match_number": payload.match_number, "match_id": payload.match_id})

    return {"saved": True, "match_number": payload.match_number, "match_id": payload.match_id, "is_auto": False}


def _resolve_double_match_ids(db: Session, group_id: int, comp_id: int) -> list[int]:
    """1x por grupo: resolve quais `match_id` valem dobro, olhando só rodadas
    que já têm `MatchResult` (jogo aconteceu) — automático (config) tem
    prioridade sobre manual, mesma regra do GET/POST double-match."""
    config = _get_feature_config(db, group_id)
    derby_pairs = config["double_match"]["auto_double_derbies"]

    finished_match_numbers = {
        row[0] for row in (
            db.query(Match.match_number)
            .join(MatchResult, MatchResult.match_id == Match.id)
            .filter(Match.competition_id == comp_id, Match.match_number.isnot(None))
            .distinct()
            .all()
        )
    }
    if not finished_match_numbers:
        return []

    manual_by_rodada = {
        row.match_number: row.match_id
        for row in (
            db.query(GroupDoubleMatch)
            .filter(GroupDoubleMatch.group_id == group_id, GroupDoubleMatch.match_number.in_(finished_match_numbers))
            .all()
        )
    }

    double_match_ids: list[int] = []
    for rodada in finished_match_numbers:
        matches = _load_rodada_matches(db, comp_id, rodada)
        auto_match, _ = _find_auto_double_match(matches, derby_pairs)
        if auto_match:
            double_match_ids.append(auto_match.id)
        elif rodada in manual_by_rodada:
            double_match_ids.append(manual_by_rodada[rodada])
    return double_match_ids


def _double_match_bonus(db: Session, group_id: int, comp_id: int, user_id: int, double_match_ids: list[int] | None = None) -> int:
    """Bônus de pontos do jogo em dobro pro usuário: soma DE NOVO (efeito
    'dobrar') os pontos que ele já ganhou nas partidas marcadas como dobro
    naquele grupo, só nas rodadas já com `MatchResult`. `double_match_ids` pode
    vir pré-calculado (`_resolve_double_match_ids`, 1x por grupo) pra não
    refazer a resolução por membro num loop de ranking (passo 12)."""
    if double_match_ids is None:
        double_match_ids = _resolve_double_match_ids(db, group_id, comp_id)
    if not double_match_ids:
        return 0
    total = (
        db.query(func.coalesce(func.sum(func.coalesce(Bet.points_earned, 0) + func.coalesce(Bet.et_points_earned, 0)), 0))
        .filter(Bet.user_id == user_id, Bet.match_id.in_(double_match_ids))
        .scalar()
    )
    return int(total or 0)


# ── Lanterna da rodada: gestão (fundo, pix, vídeo) ──────────────────────────

def _group_top3_user_ids(db: Session, group_id: int, comp_id: int, config: dict | None = None) -> list[int]:
    """Top 3 do ranking GERAL do grupo, usado pra projeção do split do fundo
    do lanterna (decisão 6 do plan.md). Usa PONTOS EFETIVOS — mesma fórmula
    de `group_ranking()`/`effective_pts` (passo 12): `total_points +
    double_bonus + monthly_bonus_pts` — pra bater com o pódio real exibido
    em `/user-groups/{id}/ranking?competition=brasileirao2026`. Lanterna só
    existe pro Brasileirão (sem `champion_bonus`, que é só Copa) e
    `classification_hits` não soma pontos em `effective_pts` (só entra no
    critério de desempate), por isso fica de fora daqui também. Reaproveita
    `_resolve_double_match_ids`/`_double_match_bonus` e a query de
    `GroupMonthlyBonus`, sem duplicar lógica nova."""
    member_ids = [row[0] for row in db.query(UserGroupMember.user_id).filter(UserGroupMember.group_id == group_id).all()]
    if not member_ids:
        return []
    pts_by_user = dict.fromkeys(member_ids, 0)
    for uid, pts in (
        db.query(Ranking.user_id, Ranking.total_points)
        .filter(Ranking.user_id.in_(member_ids), Ranking.competition_id == comp_id)
        .all()
    ):
        pts_by_user[uid] = int(pts or 0)

    if config is None:
        config = _get_feature_config(db, group_id)

    if config["double_match"]["enabled"]:
        double_match_ids = _resolve_double_match_ids(db, group_id, comp_id)
        for uid in member_ids:
            pts_by_user[uid] += _double_match_bonus(db, group_id, comp_id, uid, double_match_ids)

    if config["monthly_bonus"]["enabled"]:
        for uid, pts in (
            db.query(GroupMonthlyBonus.user_id, func.sum(GroupMonthlyBonus.pts_awarded))
            .filter(GroupMonthlyBonus.group_id == group_id, GroupMonthlyBonus.user_id.in_(member_ids))
            .group_by(GroupMonthlyBonus.user_id)
            .all()
        ):
            pts_by_user[uid] += int(pts or 0)

    ordered = sorted(pts_by_user.items(), key=lambda kv: kv[1], reverse=True)
    return [uid for uid, _ in ordered[:3]]


@router.get("/{group_id}/lanterna")
def get_group_lanterna(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_group_member(db, group_id, user)
    comp_id = get_competition_id(db, "brasileirao2026")
    config = _get_feature_config(db, group_id)

    rows = (
        db.query(GroupLanterna)
        .filter(GroupLanterna.group_id == group_id)
        .order_by(GroupLanterna.match_number)
        .all()
    )
    all_user_ids = {uid for r in rows for uid in (r.user_ids or [])}
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(all_user_ids)).all()} if all_user_ids else {}

    history = []
    paid_count = 0
    pix_value = float(config["lanterna"]["pix_value"])
    for r in rows:
        entries = []
        for uid in (r.user_ids or []):
            paid = bool((r.pix_paid or {}).get(str(uid)))
            video = bool((r.video_confirmed or {}).get(str(uid)))
            if paid:
                paid_count += 1
            entries.append({
                "user_id": uid,
                "name": users_by_id[uid].name if uid in users_by_id else None,
                "pix_paid": paid,
                "video_confirmed": video,
            })
        history.append({"id": r.id, "match_number": r.match_number, "users": entries})

    fund_total = round(paid_count * pix_value, 2)
    split = config["lanterna"]["fund_split"]
    top3 = _group_top3_user_ids(db, group_id, comp_id, config)
    top3_users = {u.id: u for u in db.query(User).filter(User.id.in_(top3)).all()} if top3 else {}

    comp = db.query(Competition).filter(Competition.id == comp_id).first()
    is_final = bool(comp and comp.status == "finished")

    projection = [
        {
            "position": i + 1,
            "user_id": uid,
            "name": top3_users[uid].name if uid in top3_users else None,
            "pct": split[i] if i < len(split) else 0,
            "amount": round(fund_total * (split[i] if i < len(split) else 0) / 100, 2),
        }
        for i, uid in enumerate(top3)
    ]

    return {
        "group_id": group_id,
        "pix_value": pix_value,
        "fund_split": split,
        "fund_total": fund_total,
        "paid_count": paid_count,
        "is_final": is_final,
        "projection": projection,
        "history": history,
    }


class LanternaPatch(BaseModel):
    model_config = {"extra": "forbid"}
    user_id: int
    pix_paid: bool | None = None
    video_confirmed: bool | None = None


@router.patch("/{group_id}/lanterna/{lanterna_id}")
def patch_group_lanterna(
    group_id: int,
    lanterna_id: int,
    payload: LanternaPatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    _ensure_group_owner(group, user)

    row = db.query(GroupLanterna).filter(GroupLanterna.id == lanterna_id, GroupLanterna.group_id == group_id).first()
    if not row:
        raise HTTPException(404, "Linha de lanterna não encontrada")
    if payload.user_id not in (row.user_ids or []):
        raise HTTPException(400, "Esse usuário não é lanterna dessa rodada")

    pix_paid = dict(row.pix_paid or {})
    video_confirmed = dict(row.video_confirmed or {})
    key = str(payload.user_id)
    if payload.pix_paid is not None:
        pix_paid[key] = payload.pix_paid
    if payload.video_confirmed is not None:
        video_confirmed[key] = payload.video_confirmed
    row.pix_paid = pix_paid
    row.video_confirmed = video_confirmed
    db.commit()
    db.refresh(row)
    log_action(db, user.id, "group_lanterna.patch", {"group_id": group_id, "lanterna_id": lanterna_id, "user_id": payload.user_id})

    return {
        "id": row.id, "match_number": row.match_number, "user_ids": row.user_ids,
        "pix_paid": row.pix_paid, "video_confirmed": row.video_confirmed,
    }


@router.get("")
def list_user_groups(
    competition: str = Query("geral"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    is_general = competition == "geral"

    memberships = (
        db.query(UserGroupMember)
        .options(
            joinedload(UserGroupMember.group).joinedload(UserGroup.members).joinedload(UserGroupMember.user),
            joinedload(UserGroupMember.group).joinedload(UserGroup.members).joinedload(UserGroupMember.invited_by),
            joinedload(UserGroupMember.group).joinedload(UserGroup.invites),
            joinedload(UserGroupMember.group).joinedload(UserGroup.join_requests).joinedload(UserGroupJoinRequest.user),
            joinedload(UserGroupMember.group).joinedload(UserGroup.join_requests).joinedload(UserGroupJoinRequest.invited_by),
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
        bet_counts_q = db.query(Bet.user_id, func.count(Bet.id).label("total_bets")).filter(Bet.user_id.in_(all_member_ids))
        if not is_general:
            bet_counts_q = bet_counts_q.filter(Bet.competition_id == get_competition_id(db, competition))
        bet_counts = bet_counts_q.group_by(Bet.user_id).subquery()

        if is_general:
            ranking_rows = (
                db.query(
                    User.id.label("user_id"),
                    func.coalesce(func.sum(Ranking.total_points), 0).label("total_points"),
                    func.coalesce(func.sum(Ranking.exact_scores), 0).label("exact_scores"),
                    func.coalesce(bet_counts.c.total_bets, 0).label("total_bets"),
                    func.coalesce(func.sum(Ranking.correct_results), 0).label("correct_results"),
                )
                .outerjoin(Ranking, User.id == Ranking.user_id)
                .outerjoin(bet_counts, User.id == bet_counts.c.user_id)
                .filter(User.id.in_(all_member_ids))
                .group_by(User.id, bet_counts.c.total_bets)
                .all()
            )
        else:
            ranking_rows = (
                db.query(
                    User.id.label("user_id"),
                    func.coalesce(Ranking.total_points, 0).label("total_points"),
                    func.coalesce(Ranking.exact_scores, 0).label("exact_scores"),
                    func.coalesce(bet_counts.c.total_bets, 0).label("total_bets"),
                    func.coalesce(Ranking.correct_results, 0).label("correct_results"),
                )
                .outerjoin(Ranking, and_(User.id == Ranking.user_id, Ranking.competition_id == get_competition_id(db, competition)))
                .outerjoin(bet_counts, User.id == bet_counts.c.user_id)
                .filter(User.id.in_(all_member_ids))
                .all()
            )
        ranking_map = {
            r.user_id: (r.total_points or 0, r.exact_scores or 0, r.total_bets or 0, r.correct_results or 0)
            for r in ranking_rows
        }

        # Recent form (last 5 finished bets per user)
        recent_bets_raw_q = (
            db.query(Bet.user_id, Bet.points_earned)
            .join(Match, Bet.match_id == Match.id)
            .filter(Bet.user_id.in_(all_member_ids), Match.status == MatchStatus.finished)
        )
        if not is_general:
            recent_bets_raw_q = recent_bets_raw_q.filter(Bet.competition_id == get_competition_id(db, competition))
        recent_bets_raw = recent_bets_raw_q.order_by(Bet.user_id, Match.match_date.asc()).all()
        user_bets_asc: dict[int, list[int]] = {}
        for b in recent_bets_raw:
            user_bets_asc.setdefault(b.user_id, []).append(b.points_earned)
        for uid, bets_list in user_bets_asc.items():
            form = []
            for pts in reversed(bets_list):
                if len(form) >= 5:
                    break
                form.append("E" if pts == 25 else "C" if (pts or 0) > 0 else "X")
            recent_form_map[uid] = form

    groups = [_group_payload(member.group, ranking_map, recent_form_map) for member in memberships if member.group]

    # Next scheduled match + whether current user has bet on it
    # "geral" mostra o próximo jogo entre as competições; senão escopa na competição da aba
    # (senão o Brasileirão, que joga quase todo dia, aparece como "próximo jogo" na aba Copa).
    next_match_q = db.query(Match).options(joinedload(Match.team_a), joinedload(Match.team_b)).filter(
        Match.status == MatchStatus.scheduled, Match.match_date > now
    )
    if not is_general:
        next_match_q = next_match_q.filter(Match.competition_id == get_competition_id(db, competition))
    next_match_db = next_match_q.order_by(Match.match_date.asc()).first()
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
            "inviter_username": invite.inviter.username if invite.inviter else None,
            "created_at": invite.created_at,
        }
        for invite in invites
    ]
    return {"groups": groups, "pending_invites": pending_invites, "next_match": next_match_out, "my_bet_next": my_bet_next, "competition": competition}


@router.post("", status_code=201)
def create_group(
    payload: UserGroupCreate,
    background_tasks: BackgroundTasks,
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
    background_tasks.add_task(notify_new_group_telegram, group.name, user.name)
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

    # Notify invitee (if registered user)
    if invitee_user:
        db.add(Notification(
            user_id=invitee_user.id,
            type="group_invite",
            title=f"👥 Convite para '{group.name}'",
            body=f"{user.name} te convidou para entrar no bolão",
            meta={"group_id": group_id, "invite_id": invite.id, "group_name": group.name, "inviter_name": user.name},
        ))
        db.commit()
        try:
            from routers.push import send_push_to_users
            send_push_to_users(
                db, [invitee_user.id],
                f"👥 Convite para '{group.name}'",
                f"{user.name} te convidou para o bolão",
                "/meus-grupos",
            )
        except Exception:
            pass

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
    competition: str = Query("copa2026"),
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

    is_general = competition == "geral"

    # ── Champion bonus (só existe no palpite de campeão da Copa) ──
    champion_team_id = None
    champion_team = None
    correct_pickers = set()
    champion_bonus_pts = 0
    if competition == "copa2026":
        final_match = (
            db.query(Match)
            .options(joinedload(Match.result))
            .filter(Match.phase == MatchPhase.final, Match.status == MatchStatus.finished)
            .first()
        )
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
    bet_counts_q = db.query(Bet.user_id, func.count(Bet.id).label("total_bets")).filter(Bet.user_id.in_(member_ids))
    if not is_general:
        bet_counts_q = bet_counts_q.filter(Bet.competition_id == get_competition_id(db, competition))
    bet_counts = bet_counts_q.group_by(Bet.user_id).subquery()

    if is_general:
        # "Geral" = soma bruta entre competições, só curiosidade — sem bônus de campeão,
        # sem pretensão de pódio "oficial" (cada competição tem regra de pontuação própria).
        rows = (
            db.query(
                User.id.label("user_id"),
                User.name.label("name"),
                User.username.label("username"),
                User.favorite_team_code.label("favorite_team_code"),
                func.coalesce(func.sum(Ranking.total_points), 0).label("total_points"),
                func.coalesce(func.sum(Ranking.exact_scores), 0).label("exact_scores"),
                func.coalesce(func.sum(Ranking.correct_results), 0).label("correct_results"),
                func.coalesce(bet_counts.c.total_bets, 0).label("total_bets"),
            )
            .outerjoin(Ranking, User.id == Ranking.user_id)
            .outerjoin(bet_counts, User.id == bet_counts.c.user_id)
            .filter(User.id.in_(member_ids))
            .group_by(User.id, User.name, User.username, User.favorite_team_code, bet_counts.c.total_bets)
            .all()
        )
    else:
        rows = (
            db.query(
                User.id.label("user_id"),
                User.name.label("name"),
                User.username.label("username"),
                User.favorite_team_code.label("favorite_team_code"),
                func.coalesce(Ranking.total_points, 0).label("total_points"),
                func.coalesce(Ranking.exact_scores, 0).label("exact_scores"),
                func.coalesce(Ranking.correct_results, 0).label("correct_results"),
                func.coalesce(bet_counts.c.total_bets, 0).label("total_bets"),
            )
            .outerjoin(Ranking, and_(User.id == Ranking.user_id, Ranking.competition_id == get_competition_id(db, competition)))
            .outerjoin(bet_counts, User.id == bet_counts.c.user_id)
            .filter(User.id.in_(member_ids))
            .all()
        )

    fav_codes = {r.favorite_team_code for r in rows if r.favorite_team_code}
    team_by_code = (
        {t.code: t for t in db.query(Team).filter(Team.code.in_(fav_codes)).all()}
        if fav_codes else {}
    )

    # ── Mecânicas extras de bolão (passo 12) — overlay aditivo, SÓ Brasileirão.
    # Nunca escreve em Ranking/Bet globais — só lê GroupDoubleMatch/
    # GroupMonthlyBonus/GroupClassificationBet e soma por cima aqui, igual o
    # champion_bonus_pts acima (precedente que o plano pediu pra seguir).
    br_double_bonus: dict[int, int] = {}
    br_monthly_pts: dict[int, int] = {}
    br_monthly_pe: dict[int, int] = {}
    br_monthly_ve: dict[int, int] = {}
    br_classification_hits: dict[int, int] = {}
    is_brasileirao = competition == "brasileirao2026"

    if is_brasileirao:
        comp_id_br = get_competition_id(db, "brasileirao2026")
        br_config = _get_feature_config(db, group_id)

        if br_config["double_match"]["enabled"]:
            double_match_ids = _resolve_double_match_ids(db, group_id, comp_id_br)
            for uid in member_ids:
                br_double_bonus[uid] = _double_match_bonus(db, group_id, comp_id_br, uid, double_match_ids)

        if br_config["monthly_bonus"]["enabled"]:
            for uid, pts, pe, ve in (
                db.query(
                    GroupMonthlyBonus.user_id,
                    func.sum(GroupMonthlyBonus.pts_awarded),
                    func.sum(GroupMonthlyBonus.pe_credit),
                    func.sum(GroupMonthlyBonus.ve_credit),
                )
                .filter(GroupMonthlyBonus.group_id == group_id, GroupMonthlyBonus.user_id.in_(member_ids))
                .group_by(GroupMonthlyBonus.user_id)
                .all()
            ):
                br_monthly_pts[uid] = int(pts or 0)
                br_monthly_pe[uid] = int(pe or 0)
                br_monthly_ve[uid] = int(ve or 0)

        if br_config["classification_bonus"]["enabled"]:
            for uid in member_ids:
                br_classification_hits[uid] = _classification_hits(db, group_id, uid)

    def effective_pts(r):
        champ_bonus = champion_bonus_pts if r.user_id in correct_pickers else 0
        double_bonus = br_double_bonus.get(r.user_id, 0)
        monthly_pts = br_monthly_pts.get(r.user_id, 0)
        total_eff = int(r.total_points or 0) + champ_bonus + double_bonus + monthly_pts
        if is_brasileirao:
            hits = br_classification_hits.get(r.user_id, 0)
            pe_eff = int(r.exact_scores or 0) + br_monthly_pe.get(r.user_id, 0)
            ve_eff = int(r.correct_results or 0) + br_monthly_ve.get(r.user_id, 0)
            # Critério de desempate em cascata (plan.md): pontos efetivos →
            # acertos do bônus de classificação → PE efetivo → VE efetivo.
            return (total_eff, hits, pe_eff, ve_eff)
        return (total_eff, int(r.exact_scores or 0), int(r.total_bets or 0))

    rows_sorted = sorted(rows, key=lambda r: effective_pts(r), reverse=True)

    def _row_extra(r) -> dict:
        champ_bonus = champion_bonus_pts if r.user_id in correct_pickers else 0
        double_bonus = br_double_bonus.get(r.user_id, 0)
        monthly_pts = br_monthly_pts.get(r.user_id, 0)
        extra = {
            "champion_bonus": champ_bonus,
            "effective_points": int(r.total_points or 0) + champ_bonus + double_bonus + monthly_pts,
        }
        if is_brasileirao:
            extra.update({
                "double_bonus": double_bonus,
                "monthly_bonus_pts": monthly_pts,
                "classification_hits": br_classification_hits.get(r.user_id, 0),
                "pe_efetivo": int(r.exact_scores or 0) + br_monthly_pe.get(r.user_id, 0),
                "ve_efetivo": int(r.correct_results or 0) + br_monthly_ve.get(r.user_id, 0),
            })
        return extra

    return {
        "group_id": group.id,
        "group_name": group.name,
        "is_owner": group.owner_user_id == user.id,
        "competition": competition,
        "is_general": is_general,
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
                "username": r.username,
                "favorite_team_code": r.favorite_team_code,
                "favorite_team_name": team_by_code[r.favorite_team_code].name if r.favorite_team_code in team_by_code else None,
                "favorite_team_flag_url": team_by_code[r.favorite_team_code].flag_url if r.favorite_team_code in team_by_code else None,
                "total_points": int(r.total_points or 0),
                "exact_scores": int(r.exact_scores or 0),
                "correct_results": int(r.correct_results or 0),
                "total_bets": int(r.total_bets or 0),
                **_row_extra(r),
                "is_me": r.user_id == user.id,
                "is_owner": r.user_id == group.owner_user_id,
            }
            for i, r in enumerate(rows_sorted)
        ],
    }


# ── Ranking recortado por período (rodada/turno/mês) — pedido do Abel, além do ──
# ── ranking do campeonato inteiro que já existe acima. Só Brasileirão (rodada/  ──
# ── turno não fazem sentido pra mata-mata da Copa). Leitura pura: soma Bet.     ──
# ── points_earned filtrado por janela, nunca escreve em Ranking/Bet globais.    ──

RETURNO_START_RODADA = 20  # confirmado no plano predicts-grupos-bonus: rodada 20 = 1º jogo do returno 2026


@router.get("/{group_id}/ranking-period")
def group_ranking_period(
    group_id: int,
    scope: str = Query(..., pattern="^(rodada|turno|mes)$"),
    rodada: int | None = Query(None, ge=1, le=38),
    turno: int | None = Query(None, ge=1, le=2),
    year: int | None = Query(None),
    month: int | None = Query(None, ge=1, le=12),
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

    comp_id = get_competition_id(db, "brasileirao2026")

    if scope == "rodada":
        if not rodada:
            raise HTTPException(400, "Parâmetro rodada obrigatório")
        match_filter = Match.match_number == rodada
        label = f"Rodada {rodada}"
        period_meta = {"rodada": rodada}
    elif scope == "turno":
        if turno not in (1, 2):
            raise HTTPException(400, "Parâmetro turno obrigatório (1 ou 2)")
        match_filter = (Match.match_number < RETURNO_START_RODADA) if turno == 1 else (Match.match_number >= RETURNO_START_RODADA)
        label = "1º Turno" if turno == 1 else "2º Turno (Returno)"
        period_meta = {"turno": turno}
    else:  # mes — janela BRT (naive UTC no banco, mesma convenção do resto do projeto)
        now_brt = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=3)
        y = year or now_brt.year
        m = month or now_brt.month
        month_start_utc = datetime(y, m, 1) + timedelta(hours=3)
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        month_end_utc = datetime(ny, nm, 1) + timedelta(hours=3)
        match_filter = and_(Match.match_date >= month_start_utc, Match.match_date < month_end_utc)
        label = f"{m:02d}/{y}"
        period_meta = {"year": y, "month": m}

    # Exato/certo pela mesma régua de world_cup_sync.py::_score_points_v2: exato
    # sempre pontua exatamente 25; direção certa (sem cravar) pontua 10/12/15/18;
    # errado pontua 0. Mesma classificação usada pra alimentar Ranking.exact_scores/
    # correct_results globalmente — só reaplicada aqui por período, não duplica regra.
    rows = (
        db.query(
            Bet.user_id,
            func.coalesce(func.sum(func.coalesce(Bet.points_earned, 0) + func.coalesce(Bet.et_points_earned, 0)), 0).label("pts"),
            func.count(Bet.id).label("bets"),
            func.sum(case((Bet.points_earned == 25, 1), else_=0)).label("exact"),
            func.sum(case((and_(Bet.points_earned > 0, Bet.points_earned != 25), 1), else_=0)).label("correct"),
        )
        .join(Match, Match.id == Bet.match_id)
        .filter(Bet.user_id.in_(member_ids), Match.competition_id == comp_id, match_filter)
        .group_by(Bet.user_id)
        .all()
    )
    stats_by_user = {
        r.user_id: {"pts": int(r.pts or 0), "bets": int(r.bets or 0), "exact": int(r.exact or 0), "correct": int(r.correct or 0)}
        for r in rows
    }
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(member_ids)).all()}

    # Total de jogos possíveis nesse período (denominador de "palpites feitos de X") —
    # mesmo pra todo mundo do grupo, é contagem de partidas, não de apostas de ninguém.
    possible = db.query(func.count(Match.id)).filter(Match.competition_id == comp_id, match_filter).scalar() or 0

    def _row(uid):
        s = stats_by_user.get(uid, {"pts": 0, "bets": 0, "exact": 0, "correct": 0})
        return {
            "user_id": uid,
            "name": users_by_id[uid].name if uid in users_by_id else None,
            "username": users_by_id[uid].username if uid in users_by_id else None,
            "pts": s["pts"],
            "bets": s["bets"],
            "exact": s["exact"],
            "correct": s["correct"],
            "aproveitamento": round(s["pts"] / (s["bets"] * 25) * 100) if s["bets"] else 0,
            "is_me": uid == user.id,
        }

    ranking = sorted((_row(uid) for uid in member_ids), key=lambda r: r["pts"], reverse=True)
    for i, r in enumerate(ranking):
        r["position"] = i + 1

    return {"group_id": group_id, "scope": scope, "label": label, "possible": int(possible), **period_meta, "ranking": ranking}


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
    by: int | None = Query(None, description="user_id de quem compartilhou o link (rastreio de indicação)"),
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

    # Só o link/QR do PRÓPRIO dono entra direto. Repassado por qualquer outro membro
    # (ou link sem atribuição — ?by ausente/estranho) vira pedido, precisa aprovação —
    # trava o grupo crescer sem controle via link forwardado adiante.
    if by == group.owner_user_id:
        db.add(UserGroupMember(group_id=group.id, user_id=user.id, is_owner=False, invited_by_user_id=by))
        log_action(db, user.id, "group.join", {"group_id": group.id, "group_name": group.name, "invited_by_user_id": by})
        db.commit()
        return {"status": "joined", "group_id": group.id, "group_name": group.name}

    existing_request = db.query(UserGroupJoinRequest).filter(
        UserGroupJoinRequest.group_id == group.id,
        UserGroupJoinRequest.user_id == user.id,
        UserGroupJoinRequest.status == GroupInviteStatus.pending,
    ).first()
    if existing_request:
        return {"status": "pending_approval", "group_id": group.id, "group_name": group.name}

    invited_by_user_id = None
    if by and by != user.id:
        referrer_is_member = db.query(UserGroupMember).filter(
            UserGroupMember.group_id == group.id,
            UserGroupMember.user_id == by,
        ).first()
        if referrer_is_member:
            invited_by_user_id = by

    req = UserGroupJoinRequest(group_id=group.id, user_id=user.id, invited_by_user_id=invited_by_user_id)
    db.add(req)
    log_action(db, user.id, "group.join_request", {"group_id": group.id, "group_name": group.name, "invited_by_user_id": invited_by_user_id})
    db.commit()

    db.add(Notification(
        user_id=group.owner_user_id,
        type="group_join_request",
        title=f"🔔 Pedido de entrada em '{group.name}'",
        body=f"{user.name} quer entrar no seu bolão — aprove ou recuse",
        meta={"group_id": group.id, "group_name": group.name, "requester_name": user.name},
    ))
    db.commit()
    try:
        from routers.push import send_push_to_users
        send_push_to_users(
            db, [group.owner_user_id],
            f"🔔 Pedido de entrada em '{group.name}'",
            f"{user.name} quer entrar no seu bolão",
            "/meus-grupos",
            "group_join_request",
        )
    except Exception:
        pass

    return {"status": "pending_approval", "group_id": group.id, "group_name": group.name}


@router.get("/{group_id}/join-requests")
def list_join_requests(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    _ensure_group_owner(group, user)
    reqs = (
        db.query(UserGroupJoinRequest)
        .options(joinedload(UserGroupJoinRequest.user), joinedload(UserGroupJoinRequest.invited_by))
        .filter(UserGroupJoinRequest.group_id == group_id, UserGroupJoinRequest.status == GroupInviteStatus.pending)
        .order_by(UserGroupJoinRequest.created_at.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "name": r.user.name if r.user else "",
            "email_masked": _mask_email(r.user.email if r.user else ""),
            "invited_by_user_id": r.invited_by_user_id,
            "invited_by_name": r.invited_by.name if r.invited_by else None,
            "created_at": r.created_at,
        }
        for r in reqs
    ]


@router.post("/{group_id}/join-requests/{request_id}/approve")
def approve_join_request(
    group_id: int,
    request_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    _ensure_group_owner(group, user)
    req = db.query(UserGroupJoinRequest).filter(
        UserGroupJoinRequest.id == request_id,
        UserGroupJoinRequest.group_id == group_id,
        UserGroupJoinRequest.status == GroupInviteStatus.pending,
    ).first()
    if not req:
        raise HTTPException(404, "Pedido pendente não encontrado")

    existing = db.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == req.user_id,
    ).first()
    if not existing:
        db.add(UserGroupMember(group_id=group_id, user_id=req.user_id, is_owner=False, invited_by_user_id=req.invited_by_user_id))
    req.status = GroupInviteStatus.accepted
    req.responded_at = datetime.now(timezone.utc).replace(tzinfo=None)
    log_action(db, user.id, "group.join_request_approve", {"group_id": group_id, "request_id": request_id, "requester_user_id": req.user_id})
    db.commit()

    db.add(Notification(
        user_id=req.user_id,
        type="group_join_approved",
        title=f"✅ Pedido aprovado — '{group.name}'",
        body=f"Você já faz parte do bolão '{group.name}'",
        meta={"group_id": group_id, "group_name": group.name},
    ))
    db.commit()
    return {"status": "approved", "group_id": group_id, "request_id": request_id}


@router.post("/{group_id}/join-requests/{request_id}/reject")
def reject_join_request(
    group_id: int,
    request_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    _ensure_group_owner(group, user)
    req = db.query(UserGroupJoinRequest).filter(
        UserGroupJoinRequest.id == request_id,
        UserGroupJoinRequest.group_id == group_id,
        UserGroupJoinRequest.status == GroupInviteStatus.pending,
    ).first()
    if not req:
        raise HTTPException(404, "Pedido pendente não encontrado")

    req.status = GroupInviteStatus.rejected
    req.responded_at = datetime.now(timezone.utc).replace(tzinfo=None)
    log_action(db, user.id, "group.join_request_reject", {"group_id": group_id, "request_id": request_id, "requester_user_id": req.user_id})
    db.commit()

    db.add(Notification(
        user_id=req.user_id,
        type="group_join_rejected",
        title=f"Pedido recusado — '{group.name}'",
        body=f"O dono do bolão '{group.name}' não aprovou seu pedido de entrada",
        meta={"group_id": group_id, "group_name": group.name},
    ))
    db.commit()
    return {"status": "rejected", "group_id": group_id, "request_id": request_id}


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
    competition: str = Query(default="copa2026", description="Código da competição — evita misturar dado entre Copa e Brasileirão"),
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

    comp_id = get_competition_id(db, competition)
    if comp_id is None:
        raise HTTPException(404, "Competição não encontrada")

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    week_ago = now - timedelta(days=7)

    # Member names (single query reused throughout)
    members_with_names = {
        r.id: r.name for r in db.query(User.id, User.name).filter(User.id.in_(member_ids)).all()
    }
    members_with_usernames = {
        r.id: r.username for r in db.query(User.id, User.username).filter(User.id.in_(member_ids)).all()
    }

    # Próximo jogo aberto (só desta competição)
    next_match = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .filter(Match.status == MatchStatus.scheduled, Match.match_date > now, Match.competition_id == comp_id)
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
        .filter(Bet.user_id.in_(member_ids), Match.status == MatchStatus.finished, Match.competition_id == comp_id)
        .order_by(Bet.user_id, Match.match_date.asc())
        .all()
    )
    user_bets_asc: dict[int, list[int]] = {}
    for b in all_bets_data:
        user_bets_asc.setdefault(b.user_id, []).append(b.points_earned)

    # Streaks: conta sequências de acertos (pts > 0, V2 scoring)
    streak_list = []
    for uid, bets_list in user_bets_asc.items():
        max_streak = cur = 0
        for pts in bets_list:
            if (pts or 0) > 0:
                cur += 1
                max_streak = max(max_streak, cur)
            else:
                cur = 0
        if max_streak > 0:
            streak_list.append({"user_id": uid, "name": members_with_names.get(uid, ""), "username": members_with_usernames.get(uid), "streak": max_streak})
    streak_list.sort(key=lambda x: -x["streak"])

    # Recent form per user (last 5 bets, most recent first)
    recent_form: dict[int, list[str]] = {}
    for uid, bets_list in user_bets_asc.items():
        form: list[str] = []
        for pts in reversed(bets_list):
            if len(form) >= 5:
                break
            form.append("E" if pts == 25 else "C" if (pts or 0) > 0 else "X")
        recent_form[uid] = form

    # Weekly ranking (last 7 days)
    weekly_rows = (
        db.query(Bet.user_id, func.sum(Bet.points_earned).label("pts_week"))
        .join(Match, Bet.match_id == Match.id)
        .filter(
            Bet.user_id.in_(member_ids),
            Match.status == MatchStatus.finished,
            Match.match_date >= week_ago,
            Match.competition_id == comp_id,
        )
        .group_by(Bet.user_id)
        .order_by(desc(func.sum(Bet.points_earned)))
        .all()
    )
    weekly_ranking = [
        {"user_id": r.user_id, "name": members_with_names.get(r.user_id, ""), "username": members_with_usernames.get(r.user_id), "pts_week": int(r.pts_week or 0)}
        for r in weekly_rows
    ]

    # Monthly ranking (mês calendário atual)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_rows = (
        db.query(Bet.user_id, func.sum(Bet.points_earned).label("pts_month"))
        .join(Match, Bet.match_id == Match.id)
        .filter(
            Bet.user_id.in_(member_ids),
            Match.status == MatchStatus.finished,
            Match.match_date >= month_start,
            Match.competition_id == comp_id,
        )
        .group_by(Bet.user_id)
        .order_by(desc(func.sum(Bet.points_earned)))
        .all()
    )
    monthly_ranking = [
        {"user_id": r.user_id, "name": members_with_names.get(r.user_id, ""), "username": members_with_usernames.get(r.user_id), "pts_month": int(r.pts_month or 0)}
        for r in monthly_rows
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
        .filter(Bet.user_id.in_(member_ids), Match.status == MatchStatus.finished, Match.competition_id == comp_id)
        .order_by(desc(Bet.score_a + Bet.score_b), desc(Bet.score_a))
        .limit(3)
        .all()
    )
    top_bets = [
        {"score_a": r.score_a, "score_b": r.score_b, "user_name": r.user_name, "group": r.group_name}
        for r in top_bets_rows
    ]

    # Group XP & level (V2: exact = 25 pts)
    xp_row = (
        db.query(
            func.count(Bet.id).label("total_bets"),
            func.sum(case((Bet.points_earned == 25, 1), else_=0)).label("total_exacts"),
        )
        .join(Match, Bet.match_id == Match.id)
        .filter(Bet.user_id.in_(member_ids), Match.competition_id == comp_id)
        .first()
    )
    total_bets_all = int(xp_row.total_bets or 0) if xp_row else 0
    total_exacts_all = int(xp_row.total_exacts or 0) if xp_row else 0
    group_xp = total_bets_all * 10 + total_exacts_all * 20 + len(member_ids) * 50
    group_level = max(1, group_xp // 500 + 1)
    next_level_xp = group_level * 500

    # Best approval in group (min 5 bets, V2 max = 25 pts/bet)
    _bet_cnt_sub = (
        db.query(Bet.user_id, func.count(Bet.id).label("cnt"))
        .join(Match, Bet.match_id == Match.id)
        .filter(Bet.user_id.in_(member_ids), Match.competition_id == comp_id)
        .group_by(Bet.user_id)
        .subquery()
    )
    _appr_rows = (
        db.query(
            User.id.label("user_id"),
            User.name.label("name"),
            User.username.label("username"),
            func.coalesce(Ranking.total_points, 0).label("total_points"),
            func.coalesce(_bet_cnt_sub.c.cnt, 0).label("total_bets"),
        )
        .outerjoin(Ranking, and_(User.id == Ranking.user_id, Ranking.competition_id == comp_id))
        .outerjoin(_bet_cnt_sub, User.id == _bet_cnt_sub.c.user_id)
        .filter(User.id.in_(member_ids), _bet_cnt_sub.c.cnt >= 5)
        .all()
    )
    best_approval = None
    _best_pct = -1
    for _ar in _appr_rows:
        _tb = int(_ar.total_bets or 0)
        if not _tb:
            continue
        _pct = round(int(_ar.total_points or 0) / (_tb * 25) * 100)
        if _pct > _best_pct:
            _best_pct = _pct
            best_approval = {"user_id": _ar.user_id, "name": _ar.name, "username": _ar.username, "pct": _pct}

    # Recent bets with match/result details per member (last 20 each, ordered by date desc)
    _rd_rows = (
        db.query(
            Bet.user_id,
            Bet.score_a.label("bet_a"),
            Bet.score_b.label("bet_b"),
            Bet.points_earned,
            Match.team_a_id,
            Match.team_b_id,
            Match.match_date,
            MatchResult.score_a.label("result_a"),
            MatchResult.score_b.label("result_b"),
        )
        .join(Match, Bet.match_id == Match.id)
        .outerjoin(MatchResult, MatchResult.match_id == Match.id)
        .filter(Bet.user_id.in_(member_ids), Match.status == MatchStatus.finished, Match.competition_id == comp_id)
        .order_by(Bet.user_id, Match.match_date.desc())
        .all()
    )
    _tid_set = {r.team_a_id for r in _rd_rows} | {r.team_b_id for r in _rd_rows}
    _tmap = {
        t.id: {"code": t.code, "flag_url": t.flag_url}
        for t in db.query(Team).filter(Team.id.in_(_tid_set)).all()
    } if _tid_set else {}
    _ud_map: dict[int, list] = {}
    for _rd in _rd_rows:
        _ud_map.setdefault(_rd.user_id, []).append(_rd)
    member_recent_bets = {
        uid: [
            {
                "bet_a": b.bet_a, "bet_b": b.bet_b,
                "points_earned": b.points_earned or 0,
                "result_a": b.result_a, "result_b": b.result_b,
                "team_a": _tmap.get(b.team_a_id, {}),
                "team_b": _tmap.get(b.team_b_id, {}),
                "match_date": b.match_date.isoformat() if b.match_date else None,
            }
            for b in bets_list[:20]
        ]
        for uid, bets_list in _ud_map.items()
    }

    return {
        "next_match": next_match_out,
        "members_bet_next": members_bet_next,
        "members_no_bet_next": members_no_bet_next,
        "top_bet": top_bets[0] if top_bets else None,
        "top_bets": top_bets,
        "streaks": streak_list,
        "recent_form": recent_form,
        "weekly_ranking": weekly_ranking,
        "monthly_ranking": monthly_ranking,
        "group_xp": group_xp,
        "group_level": group_level,
        "next_level_xp": next_level_xp,
        "best_approval": best_approval,
        "member_recent_bets": member_recent_bets,
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
    competition: str = Query(default="copa2026", description="Código da competição — evita misturar dado entre Copa e Brasileirão"),
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
    comp_id = get_competition_id(db, competition)
    if comp_id is None:
        raise HTTPException(404, "Competição não encontrada")
    matches = (
        db.query(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b), joinedload(Match.result))
        .filter(Match.status == MatchStatus.finished, Match.competition_id == comp_id)
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
    competition: str = Query(default="copa2026", description="Código da competição — evita misturar dado entre Copa e Brasileirão"),
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

    comp_id = get_competition_id(db, competition)
    if comp_id is None:
        raise HTTPException(404, "Competição não encontrada")

    members_names = {
        r.id: r.name for r in db.query(User.id, User.name).filter(User.id.in_(member_ids)).all()
    }

    # All finished matches ordered by date (só desta competição)
    finished_matches = (
        db.query(Match.id, Match.match_date)
        .filter(Match.status == MatchStatus.finished, Match.competition_id == comp_id)
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
            User.username,
            User.favorite_team_code,
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
        q.group_by(Bet.user_id, User.name, User.username, User.favorite_team_code)
        .order_by(desc(func.sum(Bet.points_earned)), desc(func.sum(case((Bet.points_earned == 3, 1), else_=0))))
        .all()
    )

    fav_codes = {r.favorite_team_code for r in rows if r.favorite_team_code}
    team_by_code = (
        {t.code: t for t in db.query(Team).filter(Team.code.in_(fav_codes)).all()}
        if fav_codes else {}
    )

    return [
        {
            "position": i + 1,
            "user_id": r.user_id,
            "name": r.name,
            "username": r.username,
            "favorite_team_code": r.favorite_team_code,
            "favorite_team_name": team_by_code[r.favorite_team_code].name if r.favorite_team_code in team_by_code else None,
            "favorite_team_flag_url": team_by_code[r.favorite_team_code].flag_url if r.favorite_team_code in team_by_code else None,
            "total_points": int(r.total_points or 0),
            "exact_scores": int(r.exact_scores or 0),
            "correct_results": int(r.correct_results or 0),
            "total_bets": int(r.total_bets or 0),
            "is_me": r.user_id == user.id,
        }
        for i, r in enumerate(rows)
    ]
