"""
Seed do Bot Squad — 20 usuários-persona apostadores automáticos + liga "Boteco do Placar".

Idempotente por e-mail (`<username>@squad.predicts.local`): rodar de novo não duplica
usuários, personas, o grupo, nem os memberships. `site_config.bot_squad_enabled` é
setado só se ainda não existir.

Uso: docker exec predicts_api python3 /app/seed_bot_squad.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import secrets

from database import SessionLocal
from models import User, BotPersona, UserGroup, UserGroupMember, SiteConfig
from auth_utils import hash_password

ADMIN_EMAIL = "grupopeepconnect@gmail.com"
LEAGUE_NAME = "Boteco do Placar"

# 20 personas — nomes brasileiros reais e variados, usernames com cara de gente
# (apelido/time/número, não padrão robótico). favorite_team_code mistura clubes
# BR reais (ver skill predicts / SELECT code,name FROM teams) e seleções.
PERSONAS = [
    dict(
        name="Eduardo Ferreira", username="dudu_flamengo", archetype="torcedor-fanatico",
        favorite_team_code="FLA",
        bio="Rubro-Negro roxo, aposto sempre no meu coração mesmo sabendo que às vezes dói.",
        params=dict(risk=0.6, draw_affinity=0.2, goals_bias=0.3, fav_boost=0.8, stubbornness=0.8, jitter_hours=12),
    ),
    dict(
        name="Carla Mendes Previdelli", username="carla.prev", archetype="estatistica",
        favorite_team_code=None,
        bio="Gosto de olhar número antes de sentimento. Se o modelo diz zebra, eu confio.",
        params=dict(risk=0.3, draw_affinity=0.5, goals_bias=0.0, fav_boost=0.1, stubbornness=0.3, jitter_hours=48),
    ),
    dict(
        name="Marcos Vinícius Silva", username="zebrinha10", archetype="zebra",
        favorite_team_code=None,
        bio="Zebra é vida. Favoritismo na cara é armadilha pra quem não presta atenção.",
        params=dict(risk=0.9, draw_affinity=0.3, goals_bias=0.1, fav_boost=0.1, stubbornness=0.5, jitter_hours=24),
    ),
    dict(
        name="Beatriz Nogueira Costa", username="bia.noga", archetype="cauteloso",
        favorite_team_code="PAL",
        bio="Prefiro cravar o resultado certo do que arriscar um placar mirabolante.",
        params=dict(risk=0.15, draw_affinity=0.4, goals_bias=-0.2, fav_boost=0.4, stubbornness=0.7, jitter_hours=36),
    ),
    dict(
        name="João Pedro Almeida", username="jpalmeida", archetype="goleada",
        favorite_team_code=None,
        bio="Futebol sem gol é chá de cadeira. Aposto sempre pensando em goleada.",
        params=dict(risk=0.7, draw_affinity=0.1, goals_bias=0.9, fav_boost=0.3, stubbornness=0.4, jitter_hours=18),
    ),
    dict(
        name="Fernanda Rocha Lima", username="fefa_rocha", archetype="empatista",
        favorite_team_code=None,
        bio="Empate é resultado nobre, subestimado. Sempre dou uma chance a ele.",
        params=dict(risk=0.3, draw_affinity=0.9, goals_bias=-0.1, fav_boost=0.2, stubbornness=0.6, jitter_hours=30),
    ),
    dict(
        name="Ricardo Barbosa", username="kadu.barbosa", archetype="home-crente",
        favorite_team_code="CRU",
        bio="Time da casa tem que respeitar o mando. É assim que eu vejo o jogo.",
        params=dict(risk=0.4, draw_affinity=0.3, goals_bias=0.2, fav_boost=0.5, stubbornness=0.5, jitter_hours=20),
    ),
    dict(
        name="Patrícia Souza Martins", username="paty_souza", archetype="contrarian",
        favorite_team_code=None,
        bio="Quando todo mundo aposta no óbvio, eu procuro o furo.",
        params=dict(risk=0.8, draw_affinity=0.2, goals_bias=0.0, fav_boost=0.05, stubbornness=0.6, jitter_hours=60),
    ),
    dict(
        name="Gustavo Henrique Farias", username="guga_tricolor", archetype="torcedor-fanatico",
        favorite_team_code="SAO",
        bio="São-paulino roxo desde criança, o coração aposta antes da cabeça.",
        params=dict(risk=0.5, draw_affinity=0.2, goals_bias=0.2, fav_boost=0.85, stubbornness=0.85, jitter_hours=14),
    ),
    dict(
        name="Larissa Almeida Cunha", username="laris.cunha", archetype="cauteloso",
        favorite_team_code=None,
        bio="Prefiro perder pouco a arriscar demais. Ando sempre no meio do caminho.",
        params=dict(risk=0.1, draw_affinity=0.5, goals_bias=-0.1, fav_boost=0.2, stubbornness=0.7, jitter_hours=40),
    ),
    dict(
        name="Thiago Nascimento Reis", username="thi_nascimento", archetype="estatistica",
        favorite_team_code=None,
        bio="Elo, xG, forma recente — decido pela planilha, não pelo coração.",
        params=dict(risk=0.25, draw_affinity=0.4, goals_bias=0.0, fav_boost=0.1, stubbornness=0.3, jitter_hours=50),
    ),
    dict(
        name="Camila Rodrigues Teixeira", username="mila_gremista", archetype="torcedor-fanatico",
        favorite_team_code="GRE",
        bio="Gremista roxa, aposto sempre pensando no tricolor gaúcho.",
        params=dict(risk=0.55, draw_affinity=0.25, goals_bias=0.25, fav_boost=0.8, stubbornness=0.75, jitter_hours=16),
    ),
    dict(
        name="Bruno Cesar Andrade", username="bruno.andrade", archetype="zebra",
        favorite_team_code=None,
        bio="Se o favorito é óbvio demais, eu já desconfio.",
        params=dict(risk=0.85, draw_affinity=0.2, goals_bias=0.1, fav_boost=0.15, stubbornness=0.5, jitter_hours=22),
    ),
    dict(
        name="Juliana Pereira Duarte", username="ju_duarte87", archetype="goleada",
        favorite_team_code="BRA",
        bio="Torço pro jogo ter gol pra todo lado, aposto sempre pensando em ataque.",
        params=dict(risk=0.6, draw_affinity=0.1, goals_bias=0.8, fav_boost=0.4, stubbornness=0.4, jitter_hours=26),
    ),
    dict(
        name="Diego Martins Oliveira", username="diego.oliveira", archetype="home-crente",
        favorite_team_code="INT",
        bio="Fator casa pesa muito no meu palpite, sempre respeito o mando de campo.",
        params=dict(risk=0.35, draw_affinity=0.3, goals_bias=0.1, fav_boost=0.45, stubbornness=0.55, jitter_hours=20),
    ),
    dict(
        name="Amanda Ferreira Lopes", username="amanda_lopes22", archetype="empatista",
        favorite_team_code=None,
        bio="Adoro um 1x1, acho que o futebol é mais justo assim.",
        params=dict(risk=0.25, draw_affinity=0.85, goals_bias=-0.15, fav_boost=0.15, stubbornness=0.65, jitter_hours=32),
    ),
    dict(
        name="Rodrigo Alves Barreto", username="rodrigo.barreto", archetype="contrarian",
        favorite_team_code=None,
        bio="Gosto de ir contra a maré, às vezes acerto, às vezes pago o preço.",
        params=dict(risk=0.75, draw_affinity=0.15, goals_bias=0.05, fav_boost=0.1, stubbornness=0.55, jitter_hours=55),
    ),
    dict(
        name="Vanessa Cristina Moura", username="vah_botafogo", archetype="torcedor-fanatico",
        favorite_team_code="BOT",
        bio="Alvinegra roxa, chorei o título e aposto sempre com o coração.",
        params=dict(risk=0.5, draw_affinity=0.2, goals_bias=0.15, fav_boost=0.8, stubbornness=0.8, jitter_hours=10),
    ),
    dict(
        name="Felipe Augusto Santana", username="felipe.santana", archetype="estatistica",
        favorite_team_code="ARG",
        bio="Curto números, mas confesso um viés pela Argentina desde 2022.",
        params=dict(risk=0.3, draw_affinity=0.35, goals_bias=0.05, fav_boost=0.35, stubbornness=0.4, jitter_hours=45),
    ),
    dict(
        name="Renata Cordeiro Vieira", username="re_cordeiro", archetype="cauteloso",
        favorite_team_code="BAH",
        bio="Torço discreto pelo Bahia, mas no palpite prefiro jogar seguro.",
        params=dict(risk=0.2, draw_affinity=0.45, goals_bias=-0.1, fav_boost=0.3, stubbornness=0.6, jitter_hours=38),
    ),
]


def _email_for(username: str) -> str:
    return f"{username}@squad.predicts.local"


def run():
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == ADMIN_EMAIL).first()
        if not admin:
            print(f"[seed_bot_squad] ERRO: admin '{ADMIN_EMAIL}' não encontrado. Abortando.")
            return

        created_users = 0
        created_personas = 0
        bot_user_ids = []

        for p in PERSONAS:
            email = _email_for(p["username"])
            user = db.query(User).filter(User.email == email).first()
            if not user:
                user = User(
                    email=email,
                    username=p["username"],
                    phone=None,
                    name=p["name"],
                    password_hash=hash_password(secrets.token_urlsafe(24)),
                    is_active=True,
                    whatsapp_opt_in=False,
                    is_bot=True,
                )
                db.add(user)
                db.flush()  # garante user.id sem precisar commitar já
                created_users += 1
            else:
                # idempotência: garante flags corretas mesmo se já existia
                if not user.is_bot:
                    user.is_bot = True

            bot_user_ids.append(user.id)

            persona = db.query(BotPersona).filter(BotPersona.user_id == user.id).first()
            if not persona:
                db.add(BotPersona(
                    user_id=user.id,
                    archetype=p["archetype"],
                    bio=p["bio"],
                    favorite_team_code=p["favorite_team_code"],
                    params=p["params"],
                    enabled=True,
                ))
                created_personas += 1

        db.commit()

        # Liga "Boteco do Placar" — owner = admin, idempotente por nome+owner
        group = (
            db.query(UserGroup)
            .filter(UserGroup.name == LEAGUE_NAME, UserGroup.owner_user_id == admin.id)
            .first()
        )
        created_group = False
        if not group:
            group = UserGroup(name=LEAGUE_NAME, owner_user_id=admin.id, invite_token=None)
            db.add(group)
            db.commit()
            db.refresh(group)
            created_group = True

        created_members = 0

        def _ensure_member(user_id: int, is_owner: bool):
            nonlocal created_members
            m = (
                db.query(UserGroupMember)
                .filter(UserGroupMember.group_id == group.id, UserGroupMember.user_id == user_id)
                .first()
            )
            if not m:
                db.add(UserGroupMember(group_id=group.id, user_id=user_id, is_owner=is_owner))
                created_members += 1

        _ensure_member(admin.id, True)
        for uid in bot_user_ids:
            _ensure_member(uid, False)

        db.commit()

        # site_config.bot_squad_enabled = "true" só se ainda não existir
        cfg = db.query(SiteConfig).filter(SiteConfig.key == "bot_squad_enabled").first()
        created_cfg = False
        if not cfg:
            db.add(SiteConfig(key="bot_squad_enabled", value="true"))
            db.commit()
            created_cfg = True

        total_users = db.query(User).filter(User.is_bot.is_(True)).count()
        total_personas = db.query(BotPersona).count()
        total_members = db.query(UserGroupMember).filter(UserGroupMember.group_id == group.id).count()

        print(f"[seed_bot_squad] users bot: {created_users} criados agora, {total_users} total")
        print(f"[seed_bot_squad] bot_personas: {created_personas} criadas agora, {total_personas} total")
        print(f"[seed_bot_squad] liga '{LEAGUE_NAME}' id={group.id} (nova={created_group}), "
              f"membros: {created_members} criados agora, {total_members} total")
        print(f"[seed_bot_squad] site_config.bot_squad_enabled: criado agora={created_cfg}")

    finally:
        db.close()


if __name__ == "__main__":
    run()
