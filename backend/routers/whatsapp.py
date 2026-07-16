"""
POST /webhook/whatsapp              — recebe eventos da Evolution API (inbound)
POST /admin/whatsapp/send           — msg avulsa manual (admin)
GET  /admin/whatsapp/status         — estado da instância (conectado/QR/etc)
POST /admin/whatsapp/campaign       — cria + inicia campanha de disparo em massa
GET  /admin/whatsapp/campaign/{id}  — status da fila da campanha
POST /admin/whatsapp/group          — cria grupo com participantes

Fluxo de aposta por texto: usuário manda "Brasil 2x1 Argentina" → parser casa contra
partidas do dia → cria WhatsappBetSession aguardando "SIM" → confirma → grava Bet.
Sessão expira em 10min. Nunca grava aposta sem confirmação explícita.
"""
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, Query
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session
from pydantic import BaseModel

from competitions import get_competition_id
from database import get_db, SessionLocal
from auth_utils import require_admin
from models import (
    User, UserRole, Match, MatchStatus, MatchPhase, Bet, Team, WhatsappMessage, WhatsappBetSession,
    WhatsappCampaign, WhatsappCampaignRecipient, SiteConfig, AuditLog, Ranking, MatchResult,
)
from routers.bets import _is_open
from routers.audit import log_action
from team_names_pt import PT_NAMES
import whatsapp_client as wa

