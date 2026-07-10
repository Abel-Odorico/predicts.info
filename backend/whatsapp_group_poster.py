"""
Avisos automáticos no grupo oficial do WhatsApp.

Grupo oficial = site_config `whatsapp_group_jid` (definido na aba Grupos do /admin/whatsapp).
Sem jid configurado, módulo não faz nada. 3 tipos de aviso por partida, dedup em
`whatsapp_group_posts` (unique match_id+kind):

- projection: até 24h antes do jogo — mesma fundamentação da projeção do Telegram
  (build_projection_message), convertida de HTML pra formatação do WhatsApp.
- reminder:   até 1h antes — chamada curta pra palpitar, com link da partida.
- result:     placar final assim que MatchResult existir. Só resultado recente
  (RESULT_MAX_AGE_HOURS) — evita flood de backlog no primeiro tick pós-ativação.

Roda dentro do cron principal (update_world_cup_data.py, 5min), isolado em try/except —
nunca derruba o sync. Teste manual: docker exec predicts_api python3 /app/whatsapp_group_poster.py
"""
import html as _html
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session, joinedload

from database import SessionLocal
from models import Match, MatchResult, MatchStatus, SiteConfig, WhatsappGroupPost
import whatsapp_client as wa
from projections import build_projection_message
from team_names_pt import PT_NAMES

PROJECTION_WINDOW_HOURS = 24
REMINDER_WINDOW_MINUTES = 60
RESULT_MAX_AGE_HOURS = 6

SITE_URL = "https://predicts.info"

_PHASE_LABEL = {
    "group": "Fase de Grupos", "r32": "Rodada de 32", "r16": "Oitavas de Final",
    "qf": "Quartas de Final", "sf": "Semifinal", "3rd": "Terceiro Lugar", "final": "Final",
}


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _html_to_wa(text: str) -> str:
    """Converte a marcação HTML das mensagens do Telegram pra formatação do WhatsApp.
    <b>/<u> viram *negrito* (WhatsApp não tem sublinhado), <i> vira _itálico_,
    qualquer outra tag cai fora, entidades são desfeitas."""
    text = re.sub(r"</?(?:b|u)>", "*", text)
    text = re.sub(r"</?i>", "_", text)
    text = re.sub(r"<[^>]+>", "", text)
    return _html.unescape(text)


def _pt_name(team) -> str:
    """teams.name no banco é inglês (Spain/Belgium) — grupo é público brasileiro."""
    return PT_NAMES.get(team.code, team.name)


def _translate_team_names(text: str, match: Match) -> str:
    """Troca os nomes ingleses das duas seleções pelo pt-BR no texto pronto —
    build_projection_message (compartilhado com o Telegram) usa team.name direto."""
    for team in (match.team_a, match.team_b):
        pt = _pt_name(team)
        if pt != team.name:
            text = text.replace(team.name, pt)
    return text


def _phase_label(match: Match) -> str:
    phase_str = match.phase.value if match.phase else "group"
    return _PHASE_LABEL.get(phase_str, phase_str)


def _local_time_str(match: Match) -> str:
    if not match.match_date:
        return "horário a definir"
    local = match.match_date - timedelta(hours=3)
    return local.strftime("%d/%m às %Hh%M (Brasília)")


def _reminder_message(match: Match) -> str:
    ta, tb = match.team_a, match.team_b
    return "\n".join([
        f"⏰ *Já vai começar — {_phase_label(match)}*",
        f"*{_pt_name(ta)} x {_pt_name(tb)}*",
        _local_time_str(match),
        "",
        f"Ainda dá tempo de palpitar 👉 {SITE_URL}/partida/{match.id}",
    ])


def _result_message(match: Match, r: MatchResult) -> str:
    ta, tb = match.team_a, match.team_b
    lines = [
        f"🏁 *FIM DE JOGO — {_phase_label(match)}*",
        f"*{_pt_name(ta)} {r.score_a} x {r.score_b} {_pt_name(tb)}*",
    ]
    if r.decided_by_penalties and r.penalty_score_a is not None:
        winner = _pt_name(ta) if (r.penalty_score_a or 0) > (r.penalty_score_b or 0) else _pt_name(tb)
        lines.append(f"⚔️ Pênaltis: {r.penalty_score_a} x {r.penalty_score_b} — avança {winner}")
    elif r.went_to_extra_time:
        lines.append("⏱️ Decidido na prorrogação")
    lines += ["", f"Veja quem pontuou 👉 {SITE_URL}/ranking"]
    return "\n".join(lines)


def send_pending_group_posts(db: Session | None = None, log=print) -> dict:
    own_session = db is None
    db = db or SessionLocal()
    sent, errors = 0, []
    try:
        row = db.query(SiteConfig).filter(SiteConfig.key == "whatsapp_group_jid").first()
        group_jid = (row.value or "").strip() if row else ""
        if not group_jid:
            log("[group-posts] grupo oficial não configurado, pulando")
            return {"sent": 0, "errors": []}

        now = _utcnow()
        posted = {(m, k) for m, k in db.query(WhatsappGroupPost.match_id, WhatsappGroupPost.kind)}

        def _post(match_id: int, kind: str, message: str):
            nonlocal sent
            if wa.send_text_to_jid(db, group_jid, message):
                db.add(WhatsappGroupPost(match_id=match_id, kind=kind))
                db.commit()
                posted.add((match_id, kind))
                sent += 1
                log(f"[group-posts] {kind} enviado (match {match_id})")
            else:
                errors.append(f"match {match_id} {kind}: envio falhou")

        upcoming = (
            db.query(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .filter(
                Match.status == MatchStatus.scheduled,
                Match.match_date.isnot(None),
                Match.match_date > now,
                Match.match_date <= now + timedelta(hours=PROJECTION_WINDOW_HOURS),
            )
            .order_by(Match.match_date)
            .all()
        )
        for m in upcoming:
            if not m.team_a or not m.team_b:
                continue
            try:
                if (m.id, "projection") not in posted:
                    msg = build_projection_message(db, m)
                    if msg:
                        _post(m.id, "projection", _translate_team_names(_html_to_wa(msg), m))
                if (m.id, "reminder") not in posted and m.match_date <= now + timedelta(minutes=REMINDER_WINDOW_MINUTES):
                    _post(m.id, "reminder", _reminder_message(m))
            except Exception as e:
                db.rollback()
                errors.append(f"match {m.id}: {e}")
                log(f"[group-posts] erro no match {m.id}: {e}")

        recent_results = (
            db.query(MatchResult)
            .join(Match, Match.id == MatchResult.match_id)
            .options(joinedload(MatchResult.match).joinedload(Match.team_a),
                     joinedload(MatchResult.match).joinedload(Match.team_b))
            .filter(MatchResult.recorded_at >= now - timedelta(hours=RESULT_MAX_AGE_HOURS))
            .all()
        )
        for r in recent_results:
            m = r.match
            if not m or not m.team_a or not m.team_b or (m.id, "result") in posted:
                continue
            try:
                _post(m.id, "result", _result_message(m, r))
            except Exception as e:
                db.rollback()
                errors.append(f"match {m.id} result: {e}")
                log(f"[group-posts] erro no resultado do match {m.id}: {e}")

        return {"sent": sent, "errors": errors}
    finally:
        if own_session:
            db.close()


if __name__ == "__main__":
    print(send_pending_group_posts())
