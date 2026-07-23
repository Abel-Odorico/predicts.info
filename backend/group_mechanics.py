"""Mecânicas extras de bolão que rodam FORA do ciclo request/response:

  - Lanterna da rodada — calculada ao fechar rodada, pendurada no fim de
    `routers/brasileirao_sync.py::evaluate_bets` (passo 8/10 do plano).
  - Jogo em dobro automático — detecção + notificação da rodada ATUAL
    (passo 10), pendurada no mesmo lugar.
  - Fechamento do bônus mensal — script cron separado, ver
    `close_group_monthly_bonus.py` (passo 11).

Sempre overlay aditivo: nunca escreve em `Bet`/`Ranking` globais, só em
tabelas próprias (`GroupLanterna`, `GroupDoubleMatch`, `GroupMonthlyBonus`).
Ver plan.md em /root/.dev-plans/predicts-grupos-bonus/.
"""
from __future__ import annotations

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from competitions import get_competition_id
from models import Bet, GroupDoubleMatch, GroupLanterna, Match, MatchStatus, User, UserGroup, UserGroupMember


# ── Notificação compartilhada (sino + WhatsApp) ──────────────────────────────

def _notify_group_members(
    db: Session, group: UserGroup, member_ids: list[int],
    type_: str, title: str, body: str, meta: dict, wa_message: str,
) -> None:
    """Sino (`create_notification`, sempre, pra todo membro) + WhatsApp (só
    opt-in ativo com pref `group_mechanics` — chave nova, ausência = ligado
    por padrão via `_wants`; respeita modo silêncio; NUNCA `ignore_quiet=True`
    aqui, é notificação PROATIVA, não resposta a ação do usuário). Isolado —
    erro de notificação individual nunca derruba o resto do lote."""
    from routers.notifications import create_notification
    from routers.whatsapp import _wants
    import whatsapp_client as wa

    if not member_ids:
        return
    users = db.query(User).filter(User.id.in_(member_ids)).all()

    for u in users:
        try:
            create_notification(db, user_id=u.id, type_=type_, title=title, body=body, meta=meta)
        except Exception as e:
            print(f"[group-notify] sino falhou user={u.id} type={type_}: {e}", flush=True)

    if wa.is_quiet_now(db):
        return
    for u in users:
        if not u.phone or not u.whatsapp_opt_in or not getattr(u, "is_active", True):
            continue
        if not _wants(u.whatsapp_prefs, "group_mechanics"):
            continue
        try:
            wa.send_text(db, u.phone, wa_message)
        except Exception as e:
            print(f"[group-notify] whatsapp falhou user={u.id} type={type_}: {e}", flush=True)


def _notify_new_lanterna(db: Session, group: UserGroup, rodada: int, loser_ids: list[int]) -> None:
    title = "🔴 Lanterna da rodada"
    body = f"Rodada {rodada} do Brasileirão fechada — confira o lanterna do bolão \"{group.name}\"."
    meta = {"group_id": group.id, "match_number": rodada, "user_ids": loser_ids}
    wa_message = (
        f"🔴 *Lanterna da rodada {rodada}* no bolão \"{group.name}\"\n\n"
        f"Quem tirou menos pontos na rodada é o lanterna — vídeo + PIX combinado "
        f"pro fundo do grupo. Confira em predicts.info/meus-grupos/{group.id}"
    )
    member_ids = [row[0] for row in db.query(UserGroupMember.user_id).filter(UserGroupMember.group_id == group.id).all()]
    _notify_group_members(db, group, member_ids, "group_lanterna", title, body, meta, wa_message)


def _notify_group_double_match(db: Session, group: UserGroup, rodada: int, match: Match, pair: list[str]) -> None:
    label = f"{match.team_a.name} x {match.team_b.name}" if match.team_a and match.team_b else "clássico da lista"
    title = "🔥 Jogo em dobro"
    body = f"{label} vale pontuação em dobro na rodada {rodada} do bolão \"{group.name}\"."
    meta = {"group_id": group.id, "match_number": rodada, "match_id": match.id, "pair": pair}
    wa_message = (
        f"🔥 *Jogo em dobro* no bolão \"{group.name}\"!\n\n"
        f"{label} vale pontuação em DOBRO na rodada {rodada} — capricha no palpite. "
        f"predicts.info/brasileirao"
    )
    member_ids = [row[0] for row in db.query(UserGroupMember.user_id).filter(UserGroupMember.group_id == group.id).all()]
    _notify_group_members(db, group, member_ids, "group_double_match", title, body, meta, wa_message)


def _finished_round_numbers(db: Session, comp_id: int) -> set[int]:
    """Rodadas 100% finalizadas: TODOS os jogos daquele `match_number` com
    `status=finished` — não basta 1 jogo finalizado, senão a lanterna seria
    calculada com a rodada pela metade."""
    rows = (
        db.query(
            Match.match_number,
            func.count(Match.id).label("total"),
            func.sum(case((Match.status == MatchStatus.finished, 1), else_=0)).label("done"),
        )
        .filter(Match.competition_id == comp_id, Match.match_number.isnot(None))
        .group_by(Match.match_number)
        .all()
    )
    return {r.match_number for r in rows if r.total == r.done}