router = APIRouter(tags=["whatsapp"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _webhook_secret_ok(db: Session, provided: str | None) -> bool:
    row = db.query(SiteConfig).filter(SiteConfig.key == "whatsapp_webhook_secret").first()
    expected = row.value if row and row.value else None
    if not expected:
        return True  # sem secret configurado ainda (setup inicial) — não bloqueia
    return provided == expected


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def _norm(text: str) -> str:
    return _strip_accents(text or "").lower().strip()


def _phone_core(phone: str) -> str:
    """Reduz a DDD+8 dígitos, tirando DDI 55 e o 9º dígito do celular BR — pra comparar o
    telefone salvo no cadastro (formato livre, como o usuário digitou) contra o número que
    chega de verdade no JID do WhatsApp (que pode ou não ter 55/9). Ver whatsapp_client.resolve_number.
    """
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("55") and len(digits) in (12, 13):
        digits = digits[2:]
    if len(digits) == 11 and digits[2] == "9":
        digits = digits[:2] + digits[3:]
    return digits


_NUM_RE = re.compile(r"\d{1,2}")
_HELP_WORDS = ("ajuda", "help", "comandos", "oi", "ola", "bom dia", "boa tarde", "boa noite")
_MENU_WORDS = ("menu", "opcoes", "opções")
_LIST_WORDS = ("jogos", "rodada", "abertos", "lista", "partidas")
_RANKING_WORDS = ("ranking", "classificacao", "classificação")
_MYBETS_WORDS = ("palpites", "meus palpites", "meus", "minhas apostas", "apostas", "meus pontos", "pontos")
# 1ª palavra = pedido de projeção do modelo ("palpite espanha belgica", "projecao final").
# _norm tira acento, só formas sem acento aqui. "palpites" (plural exato) = _MYBETS_WORDS.
_PREDICT_WORDS = ("palpite", "projecao", "previsao", "prognostico", "modelo")
_OPTOUT_WORDS = ("parar", "sair", "descadastrar", "cancelar avisos", "stop")
_OPTIN_WORDS = ("voltar", "ativar", "reativar")
_LIST_SCORE_RE = re.compile(r"^\s*(\d{1,2})\s*[\)\.\-:]?\s*(\d{1,2})\s*x\s*(\d{1,2})\s*$")

def _help_message(nome: str | None = None) -> str:
    """Saudação personalizada: nome do cadastro (preferência) ou pushName da Evolution."""
    primeiro = (nome or "").split()[0] if nome else None
    saudacao = f"👋 *Oi, {primeiro}! Aqui é o bot de palpites do Predicts.*" if primeiro \
        else "👋 *Oi! Aqui é o bot de palpites do Predicts.*"
    return (
        f"{saudacao}\n\n"
        "Manda *menu* pra ver as opções, *jogos* pra lista numerada dos jogos abertos, ou manda o placar direto: *Brasil 2x1 Argentina*\n"
        "Eu confirmo e você responde *SIM* pra valer.\n\n"
        "*ranking* mostra o top 5 e sua posição · *palpites* mostra seus palpites e pontos.\n"
        "*palpite* + time (ex: *palpite Espanha*) mostra a projeção do modelo pro jogo.\n"
        "*campeão* + seleção (ex: *campeão Brasil*) escolhe seu campeão · *vice* + seleção escolhe o vice.\n"
        "Pra desligar os avisos, manda *parar*.\n\n"
        "🏆 predicts.info"
    )

_MENU_TEXT_FALLBACK = (
    "📱 *Menu Predicts*\n\n"
    "1️⃣ Manda *jogos* — lista numerada dos jogos abertos\n"
    "2️⃣ Manda *ranking* — top 5 + sua posição\n"
    "3️⃣ Manda *ajuda* — como apostar por aqui\n"
    "4️⃣ Manda *palpites* — seus palpites e pontos\n"
    "5️⃣ Manda *palpite* + time — projeção do modelo (ex: *palpite Espanha*)\n"
    "6️⃣ Manda *campeão* + seleção — escolhe seu campeão (ex: *campeão Brasil*); *vice* + seleção escolhe o vice\n\n"
    "Pra apostar: escolhe o número da lista + placar (*1 2x1*), ou já manda direto o nome do time (*Brasil 2x1 Argentina*)."
)

_MENU_SECTIONS = [{
    "title": "O que você quer fazer?",
    "rows": [
        {"title": "📋 Jogos abertos", "description": "Lista numerada pra apostar pelo número", "rowId": "jogos"},
        {"title": "🏆 Ranking", "description": "Top 5 + sua posição e pontos", "rowId": "ranking"},
        {"title": "📊 Meus palpites", "description": "Seus palpites e pontos", "rowId": "palpites"},
        {"title": "🔮 Palpite do modelo", "description": "Projeção do próximo jogo (ou manda: palpite + time)", "rowId": "palpite"},
        {"title": "🥇 Campeão e vice", "description": "Ex: campeão Brasil vice Argentina", "rowId": "campeao"},
        {"title": "❓ Ajuda", "description": "Como apostar pelo WhatsApp", "rowId": "ajuda"},
    ],
}]


def _wants(prefs: dict | None, key: str) -> bool:
    """Toggle por tipo de mensagem WhatsApp — ausência de chave = ligado (default)."""
    return (prefs or {}).get(key, True) is not False


def _extract_text(data: dict) -> str | None:
    msg = data.get("message") or {}
    row_id = (
        ((msg.get("listResponseMessage") or {}).get("singleSelectReply") or {}).get("selectedRowId")
    )
    return (
        row_id  # toque no menu nativo — rowId já é a palavra-comando (ex: "jogos")
        or msg.get("conversation")
        or (msg.get("extendedTextMessage") or {}).get("text")
        or None
    )


def _extract_phone(data: dict) -> str | None:
    remote = ((data.get("key") or {}).get("remoteJid") or "")
    if not remote or remote.endswith("@g.us"):
        return None  # ignora grupos
    return remote.split("@")[0]


def _pt(team) -> str:
    """Nome do time em pt-BR pras mensagens do bot (banco guarda em inglês)."""
    return PT_NAMES.get(team.code, team.name)


def _team_hits(team, norm: str) -> bool:
    """Casa nome em inglês (banco), nome em pt-BR (team_names_pt) ou código FIFA isolado."""
    name_en = _norm(team.name)
    name_pt = _norm(PT_NAMES.get(team.code, ""))
    code = _norm(team.code)
    return (
        (name_en and name_en in norm)
        or (name_pt and name_pt in norm)
        or code in norm.split()
    )


def _find_candidate_matches(db: Session, text: str) -> list[Match]:
    norm = _norm(text)
    today = _utcnow()
    from competitions import get_competition_id
    window = db.query(Match).filter(
        Match.match_date >= today - timedelta(hours=6),
        Match.match_date <= today + timedelta(hours=18),
        Match.competition_id == get_competition_id(db),
    ).all()
    hits = []
    for m in window:
        if _team_hits(m.team_a, norm) and _team_hits(m.team_b, norm):
            hits.append(m)
    return hits


def _open_matches_for_list(db: Session) -> list[Match]:
    """Jogos que ainda aceitam aposta, ordenados por data — vira a lista numerada do comando 'jogos'."""
    from competitions import get_competition_id
    upcoming = db.query(Match).filter(
        Match.status == MatchStatus.scheduled,
        Match.match_date >= _utcnow() - timedelta(hours=6),
        Match.competition_id == get_competition_id(db),
    ).order_by(Match.match_date).all()
    return [m for m in upcoming if _is_open(m)][:20]


def _match_list_message(db: Session, matches: list[Match], user: User) -> str:
    bets = {
        b.match_id: b
        for b in db.query(Bet).filter(Bet.user_id == user.id, Bet.match_id.in_([m.id for m in matches]))
    }
    linhas = []
    for i, m in enumerate(matches, start=1):
        local = m.match_date - timedelta(hours=3)  # match_date é UTC, exibir BRT
        linha = f"{i}. {_pt(m.team_a)} x {_pt(m.team_b)} — {local.strftime('%d/%m %H:%M')}"
        bet = bets.get(m.id)
        if bet:
            linha += f"\n   ✅ seu palpite: {bet.score_a}x{bet.score_b}"
            if bet.et_winner_pick:
                avanca = m.team_a if bet.et_winner_pick == "a" else m.team_b
                linha += f" (avança {_pt(avanca)})"
        linhas.append(linha)
    corpo = "\n".join(linhas)
    rodape = "Manda o número e o placar, tipo: *1 2x1*"
    if bets:
        rodape += " — vale também pra trocar um palpite já feito."
    return f"📋 *Jogos abertos pra apostar:*\n{corpo}\n\n{rodape}"


_INVITE_COOLDOWN_DAYS = 30


def _maybe_invite_unknown(db: Session, phone: str, push_name: str | None = None) -> None:
    """Número sem conta mandou mensagem: responde UMA vez com convite de cadastro,
    depois silêncio por _INVITE_COOLDOWN_DAYS (dedup por meta kind=invite no log) —
    trava anti-loop com outros bots/auto-respostas e anti-ruído. Envia daqui mesmo
    (não retorna texto pro webhook) pra gravar o log com o marcador do dedup."""
    ja_convidado = db.query(WhatsappMessage).filter(
        WhatsappMessage.phone == phone,
        WhatsappMessage.direction == "outbound",
        WhatsappMessage.meta["kind"].astext == "invite",
        WhatsappMessage.created_at > _utcnow() - timedelta(days=_INVITE_COOLDOWN_DAYS),
    ).first()
    if ja_convidado:
        return None
    primeiro = (push_name or "").split()[0] if push_name else None
    saudacao = f"👋 *Oi, {primeiro}! Aqui é o bot de palpites do Predicts — o simulador da Copa 2026.*" if primeiro \
        else "👋 *Oi! Aqui é o bot de palpites do Predicts — o simulador da Copa 2026.*"
    msg = (
        f"{saudacao}\n\n"
        "Esse número ainda não tá vinculado a nenhuma conta. Pra apostar por aqui:\n"
        "1️⃣ Cria tua conta grátis em predicts.info\n"
        "2️⃣ Cadastra esse telefone no perfil e ativa o WhatsApp\n"
        "3️⃣ Volta aqui e manda o placar, tipo *Brasil 2x1 Argentina*\n\n"
        "🏆 Bolão, ranking e projeções estatísticas te esperando!"
    )
    ok = wa.send_text(db, phone, msg, ignore_quiet=True)  # resposta a mensagem recebida
    db.add(WhatsappMessage(
        direction="outbound", phone=phone, body=msg,
        status="sent" if ok else "failed", meta={"kind": "invite"},
    ))
    db.commit()
    return None


def _model_prediction_message(db: Session, query_norm: str) -> str:
    """Projeção do modelo no chat: reusa a mensagem da Projeção do Telegram
    (build_projection_message) convertida pra formatação do WhatsApp pelos helpers
    do poster do grupo. cache_only: sem LLM no caminho — webhook é síncrono,
    resposta lenta faz a Evolution reenviar o evento (duplicata)."""
    from projections import build_projection_message
    from whatsapp_group_poster import _html_to_wa, _translate_team_names

    now = _utcnow()
    window = (
        db.query(Match)
        .filter(
            Match.status == MatchStatus.scheduled,
            Match.match_date.isnot(None),
            Match.match_date >= now - timedelta(hours=6),
            Match.match_date <= now + timedelta(days=10),
            Match.competition_id == get_competition_id(db),
        )
        .order_by(Match.match_date)
        .all()
    )
    window = [m for m in window if m.team_a and m.team_b]
    if not window:
        return "🤔 Nenhum jogo agendado nos próximos dias pra projetar."

    if query_norm:
        matches = [m for m in window if _team_hits(m.team_a, query_norm) and _team_hits(m.team_b, query_norm)]
        if not matches:  # só um time citado também vale
            matches = [m for m in window if _team_hits(m.team_a, query_norm) or _team_hits(m.team_b, query_norm)]
        if not matches:
            proximos = "\n".join(f"• {_pt(m.team_a)} x {_pt(m.team_b)}" for m in window[:5])
            return f"🤔 Não achei jogo agendado desses times. Próximos jogos:\n{proximos}\n\nManda *palpite* + nome do time."
        match = matches[0]
    else:
        match = window[0]  # "palpite" seco = próximo jogo

    msg = build_projection_message(db, match, cache_only=True)
    if not msg:
        return f"🤔 Não consegui calcular agora. Vê no site: predicts.info/partida/{match.id}"
    corpo = _translate_team_names(_html_to_wa(msg), match)
    return f"{corpo}\n\nAposta aí: *{_pt(match.team_a)} 2x1 {_pt(match.team_b)}* (com teu placar) 😉"


def _ranking_message(db: Session, user: User) -> str:
    """Top 5 + posição do usuário — mesma ordenação do GET /ranking (bets.py):
    pontos > placares exatos > nº de apostas > nome."""
    from sqlalchemy import and_, desc
    from competitions import get_competition_id
    copa_id = get_competition_id(db)
    bet_counts = (
        db.query(Bet.user_id.label("user_id"), func.count(Bet.id).label("total_bets"))
        .filter(Bet.competition_id == copa_id)
        .group_by(Bet.user_id).subquery()
    )
    rows = (
        db.query(
            User.id, User.name,
            func.coalesce(Ranking.total_points, 0).label("pts"),
            func.coalesce(Ranking.exact_scores, 0).label("exact"),
        )
        .outerjoin(Ranking, and_(User.id == Ranking.user_id, Ranking.competition_id == copa_id))
        .outerjoin(bet_counts, User.id == bet_counts.c.user_id)
        .filter(or_(Ranking.user_id.isnot(None), bet_counts.c.user_id.isnot(None)))
        .order_by(
            desc(func.coalesce(Ranking.total_points, 0)),
            desc(func.coalesce(Ranking.exact_scores, 0)),
            desc(func.coalesce(bet_counts.c.total_bets, 0)),
            User.name.asc(),
        )
        .all()
    )
    medals = ["🥇", "🥈", "🥉", "4º", "5º"]
    linhas = [
        f"{medals[i]} {r.name} — {r.pts} pts" + (f" ({r.exact} na mosca)" if r.exact else "")
        for i, r in enumerate(rows[:5])
    ]
    msg = "🏆 *Ranking Geral — Top 5*\n\n" + "\n".join(linhas)
    pos = next((i + 1 for i, r in enumerate(rows) if r.id == user.id), None)
    if pos is None:
        msg += "\n\n📍 Você ainda não pontuou — manda *jogos* e entra na disputa!"
    elif pos > 5:
        me = rows[pos - 1]
        msg += f"\n\n📍 Você: {pos}º com {me.pts} pts" + (f" ({me.exact} na mosca)" if me.exact else "")
    else:
        msg += f"\n\n📍 Você tá no top 5! 🔥"
    return msg + "\n\nCompleto: predicts.info/ranking"


def _my_bets_message(db: Session, user: User) -> str:
    """Palpites pendentes (jogos ainda não avaliados) + últimos avaliados com pontos."""
    pending = (
        db.query(Bet).join(Match, Match.id == Bet.match_id)
        .filter(Bet.user_id == user.id, Bet.evaluated_at.is_(None))
        .order_by(Match.match_date).limit(5).all()
    )
    evaluated = (
        db.query(Bet, MatchResult).join(Match, Match.id == Bet.match_id)
        .outerjoin(MatchResult, MatchResult.match_id == Match.id)
        .filter(Bet.user_id == user.id, Bet.evaluated_at.isnot(None))
        .order_by(Match.match_date.desc()).limit(3).all()
    )
    if not pending and not evaluated:
        return "📊 Você ainda não fez nenhum palpite. Manda *jogos* pra ver a lista e apostar!"

    primeiro = (user.name or "").split()[0] if user.name else None
    partes = [f"📊 *Palpites de {primeiro}*" if primeiro else "📊 *Seus palpites*"]
    if pending:
        linhas = []
        for b in pending:
            m = db.query(Match).filter(Match.id == b.match_id).first()
            local = (m.match_date - timedelta(hours=3)).strftime("%d/%m %H:%M") if m.match_date else "?"
            linhas.append(f"• {_pt(m.team_a)} {b.score_a}x{b.score_b} {_pt(m.team_b)} — {local}")
        partes.append("⏳ *Aguardando jogo:*\n" + "\n".join(linhas))
    if evaluated:
        linhas = []
        for b, r in evaluated:
            m = db.query(Match).filter(Match.id == b.match_id).first()
            pts = (b.points_earned or 0) + (b.et_points_earned or 0)
            icone = "🎯" if b.points_earned in (3, 25) else ("✅" if pts > 0 else "❌")
            final = f" (final {r.score_a}x{r.score_b})" if r else ""
            linhas.append(f"{icone} {_pt(m.team_a)} {b.score_a}x{b.score_b} {_pt(m.team_b)}{final} — +{pts} pts")
        partes.append("🏁 *Últimos avaliados:*\n" + "\n".join(linhas))

    from competitions import get_competition_id
    ranking = db.query(Ranking).filter(
        Ranking.user_id == user.id, Ranking.competition_id == get_competition_id(db)
    ).first()
    if ranking:
        partes.append(f"Total: *{ranking.total_points} pts* · predicts.info/apostas")
    else:
        partes.append("predicts.info/apostas")
    return "\n\n".join(partes)


_SKIP_WORDS = ("pular", "passar", "nenhum", "nao", "não", "n", "skip")


def _et_winner_question(match: Match) -> str:
    return (
        f"🥅 *Mata-mata!* Se {_pt(match.team_a)} {_pt(match.team_b)} empatar no tempo normal, "
        f"quem você acha que avança na prorrogação/pênaltis?\n\n"
        f"Manda *A* pra {_pt(match.team_a)} ou *B* pra {_pt(match.team_b)}.\n"
        f"Ou manda *pular* se não quiser palpitar (+10 pts bônus se acertar)."
    )


def _parse_et_winner_choice(match: Match, text: str) -> str | None | bool:
    """Retorna 'a'/'b' (escolha), None (pulou) ou False (não reconheceu)."""
    norm = _norm(text)
    if norm in _SKIP_WORDS:
        return None
    if norm == "a" or (_team_hits(match.team_a, norm) and not _team_hits(match.team_b, norm)):
        return "a"
    if norm == "b" or (_team_hits(match.team_b, norm) and not _team_hits(match.team_a, norm)):
        return "b"
    return False


def _confirmation_message(match: Match, score_a: int, score_b: int, et_winner_pick: str | None) -> str:
    corpo = f"🔮 Confirma esse palpite?\n*{_pt(match.team_a)} {score_a}x{score_b} {_pt(match.team_b)}*"
    if et_winner_pick:
        pick_team = match.team_a if et_winner_pick == "a" else match.team_b
        corpo += f"\n🥅 Se empatar, avança: *{_pt(pick_team)}*"
    return f"{corpo}\n\nResponde *SIM* pra valer."


def _extract_score(text: str) -> tuple[int, int] | None:
    """Aceita tanto placar colado ("2x1") quanto separado por texto ("Time 2 x 1 Time" ou
    "Time 2 x Time 1") — se o texto tiver exatamente 2 números, assume que são o placar,
    na ordem em que aparecem."""
    nums = _NUM_RE.findall(text)
    if len(nums) != 2:
        return None
    return int(nums[0]), int(nums[1])


def _start_bet_session(db: Session, phone: str, match: Match, score_a: int, score_b: int) -> str:
    """Cria a sessão pro próximo passo — pergunta pênaltis primeiro se for mata-mata, senão
    já pede confirmação — e retorna a mensagem a mandar."""
    if match.phase != MatchPhase.group:
        db.add(WhatsappBetSession(
            phone=phone, state="aguardando_penaltis", match_id=match.id,
            draft_score_a=score_a, draft_score_b=score_b,
            expires_at=_utcnow() + timedelta(minutes=10),
        ))
        db.commit()
        return _et_winner_question(match)
    db.add(WhatsappBetSession(
        phone=phone, state="aguardando_confirmacao", match_id=match.id,
        draft_score_a=score_a, draft_score_b=score_b,
        expires_at=_utcnow() + timedelta(minutes=10),
    ))
    db.commit()
    return _confirmation_message(match, score_a, score_b, None)


def _handle_inbound(db: Session, phone: str, text: str, push_name: str | None = None) -> str | None:
    """Retorna a resposta a mandar de volta, ou None se não deve responder.
    push_name = nome do contato no WhatsApp (pushName da Evolution) — fallback de
    saudação quando não dá pra usar o nome do cadastro."""
    target_core = _phone_core(phone)
    candidates = [
        u for u in db.query(User).filter(User.phone.isnot(None), User.is_active == True).all()  # noqa: E712
        if _phone_core(u.phone or "") == target_core
    ]
    # preferência pela conta com opt-in ativo (2 contas no mesmo fone: comportamento antigo)
    user = next((u for u in candidates if u.whatsapp_opt_in), candidates[0] if candidates else None)
    if not user:
        return _maybe_invite_unknown(db, phone, push_name)  # convite de cadastro, 1x por fone/30d

    if not user.whatsapp_opt_in:
        # opt-out feito por mensagem: só responde ao pedido de religar, resto silêncio
        if _norm(text) in _OPTIN_WORDS:
            user.whatsapp_opt_in = True
            log_action(db, user.id, "whatsapp.opt_in", {"via": "whatsapp"})
            db.commit()
            return "🔔 *Avisos religados!* Bem-vindo de volta. Manda *menu* pra ver as opções."
        return None

    session = db.query(WhatsappBetSession).filter(
        WhatsappBetSession.phone == phone,
        WhatsappBetSession.expires_at > _utcnow(),
    ).order_by(WhatsappBetSession.id.desc()).first()

    if session and session.state == "aguardando_penaltis":
        match = db.query(Match).filter(Match.id == session.match_id).first()
        if not match or not _is_open(match):
            db.delete(session)
            db.commit()
            return "⏱️ Essa partida não existe mais ou as apostas já encerraram."
        choice = _parse_et_winner_choice(match, text)
        if choice is False:
            return _et_winner_question(match)  # não reconheceu — repete a pergunta
        session.state = "aguardando_confirmacao"
        session.draft_et_winner_pick = choice
        db.commit()
        return _confirmation_message(match, session.draft_score_a, session.draft_score_b, choice)

    if session and session.state == "aguardando_confirmacao":
        if _norm(text) in ("sim", "s", "confirma", "confirmar", "yes"):
            match = db.query(Match).filter(Match.id == session.match_id).first()
            if not match or not _is_open(match):
                db.delete(session)
                db.commit()
                return "⏱️ Essa partida não existe mais ou as apostas já encerraram."
            et_pick = session.draft_et_winner_pick if match.phase != MatchPhase.group else None
            existing = db.query(Bet).filter(Bet.user_id == user.id, Bet.match_id == match.id).first()
            if existing:
                existing.score_a, existing.score_b = session.draft_score_a, session.draft_score_b
                existing.et_winner_pick = et_pick
            else:
                db.add(Bet(
                    user_id=user.id, match_id=match.id,
                    competition_id=match.competition_id,
                    score_a=session.draft_score_a, score_b=session.draft_score_b,
                    et_winner_pick=et_pick,
                ))
            log_action(db, user.id, "bet.place", {
                "match_id": match.id,
                "score": f"{session.draft_score_a}-{session.draft_score_b}",
                "et_winner_pick": et_pick,
                "via": "whatsapp",
            })
            db.delete(session)
            db.commit()
            penaltis_linha = ""
            if et_pick:
                pick_team = match.team_a if et_pick == "a" else match.team_b
                penaltis_linha = f"🥅 Se empatar, avança: {_pt(pick_team)}\n"
            return (
                f"✅ *Palpite registrado!*\n"
                f"{_pt(match.team_a)} {session.draft_score_a}x{session.draft_score_b} {_pt(match.team_b)}\n"
                f"{penaltis_linha}\n"
                f"🏆 Boa sorte! Acompanha em predicts.info"
            )
        else:
            db.delete(session)
            db.commit()
            return "❌ Palpite cancelado. Manda de novo assim: *Brasil 2x1 Argentina*"

    norm = _norm(text)

    if session and session.state == "lista_enviada":
        m = _LIST_SCORE_RE.match(norm)
        if m:
            try:
                ids = json.loads(session.list_json or "[]")
            except ValueError:
                ids = []
            idx = int(m.group(1))
            if idx < 1 or idx > len(ids):
                return "🤔 Número inválido. Manda *jogos* de novo pra ver a lista atual."
            match = db.query(Match).filter(Match.id == ids[idx - 1]).first()
            if not match or not _is_open(match):
                return "⏱️ Esse jogo não existe mais ou as apostas já encerraram. Manda *jogos* pra atualizar a lista."
            score_a, score_b = int(m.group(2)), int(m.group(3))
            db.delete(session)
            return _start_bet_session(db, phone, match, score_a, score_b)
        # não bateu número+placar — cai pro fluxo normal (nome dos times, novo 'jogos', etc.)
        if re.fullmatch(r"\d{1,2}", norm):
            return f"🤔 Falta o placar! Manda o número do jogo com o placar junto, tipo: *{norm} 2x1*"

    if norm in _MENU_WORDS:
        if session and session.state == "lista_enviada":
            # menu substitui a lista de jogos: número solto depois do menu volta a ser
            # atalho do menu (1-5), não jogo da lista — caso real: usuário pediu jogos,
            # depois menu, respondeu "2" (ranking) e caiu no "falta o placar"
            db.delete(session)
            db.commit()
        if wa.send_list(db, phone, "Predicts.info", "Escolhe uma opção 👇", "Ver opções", _MENU_SECTIONS, ignore_quiet=True):
            db.add(WhatsappMessage(direction="outbound", phone=phone, body="[menu nativo]", status="sent"))
            db.commit()
            return None  # já mandou por fora do fluxo normal de texto
        # sendList quebrado na Evolution 2.3.7 ("this.isZero is not a function") —
        # na prática o menu numerado em texto É o menu; manter tentativa nativa é grátis
        return _MENU_TEXT_FALLBACK

    if norm in _OPTOUT_WORDS:
        user.whatsapp_opt_in = False
        if session:
            db.delete(session)
        log_action(db, user.id, "whatsapp.opt_out", {"via": "whatsapp"})
        db.commit()
        return (
            "🔕 *Avisos desligados.* Não mando mais nada por aqui.\n"
            "Sua conta no site continua normal. Pra religar, manda *voltar* "
            "ou ativa no seu perfil em predicts.info"
        )

    # "6" solto = resposta ao menu numerado (opção campeão) — mesmo golpe do "1/2/3/4"
    # abaixo: _champion_command só reconhece "campeao"/"vice" por extenso, nunca o dígito.
    champion_reply = _champion_command(db, user, "campeao" if norm == "6" else norm)
    if champion_reply is not None:
        return champion_reply

    # "1/2/3/4" solto = resposta ao menu numerado da boas-vindas/_MENU_TEXT_FALLBACK
    # (caso real: usuários responderam "1" e ficavam sem resposta nenhuma)
    if norm in _RANKING_WORDS or norm == "2":
        return _ranking_message(db, user)

    if norm in _MYBETS_WORDS or norm == "4":
        return _my_bets_message(db, user)

    first_word = norm.split()[0] if norm else ""
    if first_word in _PREDICT_WORDS or norm == "5":
        resto = norm[len(first_word):].strip() if first_word in _PREDICT_WORDS else ""
        return _model_prediction_message(db, resto)

    if norm in _LIST_WORDS or norm == "1":
        matches = _open_matches_for_list(db)
        if not matches:
            return "📋 Nenhum jogo aberto pra apostar agora. Volta mais tarde!"
        if session:
            db.delete(session)
        db.add(WhatsappBetSession(
            phone=phone, state="lista_enviada",
            list_json=json.dumps([m.id for m in matches]),
            expires_at=_utcnow() + timedelta(minutes=10),
        ))
        db.commit()
        return _match_list_message(db, matches, user)

    score = _extract_score(text)
    if not score:
        # saudação exata, 1ª palavra saudação ("Oi! Quero apostar..." — texto do próprio link
        # wa.me do opt-in caía no silêncio), "quero apostar", ou "3" do menu numerado
        first_word = norm.split()[0].strip("!?.,") if norm else ""
        if norm in _HELP_WORDS or first_word in _HELP_WORDS or "quero apostar" in norm or norm == "3":
            return _help_message(user.name or push_name)
        return None  # texto sem placar reconhecível — não responde (evita ruído em conversa normal)

    candidates = _find_candidate_matches(db, text)
    if len(candidates) == 0:
        return "🤔 Não achei essa partida na janela de hoje. Confere o nome ou o código do time e tenta de novo."
    if len(candidates) > 1:
        lista = "\n".join(f"• {_pt(m.team_a)} x {_pt(m.team_b)}" for m in candidates)
        return (
            f"🤔 Achei mais de uma partida parecida:\n{lista}\n\n"
            f"Manda com o nome completo do time pra eu acertar, ou aposta direto em predicts.info"
        )

    match = candidates[0]
    if not _is_open(match):
        return f"⏱️ Apostas encerradas para {_pt(match.team_a)} x {_pt(match.team_b)}."

    score_a, score_b = score
    return _start_bet_session(db, phone, match, score_a, score_b)


def _champion_candidates(db: Session, comp_id: int) -> list[Team]:
    """Seleções ainda vivas na Copa: times da fase eliminatória mais próxima que ainda
    não jogou (status 'scheduled'). Hoje = semifinal (4 times); avança sozinho pra final
    quando a semi terminar e sync marcar os jogos de sf como finished."""
    row = db.execute(text(
        "SELECT phase FROM matches WHERE competition_id = :c AND status = 'scheduled' "
        "AND phase IN ('r16','qf','sf','final') ORDER BY match_date LIMIT 1"
    ), {"c": comp_id}).fetchone()
    if not row:
        return []
    matches = (
        db.query(Match)
        .filter(Match.competition_id == comp_id, Match.phase == row[0])
        .order_by(Match.match_date)
        .all()
    )
    seen, out = set(), []
    for m in matches:
        for t in (m.team_a, m.team_b):
            if t.id not in seen:
                seen.add(t.id)
                out.append(t)
    return out


def _champion_candidates_message(candidates: list[Team]) -> str:
    linhas = "\n".join(f"{i}. {_pt(t)}" for i, t in enumerate(candidates, start=1))
    return (
        "🏆 *Só restam essas seleções pra campeão e vice:*\n"
        f"{linhas}\n\n"
        "Manda *campeão <número>* pro campeão (ex: *campeão 1*)\n"
        "Manda *vice <número>* pro vice (ex: *vice 2*)\n"
        "Ou os dois juntos: *campeão 1 vice 2*"
    )


def _champion_command(db: Session, user: User, norm: str) -> str | None:
    """Palpite de Campeão/Vice pelo WhatsApp. Comandos:
    'campeao <selecao>' · 'vice <selecao>' · 'campeao <selecao> vice <selecao>'.
    Aceita formatos soltos tipo 'Campeão: Argentina\\nVice campeão: Espanha' (pontuação/
    quebra de linha viram espaço; 'vice campeao' — fraseado natural de vice-campeão — colapsa
    pra 'vice' antes de separar os dois blocos).
    Retorna None se `norm` não é comando de campeão (deixa cair pro fluxo normal)."""
    cleaned = re.sub(r"[:\-–—,.;\n]", " ", norm)
    cleaned = re.sub(r"\bvice\s+campeao\b", "vice", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if not (cleaned == "campeao" or cleaned.startswith("campeao ") or cleaned == "vice" or cleaned.startswith("vice ")):
        return None

    from routers.champion import ChampionPick, _can_change, _deadline, CHAMPION_BONUS, RUNNER_UP_BONUS

    if not _can_change(db):
        dl_brt = (_deadline(db) - timedelta(hours=3)).strftime("%d/%m %H:%M")
        return f"⏱️ Prazo pra escolher campeão/vice encerrado ({dl_brt}). Fica de olho pra próxima reabertura!"

    champion_chunk = runnerup_chunk = None
    if "vice" in cleaned:
        before, _sep, after = cleaned.partition("vice")
        before = before.strip()
        if before.startswith("campeao"):
            champion_chunk = before[len("campeao"):].strip()
        runnerup_chunk = after.strip()
    elif cleaned.startswith("campeao"):
        champion_chunk = cleaned[len("campeao"):].strip()

    comp_id = get_competition_id(db, "copa2026")
    candidates = _champion_candidates(db, comp_id)

    if not champion_chunk and not runnerup_chunk:
        if candidates:
            return _champion_candidates_message(candidates)
        return (
            "🏆 Pra escolher, manda assim:\n"
            "*campeão Brasil* — só o campeão\n"
            "*vice Argentina* — só o vice\n"
            "*campeão Brasil vice Argentina* — os dois juntos"
        )

    teams = db.query(Team).filter(Team.competition_id == comp_id).all()
    pick = db.query(ChampionPick).filter(ChampionPick.user_id == user.id).first()
    new_champion_id = pick.team_id if pick else None
    new_runnerup_id = pick.runner_up_team_id if pick else None
    reply_lines = []

    for chunk, bonus, label in ((champion_chunk, CHAMPION_BONUS, "champion"), (runnerup_chunk, RUNNER_UP_BONUS, "runnerup")):
        if not chunk:
            continue
        if chunk.isdigit() and candidates:
            idx = int(chunk)
            if idx < 1 or idx > len(candidates):
                return f"🤔 Número inválido. {_champion_candidates_message(candidates)}"
            hits = [candidates[idx - 1]]
        else:
            hits = [t for t in teams if _team_hits(t, chunk)]
        if len(hits) == 0:
            return f"🤔 Não achei \"{chunk}\" entre as seleções da Copa. Confere o nome e tenta de novo."
        if len(hits) > 1:
            nomes = ", ".join(_pt(t) for t in hits)
            return f"🤔 Achei mais de uma seleção parecida: {nomes}. Manda o nome completo."
        team = hits[0]
        if candidates and team.id not in {c.id for c in candidates}:
            return f"🤔 {_pt(team)} já foi eliminada. {_champion_candidates_message(candidates)}"
        other_id = new_runnerup_id if label == "champion" else new_champion_id
        if other_id == team.id:
            return "🤔 Campeão e vice não podem ser o mesmo time."
        if label == "champion":
            new_champion_id = team.id
            reply_lines.append(f"🥇 Campeão: {_pt(team)} (+{bonus} pts se acertar)")
        else:
            new_runnerup_id = team.id
            reply_lines.append(f"🥈 Vice: {_pt(team)} (+{bonus} pts se acertar)")

    if not new_champion_id:
        return "🤔 Preciso pelo menos do campeão pra salvar. Manda: *campeão <seleção>*"

    if pick:
        pick.team_id = new_champion_id
        pick.runner_up_team_id = new_runnerup_id
    else:
        db.add(ChampionPick(user_id=user.id, team_id=new_champion_id, runner_up_team_id=new_runnerup_id))
    log_action(db, user.id, "champion.pick", {
        "team_id": new_champion_id, "runner_up_team_id": new_runnerup_id, "via": "whatsapp",
    })
    db.commit()
    corpo = "\n".join(reply_lines)
    return f"✅ *Palpite de campeão salvo!*\n{corpo}\n\nAcompanha em predicts.info/campeao"


def send_welcome_whatsapp(user_id: int) -> None:
    """Best-effort, roda em BackgroundTask (auth.py::register e update_profile) — abre sessão própria, nunca levanta."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.phone or not user.whatsapp_opt_in:
            return
        welcome = (
            f"🏆 *Fala, {user.name}! WhatsApp ativado no Predicts.*\n\n"
            f"Login: {user.email}" + (f" (usuário: {user.username})" if user.username else "") + "\n\n"
            f"{_MENU_TEXT_FALLBACK}\n\n"
            "Depois de mandar o placar, confirma com *SIM* e tá valendo.\n\n"
            "Manda *menu* sempre que quiser rever essas opções.\n"
            "predicts.info"
        )
        ok = wa.send_text(db, user.phone, welcome, ignore_quiet=True)
        db.add(WhatsappMessage(direction="outbound", phone=user.phone, body=welcome, status="sent" if ok else "failed"))
        db.commit()
    except Exception:
        pass
    finally:
        db.close()


def send_bet_confirmation_whatsapp(user_id: int, match_id: int, score_a: int, score_b: int) -> None:
    """Best-effort, roda em BackgroundTask (routers/bets.py::place_bet) — confirma por WhatsApp
    palpite feito pelo SITE (não pelo chat do WhatsApp), pra quem tem opt-in ativo."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.phone or not user.whatsapp_opt_in:
            return
        if not _wants(user.whatsapp_prefs, "bet_confirmation"):
            return
        match = db.query(Match).filter(Match.id == match_id).first()
        if not match:
            return
        msg = (
            f"✅ *Palpite confirmado pelo site!*\n"
            f"{_pt(match.team_a)} {score_a}x{score_b} {_pt(match.team_b)}\n\n"
            f"🏆 Boa sorte! Dá pra ajustar até a bola rolar."
        )
        ok = wa.send_text(db, user.phone, msg, ignore_quiet=True)
        db.add(WhatsappMessage(direction="outbound", phone=user.phone, body=msg, match_id=match.id, status="sent" if ok else "failed"))
        db.commit()
    except Exception:
        pass
    finally:
        db.close()


def run_pending_bet_reminders(
    db: Session,
    match_ids: list[int] | None = None,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    exclude_match_ids: set[int] | None = None,
    dry_run: bool = False,
) -> dict:
    """Lembrete WhatsApp pra quem tem opt-in mas AINDA NÃO apostou numa partida.

    Dois modos de seleção de partida (mutuamente exclusivos):
    - `match_ids`: lista explícita (usado pelo teste manual do admin, ignora status/janela)
    - `window_start`/`window_end`: partidas `scheduled` com `match_date` na janela (usado pelo
      loop automático 1h antes do jogo, em main.py::_pending_bet_whatsapp_reminder_loop)

    `dry_run=True` só monta a prévia (destinatários + texto), não manda nada nem grava log.
    Suporta mandar pra mais de um destinatário na mesma partida numa única chamada — cada
    partida vira 1 mensagem, disparada pra todos que ainda não apostaram nela.
    """
    import random
    import time

    if match_ids:
        where_clause = "m.id = ANY(:match_ids)"
        params: dict = {"match_ids": list(match_ids)}
    else:
        where_clause = "m.status = 'scheduled' AND m.match_date BETWEEN :ws AND :we"
        params = {"ws": window_start, "we": window_end}

    rows = db.execute(text(f"""
        SELECT m.id AS match_id, ta.name AS team_a, ta.code AS team_a_code,
               tb.name AS team_b, tb.code AS team_b_code, m.match_date,
               u.id AS user_id, u.phone, u.name AS user_name
        FROM matches m
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        CROSS JOIN users u
        WHERE {where_clause}
          AND u.whatsapp_opt_in = true
          AND u.phone IS NOT NULL AND u.phone != ''
          AND (u.whatsapp_prefs->>'bet_reminder') IS DISTINCT FROM 'false'
          AND NOT EXISTS (
              SELECT 1 FROM bets b WHERE b.match_id = m.id AND b.user_id = u.id
          )
    """), params).fetchall()

    exclude_match_ids = exclude_match_ids or set()
    by_match: dict[int, dict] = {}
    for r in rows:
        if r.match_id in exclude_match_ids:
            continue
        if r.match_id not in by_match:
            by_match[r.match_id] = {
                "team_a": PT_NAMES.get(r.team_a_code, r.team_a),
                "team_b": PT_NAMES.get(r.team_b_code, r.team_b),
                "match_date": r.match_date, "recipients": [],
            }
        by_match[r.match_id]["recipients"].append({"user_id": r.user_id, "phone": r.phone, "name": r.user_name})

    result_matches = []
    total_sent = 0
    for match_id, info in by_match.items():
        brt_time = (info["match_date"] - timedelta(hours=3)).strftime("%H:%M")

        def _msg(nome: str | None) -> str:
            primeiro = (nome or "").split()[0] if nome else None
            abertura = f"⏰ *{primeiro}, {info['team_a']} x {info['team_b']} começa em 1h!*" if primeiro \
                else f"⏰ *{info['team_a']} x {info['team_b']} começa em 1h!*"
            return (
                f"{abertura}\n\n"
                f"Você ainda não apostou nesse jogo. Manda o placar aqui, tipo "
                f"*{info['team_a']} 2x1 {info['team_b']}*, confirma com *SIM* e garante "
                f"seus pontos antes da bola rolar.\n\n"
                f"Jogo às {brt_time} BRT."
            )

        msg = _msg(None)  # prévia do dry_run (sem nome, texto-base)
        if not dry_run:
            for rec in info["recipients"]:
                corpo = _msg(rec.get("name"))
                ok = wa.send_text(db, rec["phone"], corpo, ignore_quiet=True)
                db.add(WhatsappMessage(
                    direction="outbound", phone=rec["phone"], body=corpo,
                    match_id=match_id, status="sent" if ok else "failed",
                ))
                db.commit()
                total_sent += 1
                time.sleep(random.uniform(3, 8))  # anti-ban, mesmo padrão da campanha
        result_matches.append({
            "match_id": match_id, "team_a": info["team_a"], "team_b": info["team_b"],
            "match_date": info["match_date"].isoformat(),
            "recipients": [r["phone"] for r in info["recipients"]],
            "recipients_count": len(info["recipients"]),
            "message_preview": msg,
        })
    return {"matches": result_matches, "total_sent": total_sent, "dry_run": dry_run}


class ReminderTestPayload(BaseModel):
    match_id: int | None = None
    hours_ahead: float = 1.0
    dry_run: bool = True


@router.post("/admin/whatsapp/reminder/test")
def admin_test_pending_reminder(
    payload: ReminderTestPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Simula/dispara manualmente o lembrete de palpite pendente, sem esperar a janela real de
    1h antes do jogo. Passa `match_id` pra testar uma partida específica (ignora status/data),
    ou `hours_ahead` pra simular a janela de tempo (partida real precisa existir nesse horário).
    `dry_run=true` (padrão) só mostra quem receberia — muda pra `false` pra mandar de verdade."""
    if payload.match_id:
        return run_pending_bet_reminders(db, match_ids=[payload.match_id], dry_run=payload.dry_run)
    now = _utcnow()
    center = now + timedelta(hours=payload.hours_ahead)
    return run_pending_bet_reminders(
        db,
        window_start=center - timedelta(minutes=30),
        window_end=center + timedelta(minutes=30),
        dry_run=payload.dry_run,
    )


@router.get("/whatsapp/contact")
def whatsapp_contact(db: Session = Depends(get_db)):
    """Público — número do bot pra montar link wa.me no popup de opt-in."""
    info = wa.instance_info(db) or {}
    number = info.get("number")
    if not number:
        return {"available": False}
    from urllib.parse import quote
    return {
        "available": True,
        "number": number,
        "wa_link": f"https://wa.me/{number}?text={quote('Oi! Quero apostar pelo WhatsApp')}",
    }


_ACK_STATUS = {"SERVER_ACK": "sent", "DELIVERY_ACK": "delivered", "READ": "read", "PLAYED": "read"}
_ACK_RANK = {"pending": 0, "failed": 0, "sent": 1, "delivered": 2, "read": 3}


def _apply_message_acks(db: Session, data) -> None:
    """MESSAGES_UPDATE da Evolution: ack de entrega (✓✓) e leitura por mensagem.
    Casa pelo key.id guardado no envio (wa_message_id). Ack só PROMOVE status
    (sent → delivered → read), nunca rebaixa — updates chegam fora de ordem."""
    items = data if isinstance(data, list) else [data]
    for item in items:
        if not isinstance(item, dict):
            continue
        key_id = item.get("keyId") or ((item.get("key") or {}).get("id"))
        new_status = _ACK_STATUS.get((item.get("status") or "").upper())
        if not key_id or not new_status:
            continue
        for row in db.query(WhatsappMessage).filter(WhatsappMessage.wa_message_id == key_id).all():
            if _ACK_RANK.get(new_status, 0) > _ACK_RANK.get(row.status or "sent", 0):
                row.status = new_status
        now = _utcnow()
        for rec in db.query(WhatsappCampaignRecipient).filter(
            WhatsappCampaignRecipient.wa_message_id == key_id
        ).all():
            if _ACK_RANK.get(new_status, 0) > _ACK_RANK.get(rec.status or "sent", 0):
                rec.status = new_status
            if new_status in ("delivered", "read") and not rec.delivered_at:
                rec.delivered_at = now
            if new_status == "read" and not rec.read_at:
                rec.read_at = now
    db.commit()


@router.post("/webhook/whatsapp")
def whatsapp_webhook(
    payload: dict,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
):
    if not _webhook_secret_ok(db, request.query_params.get("secret")):
        raise HTTPException(403, "Invalid webhook secret")

    if payload.get("event") == "messages.update":
        _apply_message_acks(db, payload.get("data"))
        return {"ok": True}

    if payload.get("event") != "messages.upsert":
        return {"ok": True}

    data = payload.get("data") or {}
    if (data.get("key") or {}).get("fromMe"):
        return {"ok": True}

    phone = _extract_phone(data)
    text = _extract_text(data)
    if not phone or not text:
        return {"ok": True}

    push_name = (data.get("pushName") or "").strip() or None  # nome do contato no WhatsApp
    db.add(WhatsappMessage(
        direction="inbound", phone=phone, body=text, status="received",
        meta={"push_name": push_name} if push_name else None,
    ))
    db.commit()

    try:
        reply = _handle_inbound(db, phone, text, push_name)
    except Exception:
        reply = None
    if reply:
        wa.send_text(db, phone, reply, ignore_quiet=True)
        db.add(WhatsappMessage(direction="outbound", phone=phone, body=reply, status="sent"))
        db.commit()
    return {"ok": True}


# ---- Admin ----

class SendPayload(BaseModel):
    phone: str
    message: str


@router.post("/admin/whatsapp/send")
def admin_send(payload: SendPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ok = wa.send_text(db, payload.phone, payload.message, ignore_quiet=True)
    db.add(WhatsappMessage(direction="outbound", phone=payload.phone, body=payload.message, status="sent" if ok else "failed"))
    db.commit()
    if not ok:
        raise HTTPException(502, "Falha ao enviar (instância desconectada ou WhatsApp desativado)")
    return {"ok": True}


@router.get("/admin/whatsapp/status")
def admin_status(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    result = wa.instance_status(db) or {"state": "unknown"}
    result["info"] = wa.instance_info(db)
    result["webhook"] = wa.webhook_status(db)
    return result


def _chat_preview(c: dict) -> str | None:
    msg = (c.get("lastMessage") or {}).get("message") or {}
    text = msg.get("conversation") or (msg.get("extendedTextMessage") or {}).get("text")
    if not text:
        return None
    return text if len(text) <= 140 else text[:140] + "…"


@router.get("/admin/whatsapp/chats")
def admin_list_chats(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    chats = wa.find_chats(db)
    if chats is None:
        raise HTTPException(502, "Falha ao listar conversas (instância desconectada ou WhatsApp desativado)")

    # cross-referência com usuários cadastrados só é possível pra jids reais (@s.whatsapp.net);
    # a maioria vem como @lid (WhatsApp esconde o número por privacidade) — nesses não dá pra casar.
    users_by_phone = {
        wa.normalize_jid(u.phone): u for u in db.query(User).filter(User.phone.isnot(None))
    }

    out = []
    for c in chats:
        jid = c.get("remoteJid") or ""
        is_group = jid.endswith("@g.us")
        phone = jid.split("@")[0] if jid.endswith("@s.whatsapp.net") else None
        matched = users_by_phone.get(wa.normalize_jid(phone)) if phone else None
        out.append({
            "id": jid,
            "name": (matched.name if matched else None) or c.get("pushName") or (phone or jid.split("@")[0]),
            "matched_user_email": matched.email if matched else None,
            "profile_pic_url": c.get("profilePicUrl"),
            "is_group": is_group,
            "updated_at": c.get("updatedAt"),
            "unread_count": c.get("unreadCount") or 0,
            "window_active": c.get("windowActive"),
            "window_expires": c.get("windowExpires"),
            "last_message_preview": _chat_preview(c),
            "last_message_from_me": ((c.get("lastMessage") or {}).get("key") or {}).get("fromMe"),
        })
    out.sort(key=lambda x: x["updated_at"] or "", reverse=True)
    return out[:100]


def _thread_msg_text(m: dict) -> str:
    msg = m.get("message") or {}
    return (
        msg.get("conversation")
        or (msg.get("extendedTextMessage") or {}).get("text")
        or (msg.get("imageMessage") or {}).get("caption")
        or (msg.get("videoMessage") or {}).get("caption")
        or "[mídia/mensagem não suportada aqui]"
    )


def _resolve_chat_jid(db: Session, jid: str | None, phone: str | None) -> str | None:
    if jid:
        return jid
    if phone:
        number = wa.resolve_number(db, phone)
        return f"{number}@s.whatsapp.net" if number else None
    return None


@router.get("/admin/whatsapp/chat/messages")
def admin_chat_messages(
    jid: str | None = Query(default=None), phone: str | None = Query(default=None),
    db: Session = Depends(get_db), admin: User = Depends(require_admin),
):
    jid = _resolve_chat_jid(db, jid, phone)
    if not jid:
        raise HTTPException(400, "Informe jid ou phone")
    records = wa.find_messages(db, jid)
    if records is None:
        raise HTTPException(502, "Falha ao buscar mensagens (instância desconectada?)")
    out = [
        {
            "id": (m.get("key") or {}).get("id") or m.get("id"),
            "from_me": bool((m.get("key") or {}).get("fromMe")),
            "text": _thread_msg_text(m),
            "timestamp": m.get("messageTimestamp"),
        }
        for m in records
    ]
    out.sort(key=lambda x: x["timestamp"] or 0)
    return {"jid": jid, "messages": out}


class ChatSendPayload(BaseModel):
    jid: str
    message: str


@router.post("/admin/whatsapp/chat/send")
def admin_chat_send(payload: ChatSendPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ok = wa.send_text_to_jid(db, payload.jid, payload.message, ignore_quiet=True)
    phone = payload.jid.split("@")[0]
    db.add(WhatsappMessage(direction="outbound", phone=phone, body=payload.message, status="sent" if ok else "failed"))
    db.commit()
    if not ok:
        raise HTTPException(502, "Falha ao enviar (instância desconectada?)")
    return {"ok": True}


@router.get("/admin/whatsapp/qrcode")
def admin_qrcode(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    result = wa.instance_qrcode(db)
    if result is None:
        raise HTTPException(502, "Falha ao gerar QR (confira apikey/url em Configurações)")
    return result


@router.get("/admin/whatsapp/campaigns")
def admin_list_campaigns(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    campaigns = db.query(WhatsappCampaign).order_by(WhatsappCampaign.id.desc()).limit(30).all()
    out = []
    for c in campaigns:
        counts = dict(
            db.query(WhatsappCampaignRecipient.status, func.count(WhatsappCampaignRecipient.id))
            .filter(WhatsappCampaignRecipient.campaign_id == c.id)
            .group_by(WhatsappCampaignRecipient.status)
            .all()
        )
        delivered = counts.get("delivered", 0)
        read = counts.get("read", 0)
        out.append({
            "id": c.id, "message": c.message, "status": c.status,
            "created_at": c.created_at, "scheduled_at": c.scheduled_at,
            "total": sum(counts.values()),
            # sent acumula os que progrediram pra delivered/read (ack só melhora o status)
            "sent": counts.get("sent", 0) + delivered + read,
            "failed": counts.get("failed", 0),
            "delivered": delivered + read,  # lido implica entregue
            "read": read,
        })
    return out


@router.post("/admin/whatsapp/campaign/{campaign_id}/cancel")
def admin_cancel_campaign(campaign_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    campaign = db.query(WhatsappCampaign).filter(WhatsappCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    campaign.status = "canceled"
    db.query(WhatsappCampaignRecipient).filter(
        WhatsappCampaignRecipient.campaign_id == campaign_id, WhatsappCampaignRecipient.status == "pending"
    ).delete()
    db.commit()
    return {"ok": True}


@router.post("/admin/whatsapp/campaign/{campaign_id}/retry")
def admin_retry_campaign(campaign_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    campaign = db.query(WhatsappCampaign).filter(WhatsappCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    n = db.query(WhatsappCampaignRecipient).filter(
        WhatsappCampaignRecipient.campaign_id == campaign_id, WhatsappCampaignRecipient.status == "failed"
    ).update({"status": "pending", "sent_at": None})
    campaign.status = "running"
    db.commit()
    return {"ok": True, "requeued": n}


@router.get("/admin/whatsapp/messages")
def admin_list_messages(
    phone: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    q = db.query(WhatsappMessage).order_by(WhatsappMessage.id.desc())
    if phone:
        q = q.filter(WhatsappMessage.phone.ilike(f"%{wa.normalize_jid(phone)}%"))
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {"id": m.id, "direction": m.direction, "phone": m.phone, "body": m.body,
             "status": m.status, "created_at": m.created_at}
            for m in rows
        ],
    }


@router.get("/admin/whatsapp/sessions")
def admin_list_sessions(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rows = db.query(WhatsappBetSession).filter(
        WhatsappBetSession.expires_at > _utcnow()
    ).order_by(WhatsappBetSession.id.desc()).all()
    out = []
    for s in rows:
        match = db.query(Match).filter(Match.id == s.match_id).first()
        out.append({
            "id": s.id, "phone": s.phone, "state": s.state,
            "match": f"{match.team_a.name} x {match.team_b.name}" if match else None,
            "draft_score": f"{s.draft_score_a}x{s.draft_score_b}",
            "draft_et_winner_pick": s.draft_et_winner_pick,
            "expires_at": s.expires_at,
        })
    return out


@router.delete("/admin/whatsapp/session/{session_id}")
def admin_cancel_session(session_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    session = db.query(WhatsappBetSession).filter(WhatsappBetSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Sessão não encontrada")
    db.delete(session)
    db.commit()
    return {"ok": True}


@router.get("/admin/whatsapp/contacts")
def admin_list_contacts(
    q: str | None = Query(default=None),
    only_opt_in: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    query = db.query(User).filter(User.phone.isnot(None))
    if only_opt_in:
        query = query.filter(User.whatsapp_opt_in == True)  # noqa: E712
    if q:
        like = f"%{q}%"
        query = query.filter(or_(User.name.ilike(like), User.email.ilike(like), User.phone.ilike(like)))
    total = query.count()
    users = query.order_by(User.id.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {"id": u.id, "name": u.name, "email": u.email, "phone": u.phone, "whatsapp_opt_in": u.whatsapp_opt_in}
            for u in users
        ],
    }


@router.get("/admin/whatsapp/analytics")
def admin_analytics(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    total_with_phone = db.query(func.count(User.id)).filter(User.phone.isnot(None)).scalar() or 0
    total_opt_in = db.query(func.count(User.id)).filter(User.whatsapp_opt_in == True).scalar() or 0  # noqa: E712

    inbound = db.query(func.count(WhatsappMessage.id)).filter(WhatsappMessage.direction == "inbound").scalar() or 0
    outbound_sent = db.query(func.count(WhatsappMessage.id)).filter(
        WhatsappMessage.direction == "outbound", WhatsappMessage.status == "sent"
    ).scalar() or 0
    outbound_failed = db.query(func.count(WhatsappMessage.id)).filter(
        WhatsappMessage.direction == "outbound", WhatsappMessage.status == "failed"
    ).scalar() or 0

    active_sessions = db.query(func.count(WhatsappBetSession.id)).filter(
        WhatsappBetSession.expires_at > _utcnow()
    ).scalar() or 0

    bets_via_wa = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action == "bet.place", AuditLog.details.ilike('%"via": "whatsapp"%')
    ).scalar() or 0

    campaigns_total = db.query(func.count(WhatsappCampaign.id)).scalar() or 0
    campaigns_running = db.query(func.count(WhatsappCampaign.id)).filter(WhatsappCampaign.status == "running").scalar() or 0

    since = _utcnow() - timedelta(days=14)
    daily_rows = (
        db.query(
            func.date(WhatsappMessage.created_at).label("day"),
            WhatsappMessage.direction,
            func.count(WhatsappMessage.id),
        )
        .filter(WhatsappMessage.created_at >= since)
        .group_by(func.date(WhatsappMessage.created_at), WhatsappMessage.direction)
        .all()
    )
    daily_map: dict[str, dict] = {}
    for day, direction, count in daily_rows:
        key = day.isoformat()
        daily_map.setdefault(key, {"date": key, "inbound": 0, "outbound": 0})
        daily_map[key][direction] = count
    daily = sorted(daily_map.values(), key=lambda r: r["date"])

    return {
        "opt_in": {"total_with_phone": total_with_phone, "opted_in": total_opt_in},
        "messages": {"inbound": inbound, "outbound_sent": outbound_sent, "outbound_failed": outbound_failed},
        "active_sessions": active_sessions,
        "bets_via_whatsapp": bets_via_wa,
        "campaigns": {"total": campaigns_total, "running": campaigns_running},
        "daily": daily,
    }


@router.get("/admin/whatsapp/opt-in-users")
def admin_opt_in_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Lista de quem tem opt-in ativo, com data — complementa o KPI agregado do overview."""
    users = (
        db.query(User)
        .filter(User.whatsapp_opt_in == True)  # noqa: E712
        .order_by(User.whatsapp_opt_in_at.desc().nullslast())
        .all()
    )
    return [
        {
            "id": u.id, "name": u.name, "email": u.email, "phone": u.phone,
            "opt_in_at": u.whatsapp_opt_in_at,
        }
        for u in users
    ]


@router.get("/admin/whatsapp/bets")
def admin_whatsapp_bets(
    limit: int = Query(default=50, le=200), offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db), admin: User = Depends(require_admin),
):
    """Apostas feitas via chat do WhatsApp (não confundir com 'Apostas via WA' do KPI, mesma
    fonte — AuditLog bet.place com via=whatsapp — mas aqui em lista navegável)."""
    q = db.query(AuditLog).filter(
        AuditLog.action == "bet.place", AuditLog.details.ilike('%"via": "whatsapp"%')
    ).order_by(AuditLog.id.desc())
    total = q.count()
    rows = q.offset(offset).limit(limit).all()

    parsed = []
    match_ids: set[int] = set()
    for r in rows:
        try:
            d = json.loads(r.details or "{}")
        except ValueError:
            d = {}
        parsed.append((r, d))
        if d.get("match_id"):
            match_ids.add(d["match_id"])

    matches = {m.id: m for m in db.query(Match).filter(Match.id.in_(match_ids)).all()} if match_ids else {}
    items = []
    for r, d in parsed:
        m = matches.get(d.get("match_id"))
        items.append({
            "id": r.id,
            "user_name": r.user.name if r.user else None,
            "user_email": r.user.email if r.user else None,
            "phone": r.user.phone if r.user else None,
            "match": f"{_pt(m.team_a)} x {_pt(m.team_b)}" if m else f"Jogo #{d.get('match_id')}",
            "score": d.get("score"),
            "et_winner_pick": d.get("et_winner_pick"),
            "created_at": r.created_at,
        })
    return {"items": items, "total": total}


class CampaignPayload(BaseModel):
    message: str
    only_opt_in: bool = True
    segment: str = "opt_in"  # opt_in | all | no_bets | test
    scheduled_at: str | None = None  # "YYYY-MM-DDTHH:MM" em BRT (datetime-local do admin); None = manda já


def _campaign_recipients_query(db: Session, segment: str):
    q = db.query(User).filter(User.phone.isnot(None))
    if segment == "test":
        # só admins — valida o pipeline inteiro (worker → Evolution → entrega) sem atingir usuário real
        return q.filter(User.role == UserRole.admin)
    if segment == "all":
        return q
    q = q.filter(User.whatsapp_opt_in == True)  # noqa: E712
    if segment == "no_bets":
        q = q.filter(~User.id.in_(db.query(Bet.user_id).distinct()))
    return q  # segment == "opt_in" (default)


@router.get("/admin/whatsapp/campaign/preview")
def admin_campaign_preview(segment: str = Query(default="opt_in"), db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    count = _campaign_recipients_query(db, segment).count()
    return {"segment": segment, "recipients": count}


def _create_campaign_internal(db: Session, message: str, segment: str = "opt_in",
                               scheduled_at: str | None = None, created_by: int | None = None) -> dict:
    """Cria campanha WhatsApp (mesma lógica do endpoint admin) — reusável por outros routers."""
    q = _campaign_recipients_query(db, segment)
    recipients = [(u.id, u.phone) for u in q.all() if u.phone]

    scheduled_utc = None
    if scheduled_at:
        try:
            scheduled_utc = datetime.fromisoformat(scheduled_at) + timedelta(hours=3)
        except ValueError:
            raise HTTPException(400, "scheduled_at inválido — use YYYY-MM-DDTHH:MM")
        if scheduled_utc <= _utcnow():
            scheduled_utc = None

    campaign = WhatsappCampaign(
        message=message, status="running", created_by=created_by, scheduled_at=scheduled_utc,
    )
    db.add(campaign)
    db.flush()
    for user_id, phone in recipients:
        db.add(WhatsappCampaignRecipient(campaign_id=campaign.id, phone=phone, user_id=user_id))
    db.commit()
    return {"id": campaign.id, "recipients": len(recipients), "scheduled_at": scheduled_utc.isoformat() if scheduled_utc else None}


@router.post("/admin/whatsapp/campaign", status_code=201)
def admin_create_campaign(payload: CampaignPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return _create_campaign_internal(db, message=payload.message, segment=payload.segment,
                                      scheduled_at=payload.scheduled_at, created_by=admin.id)


@router.get("/admin/whatsapp/campaign/{campaign_id}")
def admin_campaign_status(campaign_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    campaign = db.query(WhatsappCampaign).filter(WhatsappCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    total = db.query(WhatsappCampaignRecipient).filter(WhatsappCampaignRecipient.campaign_id == campaign_id).count()
    sent = db.query(WhatsappCampaignRecipient).filter(
        WhatsappCampaignRecipient.campaign_id == campaign_id, WhatsappCampaignRecipient.status == "sent"
    ).count()
    failed = db.query(WhatsappCampaignRecipient).filter(
        WhatsappCampaignRecipient.campaign_id == campaign_id, WhatsappCampaignRecipient.status == "failed"
    ).count()
    return {"id": campaign.id, "status": campaign.status, "total": total, "sent": sent, "failed": failed, "pending": total - sent - failed}


class GroupPayload(BaseModel):
    subject: str
    participants: list[str]


@router.post("/admin/whatsapp/group")
def admin_create_group(payload: GroupPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    result = wa.create_group(db, payload.subject, payload.participants)
    if result is None:
        raise HTTPException(502, "Falha ao criar grupo (instância desconectada ou WhatsApp desativado)")
    return result


@router.get("/admin/whatsapp/groups")
def admin_list_groups(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    groups = wa.list_groups(db)
    if groups is None:
        raise HTTPException(502, "Falha ao listar grupos (instância desconectada ou WhatsApp desativado)")
    return [
        {
            "id": g.get("id"),
            "subject": g.get("subject"),
            "size": g.get("size") or len(g.get("participants") or []),
            "owner": g.get("owner"),
            "creation": g.get("creation"),
        }
        for g in groups
    ]


@router.get("/admin/whatsapp/group/participants")
def admin_group_participants(group_jid: str = Query(...), db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    participants = wa.group_participants(db, group_jid)
    if participants is None:
        raise HTTPException(502, "Falha ao buscar participantes (instância desconectada ou WhatsApp desativado)")
    return [
        {"phone": (p.get("phoneNumber") or p.get("id") or "").split("@")[0], "admin": p.get("admin")}
        for p in participants
    ]


class GroupSubjectPayload(BaseModel):
    group_jid: str
    subject: str


@router.put("/admin/whatsapp/group/subject")
def admin_update_group_subject(payload: GroupSubjectPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if not wa.update_group_subject(db, payload.group_jid, payload.subject):
        raise HTTPException(502, "Falha ao renomear grupo")
    return {"ok": True}


class GroupDescriptionPayload(BaseModel):
    group_jid: str
    description: str


@router.put("/admin/whatsapp/group/description")
def admin_update_group_description(payload: GroupDescriptionPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if not wa.update_group_description(db, payload.group_jid, payload.description):
        raise HTTPException(502, "Falha ao atualizar descrição do grupo")
    return {"ok": True}


class GroupParticipantPayload(BaseModel):
    group_jid: str
    action: str  # add | remove | promote | demote
    participants: list[str]


@router.post("/admin/whatsapp/group/participant")
def admin_update_group_participant(payload: GroupParticipantPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if payload.action not in ("add", "remove", "promote", "demote"):
        raise HTTPException(400, "action inválida")
    if not wa.update_group_participants(db, payload.group_jid, payload.action, payload.participants):
        raise HTTPException(502, "Falha ao atualizar participante")
    return {"ok": True}


@router.delete("/admin/whatsapp/group/{group_jid}/leave")
def admin_leave_group(group_jid: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if not wa.leave_group(db, group_jid):
        raise HTTPException(502, "Falha ao sair do grupo")
    return {"ok": True}


@router.get("/admin/whatsapp/group/official")
def admin_get_official_group(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    row = db.query(SiteConfig).filter(SiteConfig.key == "whatsapp_group_jid").first()
    return {"group_jid": (row.value if row else "") or ""}


class OfficialGroupPayload(BaseModel):
    group_jid: str  # vazio desativa os avisos automáticos


@router.put("/admin/whatsapp/group/official")
def admin_set_official_group(payload: OfficialGroupPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    jid = payload.group_jid.strip()
    if jid and not jid.endswith("@g.us"):
        raise HTTPException(400, "JID de grupo inválido (esperado sufixo @g.us)")
    row = db.query(SiteConfig).filter(SiteConfig.key == "whatsapp_group_jid").first()
    if row:
        row.value = jid
    else:
        db.add(SiteConfig(key="whatsapp_group_jid", value=jid))
    db.commit()
    return {"ok": True, "group_jid": jid}
