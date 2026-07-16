"""
GET  /champion/pick         — palpite atual do usuário (auth)
POST /champion/pick         — registrar/atualizar palpite (auth, antes do deadline)
GET  /champion/picks/stats  — distribuição de palpites (público)
GET  /admin/champion/award  — status do award (admin)
POST /admin/champion/award  — credita +100 campeão / +50 vice (admin, idempotente)
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, DateTime, ForeignKey, func, text

from database import Base, get_db
from auth_utils import get_current_user, require_admin
from models import User, Team, Ranking, Notification

router = APIRouter(tags=["champion"])

CHAMPION_BONUS  = 100
RUNNER_UP_BONUS = 50


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _deadline(db: Session) -> datetime:
    """Retorna o horário do 1º jogo r32 no banco (trava no início da fase eliminatória).

    Override manual (admin, reabertura temporária): site_config['champion_deadline_override']
    (UTC ISO). Só vale se ainda estiver no futuro — passou, volta a valer o deadline real do r32.
    """
    row = db.execute(
        text("SELECT value FROM site_config WHERE key = 'champion_deadline_override'")
    ).fetchone()
    if row and row[0]:
        override = datetime.fromisoformat(row[0])
        if override.tzinfo is not None:
            # aceita string com timezone (ex: sufixo 'Z') sem crashar na comparação com _utcnow() naive
            override = override.astimezone(timezone.utc).replace(tzinfo=None)
        if override > _utcnow():
            return override

    row = db.execute(
        text("SELECT MIN(match_date) FROM matches WHERE phase = 'r32'")
    ).fetchone()
    if row and row[0]:
        return row[0]
    # fallback: Copa termina em julho/2026
    return datetime(2026, 7, 15, 0, 0, 0)


def _can_change(db: Session) -> bool:
    return _utcnow() < _deadline(db)


class ChampionPick(Base):
    __tablename__ = "champion_picks"
    id                = Column(Integer, primary_key=True)
    user_id           = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    team_id           = Column(Integer, ForeignKey("teams.id"), nullable=False)
    runner_up_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    created_at        = Column(DateTime, default=_utcnow)
    updated_at        = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ChampionAward(Base):
    """Tracks a completed award run — prevents double-crediting."""
    __tablename__ = "champion_awards"
    id                = Column(Integer, primary_key=True)
    champion_team_id  = Column(Integer, ForeignKey("teams.id"), nullable=False)
    runner_up_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    awarded_by        = Column(Integer, ForeignKey("users.id"), nullable=True)
    champion_users    = Column(Integer, default=0)
    runner_up_users   = Column(Integer, default=0)
    awarded_at        = Column(DateTime, default=_utcnow)


def _team_dict(t: Team) -> dict:
    return {"team_id": t.id, "code": t.code, "name": t.name, "flag": t.flag_url}


def _pick_response(pick: "ChampionPick", db: Session) -> dict:
    champion  = db.query(Team).filter(Team.id == pick.team_id).first()
    runner_up = db.query(Team).filter(Team.id == pick.runner_up_team_id).first() if pick.runner_up_team_id else None
    return {
        "champion":  {**_team_dict(champion),  "team_id": champion.id}  if champion  else None,
        "runner_up": {**_team_dict(runner_up), "team_id": runner_up.id} if runner_up else None,
        "picked_at":  pick.created_at,
        "can_change": _can_change(db),
        "deadline":   _deadline(db).isoformat(),
    }


@router.get("/champion/status")
def champion_status(db: Session = Depends(get_db)):
    """Estado público da janela de palpite de campeão."""
    dl = _deadline(db)
    return {
        "can_change": _can_change(db),
        "deadline":   dl.isoformat(),
        "deadline_brt": (dl.strftime("%d/%m %H:%M") + " UTC"),
    }


@router.get("/champion/pick")
def get_pick(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pick = db.query(ChampionPick).filter(ChampionPick.user_id == user.id).first()
    if not pick:
        raise HTTPException(404, "Sem palpite")
    return _pick_response(pick, db)


@router.post("/champion/pick")
def set_pick(body: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not _can_change(db):
        raise HTTPException(403, "Prazo encerrado para palpite de campeão")

    team_id           = body.get("team_id")
    runner_up_team_id = body.get("runner_up_team_id")

    if not team_id and not runner_up_team_id:
        raise HTTPException(400, "team_id ou runner_up_team_id obrigatório")

    pick = db.query(ChampionPick).filter(ChampionPick.user_id == user.id).first()

    if team_id is not None:
        team = db.query(Team).filter(Team.id == team_id).first()
        if not team:
            raise HTTPException(404, "Time não encontrado")
        if pick and pick.runner_up_team_id == team_id:
            raise HTTPException(400, "Campeão e vice-campeão não podem ser o mesmo time")
        if not pick:
            pick = ChampionPick(user_id=user.id, team_id=team_id)
            db.add(pick)
        else:
            pick.team_id = team_id

    if runner_up_team_id is not None:
        ru_team = db.query(Team).filter(Team.id == runner_up_team_id).first()
        if not ru_team:
            raise HTTPException(404, "Time não encontrado")
        if pick and pick.team_id == runner_up_team_id:
            raise HTTPException(400, "Campeão e vice-campeão não podem ser o mesmo time")
        if not pick:
            raise HTTPException(400, "Escolha o campeão antes do vice")
        pick.runner_up_team_id = runner_up_team_id

    pick.updated_at = _utcnow()
    db.commit()
    return _pick_response(pick, db)


@router.get("/champion/picks/stats")
def picks_stats(db: Session = Depends(get_db)):
    def _stats_for(col):
        rows = (
            db.query(Team, func.count(col).label("cnt"))
            .join(ChampionPick, col == Team.id, isouter=True)
            .group_by(Team.id)
            .having(func.count(col) > 0)
            .order_by(func.count(col).desc())
            .all()
        )
        total = sum(r.cnt for r in rows) or 1
        return [{**_team_dict(r.Team), "count": r.cnt, "pct": round(r.cnt * 100 / total, 1)} for r in rows]

    return {
        "champion":  _stats_for(ChampionPick.team_id),
        "runner_up": _stats_for(ChampionPick.runner_up_team_id),
    }


@router.get("/admin/champion/reopen-changes")
def reopen_changes(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Quem mexeu no palpite de campeão/vice desde a reabertura (site_config
    'champion_deadline_override'): separa quem TROCOU um palpite já existente
    de antes de quem escolheu PELA 1ª VEZ durante a janela. Cobre WhatsApp e site
    (baseado em created_at/updated_at do pick, não depende de log específico de canal)."""
    row = db.execute(
        text("SELECT value, updated_at FROM site_config WHERE key = 'champion_deadline_override'")
    ).fetchone()
    if not row:
        return {"reopened_at": None, "trocaram": [], "novos": []}
    reopened_at = row[1]

    rows = (
        db.query(ChampionPick, User)
        .join(User, User.id == ChampionPick.user_id)
        .filter(ChampionPick.updated_at >= reopened_at)
        .order_by(ChampionPick.updated_at.desc())
        .all()
    )
    team_ids = {p.team_id for p, _ in rows} | {p.runner_up_team_id for p, _ in rows if p.runner_up_team_id}
    teams_map = {t.id: t for t in db.query(Team).filter(Team.id.in_(team_ids)).all()} if team_ids else {}

    def _row(pick: "ChampionPick", user: User) -> dict:
        return {
            "user_id": user.id,
            "name": user.name,
            "champion": _team_dict(teams_map[pick.team_id]) if pick.team_id in teams_map else None,
            "runner_up": _team_dict(teams_map[pick.runner_up_team_id]) if pick.runner_up_team_id in teams_map else None,
            "updated_at": pick.updated_at.isoformat(),
        }

    trocaram = [_row(p, u) for p, u in rows if p.created_at < reopened_at]
    novos = [_row(p, u) for p, u in rows if p.created_at >= reopened_at]
    return {
        "reopened_at": reopened_at.isoformat(),
        "trocaram": trocaram,
        "novos": novos,
        "total_trocaram": len(trocaram),
        "total_novos": len(novos),
    }