def compute_group_lanterna_for_finished_rounds(db: Session) -> dict:
    """Pra cada grupo com `lanterna.enabled=true` no `GroupFeatureConfig`:
    acha rodadas 100% finalizadas do Brasileirão que ainda não têm linha em
    `GroupLanterna` pro grupo; soma os pontos de CADA membro SÓ daquela rodada
    (`Bet.points_earned+et_points_earned`, membro sem bet na rodada = 0);
    acha o mínimo; grava TODOS os empatados nesse mínimo. Idempotente — unique
    `(group_id, match_number)` garante não duplicar em re-runs.

    Notificação (sino + WhatsApp) disparada 1x por linha nova criada — ver
    `_notify_new_lanterna` (passo 10), condicionada a `config.
    notifications_enabled`."""
    from routers.user_groups import _get_feature_config  # import local, evita ciclo de import

    comp_id = get_competition_id(db, "brasileirao2026")
    finished_rounds = _finished_round_numbers(db, comp_id)
    if not finished_rounds:
        return {"groups_processed": 0, "rounds_created": 0}

    groups_processed = 0
    rounds_created = 0
    new_lanterna_rows: list[GroupLanterna] = []

    for group in db.query(UserGroup).all():
        config = _get_feature_config(db, group.id)
        if not config["lanterna"]["enabled"]:
            continue
        groups_processed += 1

        members = db.query(UserGroupMember).filter(UserGroupMember.group_id == group.id).all()
        member_ids = [m.user_id for m in members]
        if not member_ids:
            continue

        already = {
            row[0] for row in (
                db.query(GroupLanterna.match_number)
                .filter(GroupLanterna.group_id == group.id, GroupLanterna.match_number.in_(finished_rounds))
                .all()
            )
        }
        pending_rounds = finished_rounds - already
        if not pending_rounds:
            continue

        group_new_rows: list[tuple[GroupLanterna, list[int]]] = []
        for rodada in sorted(pending_rounds):
            points_by_user: dict[int, int] = dict.fromkeys(member_ids, 0)
            rows = (
                db.query(
                    Bet.user_id,
                    func.coalesce(
                        func.sum(func.coalesce(Bet.points_earned, 0) + func.coalesce(Bet.et_points_earned, 0)), 0
                    ),
                )
                .join(Match, Match.id == Bet.match_id)
                .filter(Match.competition_id == comp_id, Match.match_number == rodada, Bet.user_id.in_(member_ids))
                .group_by(Bet.user_id)
                .all()
            )
            for uid, pts in rows:
                points_by_user[uid] = int(pts or 0)

            min_pts = min(points_by_user.values())
            losers = [uid for uid, pts in points_by_user.items() if pts == min_pts]

            row = GroupLanterna(group_id=group.id, match_number=rodada, user_ids=losers, pix_paid={}, video_confirmed={})
            db.add(row)
            rounds_created += 1
            new_lanterna_rows.append(row)
            group_new_rows.append((row, losers))

        db.commit()

        if config.get("notifications_enabled", True):
            for row, losers in group_new_rows:
                try:
                    _notify_new_lanterna(db, group, row.match_number, losers)
                except Exception as e:
                    print(f"[group-lanterna] notificação falhou group={group.id} rodada={row.match_number}: {e}", flush=True)
            db.commit()

    for row in new_lanterna_rows:
        db.refresh(row)

    return {"groups_processed": groups_processed, "rounds_created": rounds_created, "new_rows": new_lanterna_rows}


def compute_group_double_match_auto_detect(db: Session) -> dict:
    """Detecta o clássico automático (`config.auto_double_derbies`) da rodada
    ATUAL (próxima ainda não fechada) pra cada grupo com `double_match.
    enabled=true`; na 1ª vez que aparece pra aquela (grupo, rodada), persiste
    em `GroupDoubleMatch` (`is_auto=True`) + notifica (sino + WhatsApp). Só
    olha a rodada atual — não faz backfill retroativo de rodadas passadas
    (evitaria notificação em massa histórica ao ligar a feature)."""
    from routers.brasileirao import _current_rodada, _load_matches
    from routers.user_groups import _find_auto_double_match, _get_feature_config

    comp_id = get_competition_id(db, "brasileirao2026")
    all_matches = _load_matches(db, comp_id)  # já vem com team_a/team_b joinedload
    current_rodada = _current_rodada(all_matches)
    if not current_rodada:
        return {"groups_notified": 0}

    rodada_matches = [m for m in all_matches if m.match_number == current_rodada]

    groups_notified = 0
    for group in db.query(UserGroup).all():
        config = _get_feature_config(db, group.id)
        if not config["double_match"]["enabled"]:
            continue

        derby_pairs = config["double_match"]["auto_double_derbies"]
        auto_match, auto_pair = _find_auto_double_match(rodada_matches, derby_pairs)
        if not auto_match:
            continue

        existing = (
            db.query(GroupDoubleMatch)
            .filter(GroupDoubleMatch.group_id == group.id, GroupDoubleMatch.match_number == current_rodada)
            .first()
        )
        if existing:
            continue  # já persistido antes (auto ou manual) — já notificado

        row = GroupDoubleMatch(
            group_id=group.id, match_number=current_rodada, match_id=auto_match.id,
            is_auto=True, set_by_user_id=None,
        )
        db.add(row)
        db.commit()

        if config.get("notifications_enabled", True):
            try:
                _notify_group_double_match(db, group, current_rodada, auto_match, auto_pair)
                db.commit()
            except Exception as e:
                print(f"[group-double-match] notificação falhou group={group.id} rodada={current_rodada}: {e}", flush=True)
        groups_notified += 1

    return {"groups_notified": groups_notified, "rodada": current_rodada}