@router.get("/champion/picks/all")
def all_picks(db: Session = Depends(get_db)):
    rows = (
        db.query(ChampionPick, User)
        .join(User, User.id == ChampionPick.user_id)
        .order_by(User.name)
        .all()
    )
    team_ids = set()
    for pick, _ in rows:
        if pick.team_id:           team_ids.add(pick.team_id)
        if pick.runner_up_team_id: team_ids.add(pick.runner_up_team_id)
    teams_map = {t.id: t for t in db.query(Team).filter(Team.id.in_(team_ids)).all()} if team_ids else {}

    return [
        {
            "user_id":   user.id,
            "user_name": user.name,
            "champion":  _team_dict(teams_map[pick.team_id])           if pick.team_id           and pick.team_id           in teams_map else None,
            "runner_up": _team_dict(teams_map[pick.runner_up_team_id]) if pick.runner_up_team_id and pick.runner_up_team_id in teams_map else None,
        }
        for pick, user in rows
    ]


@router.post("/admin/champion/reopen-notify")
def reopen_notify(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Envia push + notificação in-app + WhatsApp (opt-in) anunciando reabertura dos palpites de campeão."""
    from datetime import timedelta
    from routers.push import send_push_to_all

    dl = _deadline(db)
    dl_brt = dl - timedelta(hours=3)
    now_brt = _utcnow() - timedelta(hours=3)
    deadline_brt = dl_brt.strftime("%H:%M")
    # Override pode reabrir por mais de 1 dia — "de hoje" fixo mentia a data quando o prazo
    # caía amanhã ou depois. Só usa "hoje" quando bate mesmo com o dia atual em BRT.
    deadline_day = "hoje" if dl_brt.date() == now_brt.date() else f"dia {dl_brt.strftime('%d/%m')}"

    push_title = "🏆 Só até " + deadline_brt + ": escolha seu Campeão!"
    push_body = f"Campeão vale +{CHAMPION_BONUS} pts, Vice +{RUNNER_UP_BONUS} pts. Reaberto por tempo limitado — corre!"

    notif_title = f"🏆 Campeão e Vice reabertos — só até {deadline_brt} de {deadline_day}!"
    notif_body = (
        f"Escolha ou troque seu palpite: acerte o Campeão (+{CHAMPION_BONUS} pts) e o Vice "
        f"(+{RUNNER_UP_BONUS} pts). Prazo corre até {deadline_brt} de {deadline_day} (horário de Brasília) — depois fecha de novo. "
        "Aproveita e confere as novidades: Brasileirão já rodando no predicts.info e o bot do WhatsApp completo "
        "(ranking, seus palpites, resultado na hora do apito final)."
    )
    whatsapp_body = (
        f"🏆 *Campeão e Vice reabertos* — só até {deadline_brt} de {deadline_day}!\n\n"
        "Escolha (ou troque) seu palpite:\n"
        f"🥇 Campeão = +{CHAMPION_BONUS} pts\n"
        f"🥈 Vice = +{RUNNER_UP_BONUS} pts\n\n"
        "Corre, o prazo é curto: predicts.info/campeao\n\n"
        "Aproveita e vê as novidades: Brasileirão já rodando no site e o bot ficou completo "
        "(ranking, seus palpites e resultado na hora, direto aqui no zap) 🇧🇷⚽"
    )

    # Push para todos os subscribers
    push_sent = send_push_to_all(db, title=push_title, body=push_body, url="/campeao")

    # Notificação in-app para todos os usuários registrados
    users = db.query(User).filter(User.email != "bot@predicts.info").all()
    notif_count = 0
    for u in users:
        db.add(Notification(
            user_id=u.id,
            type="champion_reopen",
            title=notif_title,
            body=notif_body,
            meta={"deadline": dl.isoformat(), "url": "/campeao"},
        ))
        notif_count += 1
    db.commit()

    # WhatsApp — campanha pro segmento opt-in (respeita consentimento e modo silêncio)
    from routers.whatsapp import _create_campaign_internal
    wa_result = _create_campaign_internal(db, message=whatsapp_body, segment="opt_in")

    return {
        "push_sent": push_sent,
        "notifications_sent": notif_count,
        "whatsapp_campaign": wa_result,
        "deadline": dl.isoformat(),
        "deadline_brt": deadline_brt,
    }


@router.get("/admin/champion/award")
def award_status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    award = db.query(ChampionAward).order_by(ChampionAward.id.desc()).first()
    if not award:
        return {"awarded": False}
    champion  = db.query(Team).filter(Team.id == award.champion_team_id).first()
    runner_up = db.query(Team).filter(Team.id == award.runner_up_team_id).first()
    return {
        "awarded": True,
        "champion":  _team_dict(champion)  if champion  else None,
        "runner_up": _team_dict(runner_up) if runner_up else None,
        "champion_users":  award.champion_users,
        "runner_up_users": award.runner_up_users,
        "awarded_at": award.awarded_at,
    }


@router.post("/admin/champion/award")
def award_champion(
    body: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    champion_id  = body.get("champion_team_id")
    runner_up_id = body.get("runner_up_team_id")
    if not champion_id or not runner_up_id:
        raise HTTPException(400, "champion_team_id e runner_up_team_id obrigatórios")

    # Idempotency: block if already awarded
    existing = db.query(ChampionAward).first()
    if existing:
        raise HTTPException(409, "Bônus já creditado. Use /admin/champion/award (GET) para ver o status.")

    champion  = db.query(Team).filter(Team.id == champion_id).first()
    runner_up = db.query(Team).filter(Team.id == runner_up_id).first()
    if not champion or not runner_up:
        raise HTTPException(404, "Time não encontrado")

    champion_picks  = db.query(ChampionPick).filter(ChampionPick.team_id == champion_id).all()
    runner_up_picks = db.query(ChampionPick).filter(ChampionPick.runner_up_team_id == runner_up_id).all()

    def _credit(picks, bonus, notif_title, notif_body):
        for p in picks:
            from competitions import get_competition_id
            r = db.query(Ranking).filter(
                Ranking.user_id == p.user_id, Ranking.competition_id == get_competition_id(db)
            ).first()
            if not r:
                r = Ranking(user_id=p.user_id, total_points=0, exact_scores=0, correct_results=0)
                db.add(r)
            r.total_points = (r.total_points or 0) + bonus
            db.add(Notification(
                user_id=p.user_id,
                type="champion_bonus",
                title=notif_title,
                body=notif_body,
                meta={"team_id": p.team_id, "bonus": bonus},
            ))

    _credit(
        champion_picks, CHAMPION_BONUS,
        f"🏆 +{CHAMPION_BONUS} pts! {champion.name} é campeão!",
        f"Seu palpite de campeão estava certo. Parabéns!",
    )
    _credit(
        runner_up_picks, RUNNER_UP_BONUS,
        f"🥈 +{RUNNER_UP_BONUS} pts! {runner_up.name} é vice-campeão!",
        f"Seu palpite de vice-campeão estava certo. Bom trabalho!",
    )

    award = ChampionAward(
        champion_team_id=champion_id,
        runner_up_team_id=runner_up_id,
        awarded_by=admin.id,
        champion_users=len(champion_picks),
        runner_up_users=len(runner_up_picks),
    )
    db.add(award)
    db.commit()

    return {
        "champion_bonus":  {"team_id": champion_id,  "name": champion.name,  "users": len(champion_picks),  "pts_each": CHAMPION_BONUS},
        "runner_up_bonus": {"team_id": runner_up_id, "name": runner_up.name, "users": len(runner_up_picks), "pts_each": RUNNER_UP_BONUS},
        "awarded_at": award.awarded_at,
    }
