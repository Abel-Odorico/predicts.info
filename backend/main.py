import asyncio
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo

_BRT = ZoneInfo("America/Sao_Paulo")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import Base, engine
import models  # noqa: F401
from routers import health, teams, matches, auth, admin, tournament, bets, groups, sync, live
from routers import config as config_router
from routers import analytics as analytics_router
from routers import user_groups as user_groups_router
from routers import audit as audit_router
from routers import poll as poll_router
from routers import notifications as notifications_router
from routers import push as push_router
from routers import achievements as achievements_router
from routers import match_comments as match_comments_router
from routers import version as version_router
from routers import pwa_icon as pwa_icon_router
from routers import champion as champion_router
from routers import knockout as knockout_router
from routers import analysis as analysis_router
from routers import awards as awards_router
from routers import bot as bot_router
from routers.bot import public_router as bot_public_router
from routers import report as report_router
from routers import telegram as telegram_router
from routers.knockout import run_knockout_sync
from routers.sync import _run_sync, _sync_status
from routers.sync import _scheduler_status


def _purge_old_page_views(retention_days: int = 90) -> int:
    from sqlalchemy import text
    from database import engine
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=retention_days)
    with engine.connect() as conn:
        result = conn.execute(
            text("DELETE FROM page_views WHERE created_at < :cutoff"),
            {"cutoff": cutoff},
        )
        conn.commit()
        return result.rowcount


async def _auto_sync_loop():
    interval = settings.auto_sync_interval_hours * 3600
    now = datetime.now(_BRT)
    _scheduler_status["scheduler_started_at"] = now.isoformat()
    _scheduler_status["next_auto_run_at"] = (
        now + timedelta(seconds=_scheduler_status.get("startup_delay_seconds", 30))
    ).isoformat()
    print(f"[auto-sync] agendado a cada {settings.auto_sync_interval_hours}h — aguardando 30s no startup", flush=True)
    await asyncio.sleep(30)
    while True:
        if not _sync_status["running"]:
            print("[auto-sync] iniciando sincronização agendada", flush=True)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _run_sync, settings.database_url, "auto")
            print(f"[auto-sync] concluído — próxima em {settings.auto_sync_interval_hours}h", flush=True)
            deleted = await loop.run_in_executor(None, _purge_old_page_views)
            if deleted:
                print(f"[auto-sync] page_views: {deleted} registros antigos removidos (>90d)", flush=True)
        else:
            print("[auto-sync] sync já em andamento, pulando", flush=True)
        await asyncio.sleep(interval)


# Horários (BRT) em que o relatório diário é enviado ao Telegram
_DAILY_REPORT_TIMES = [(7, 0), (14, 0)]


async def _daily_report_loop():
    """Envia o relatório diário ao Telegram nos horários de _DAILY_REPORT_TIMES (BRT)."""
    from database import SessionLocal
    from routers.report import push_daily_report

    def _seconds_until_next():
        now = datetime.now(_BRT)
        candidates = []
        for hh, mm in _DAILY_REPORT_TIMES:
            target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if now >= target:
                target += timedelta(days=1)
            candidates.append((target - now).total_seconds())
        return min(candidates)

    _times_label = ", ".join(f"{hh:02d}:{mm:02d}" for hh, mm in _DAILY_REPORT_TIMES)
    print(f"[daily-report] agendado para {_times_label} BRT diariamente", flush=True)
    while True:
        wait = _seconds_until_next()
        print(f"[daily-report] próximo envio em {wait/3600:.1f}h", flush=True)
        await asyncio.sleep(wait)
        try:
            db = SessionLocal()
            try:
                res = await push_daily_report(db)
            finally:
                db.close()
            print(f"[daily-report] enviado: {res}", flush=True)
        except Exception as e:
            print(f"[daily-report] erro: {e}", flush=True)
        # evita disparo duplo se o envio for muito rápido
        await asyncio.sleep(60)


async def _oracle_predictor_loop():
    """
    Oráculo Predictor: ~1h antes de cada jogo, a IA dedicada re-analisa dados e
    cenários e confirma ou altera o palpite do bot. Dispara a análise no Telegram.
    """
    if not settings.oracle_enabled:
        print("[oraculo] desativado (oracle_enabled=false)", flush=True)
        return
    from database import SessionLocal
    from routers.bot import run_oracle_prediction

    loop_seconds = max(60, settings.oracle_loop_minutes * 60)
    print(f"[oraculo] agendado a cada {settings.oracle_loop_minutes}min — janela {settings.oracle_window_minutes}min antes do jogo", flush=True)
    await asyncio.sleep(45)
    while True:
        try:
            loop = asyncio.get_event_loop()

            def _job():
                db = SessionLocal()
                try:
                    return run_oracle_prediction(
                        db, trigger="pre_match",
                        window_minutes=settings.oracle_window_minutes,
                        telegram=True,
                    )
                finally:
                    db.close()

            res = await loop.run_in_executor(None, _job)
            if res and res.get("processed"):
                print(f"[oraculo] {res['processed']} partida(s): "
                      f"{res.get('created',0)} criados, {res.get('changed',0)} alterados, "
                      f"{res.get('kept',0)} mantidos, {res.get('telegram_sent',0)} no Telegram", flush=True)
        except Exception as e:
            print(f"[oraculo] erro: {e}", flush=True)
        await asyncio.sleep(loop_seconds)


def _run_migrations():
    from sqlalchemy import text
    with engine.connect() as conn:
        for ddl in [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(60) UNIQUE",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
            "UPDATE users SET updated_at = created_at WHERE updated_at IS NULL",
            # Índice parcial unique em phone (NULL permitido, valores não-null devem ser únicos)
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone ON users (phone) WHERE phone IS NOT NULL",
            # Tabela de tokens de reset de senha
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token VARCHAR(64) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                used_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_prt_token ON password_reset_tokens (token)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'system'",
            "UPDATE users SET theme = 'system' WHERE theme IS NULL",
            # Consulta pública / votação
            """
            CREATE TABLE IF NOT EXISTS polls (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                status VARCHAR(20) DEFAULT 'active',
                opens_at TIMESTAMP NOT NULL,
                closes_at TIMESTAMP NOT NULL,
                closed_at TIMESTAMP,
                report JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS poll_options (
                id SERIAL PRIMARY KEY,
                poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
                label VARCHAR(300) NOT NULL,
                order_num INTEGER DEFAULT 0
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS poll_votes (
                id SERIAL PRIMARY KEY,
                poll_id INTEGER REFERENCES polls(id),
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                option_id INTEGER REFERENCES poll_options(id),
                suggestion VARCHAR(500),
                ip VARCHAR(45),
                user_agent VARCHAR(500),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_poll_user_vote UNIQUE (poll_id, user_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS poll_vote_history (
                id SERIAL PRIMARY KEY,
                vote_id INTEGER REFERENCES poll_votes(id) ON DELETE CASCADE,
                poll_id INTEGER REFERENCES polls(id),
                user_id INTEGER REFERENCES users(id),
                option_id INTEGER REFERENCES poll_options(id),
                changed_at TIMESTAMP DEFAULT NOW()
            )
            """,
            # Seed da consulta inicial (prazo: domingo 22/06/2026 23:59:59 BRT = UTC-3)
            """
            INSERT INTO polls (title, description, status, opens_at, closes_at)
            SELECT
                'Consulta Pública — Sistema de Pontuação do Bolão',
                'Ajude a definir como será a pontuação dos próximos campeonatos. Esta é uma consulta oficial e transparente para todos os participantes.',
                'active',
                '2026-06-20 00:00:00',
                '2026-06-23 02:59:59'
            WHERE NOT EXISTS (SELECT 1 FROM polls LIMIT 1)
            """,
            """
            INSERT INTO poll_options (poll_id, label, order_num)
            SELECT p.id, 'Sim, prefiro o novo sistema (Pontuação por Precisão)', 1
            FROM polls p
            WHERE p.id = (SELECT MIN(id) FROM polls)
              AND NOT EXISTS (SELECT 1 FROM poll_options WHERE poll_id = p.id AND order_num = 1)
            """,
            """
            INSERT INTO poll_options (poll_id, label, order_num)
            SELECT p.id, 'Não, prefiro manter o sistema atual', 2
            FROM polls p
            WHERE p.id = (SELECT MIN(id) FROM polls)
              AND NOT EXISTS (SELECT 1 FROM poll_options WHERE poll_id = p.id AND order_num = 2)
            """,
            """
            INSERT INTO poll_options (poll_id, label, order_num)
            SELECT p.id, 'Gostaria de testar em um próximo campeonato', 3
            FROM polls p
            WHERE p.id = (SELECT MIN(id) FROM polls)
              AND NOT EXISTS (SELECT 1 FROM poll_options WHERE poll_id = p.id AND order_num = 3)
            """,
            """
            INSERT INTO poll_options (poll_id, label, order_num)
            SELECT p.id, 'Prefiro o Sistema Inteligente por Proximidade', 4
            FROM polls p
            WHERE p.id = (SELECT MIN(id) FROM polls)
              AND NOT EXISTS (SELECT 1 FROM poll_options WHERE poll_id = p.id AND order_num = 4)
            """,
            """
            INSERT INTO poll_options (poll_id, label, order_num)
            SELECT p.id, 'Não tenho opinião', 5
            FROM polls p
            WHERE p.id = (SELECT MIN(id) FROM polls)
              AND NOT EXISTS (SELECT 1 FROM poll_options WHERE poll_id = p.id AND order_num = 5)
            """,
            # Push subscriptions
            """
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_push_endpoint UNIQUE (endpoint)
            )
            """,
            # Persistent achievements
            """
            CREATE TABLE IF NOT EXISTS user_achievements (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                code VARCHAR(50) NOT NULL,
                unlocked_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_user_achievement UNIQUE (user_id, code)
            )
            """,
            # Match comments
            """
            CREATE TABLE IF NOT EXISTS match_comments (
                id SERIAL PRIMARY KEY,
                match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                content VARCHAR(280) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_match_comments_match ON match_comments (match_id)",
            """
            CREATE TABLE IF NOT EXISTS app_versions (
                id SERIAL PRIMARY KEY,
                version VARCHAR(20) NOT NULL,
                title VARCHAR(200) NOT NULL,
                description VARCHAR(1000),
                changes JSONB,
                notified_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS champion_picks (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                team_id INTEGER NOT NULL REFERENCES teams(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS champion_awards (
                id SERIAL PRIMARY KEY,
                champion_team_id INTEGER REFERENCES teams(id),
                runner_up_team_id INTEGER REFERENCES teams(id),
                awarded_by INTEGER REFERENCES users(id),
                champion_users INTEGER DEFAULT 0,
                runner_up_users INTEGER DEFAULT 0,
                awarded_at TIMESTAMP DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS match_analyses (
                id           SERIAL PRIMARY KEY,
                match_id     INTEGER NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
                content      JSONB   NOT NULL,
                model_used   VARCHAR(120),
                generated_at TIMESTAMP DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS analysis_logs (
                id           SERIAL PRIMARY KEY,
                match_id     INTEGER REFERENCES matches(id) ON DELETE SET NULL,
                model_used   VARCHAR(200),
                provider     VARCHAR(50),
                tokens_in    INTEGER DEFAULT 0,
                tokens_out   INTEGER DEFAULT 0,
                cost_usd     NUMERIC(10,6) DEFAULT 0,
                duration_ms  INTEGER DEFAULT 0,
                status       VARCHAR(20) DEFAULT 'ok',
                error_msg    TEXT,
                batch_id     VARCHAR(64),
                trigger      VARCHAR(20) DEFAULT 'manual',
                created_at   TIMESTAMP DEFAULT NOW()
            )
            """,
        ]:
            try:
                conn.execute(text(ddl))
                conn.commit()
            except Exception:
                conn.rollback()
        # Column additions on existing tables
        for alter in [
            "ALTER TABLE analysis_logs ADD COLUMN IF NOT EXISTS trigger VARCHAR(20) DEFAULT 'manual'",
            "ALTER TABLE page_views ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
            "CREATE INDEX IF NOT EXISTS ix_page_views_user_id ON page_views (user_id) WHERE user_id IS NOT NULL",
            # Renomeia o bot p/ Oráculo Predictor
            "UPDATE users SET name = '🔮 Oráculo Predictor' WHERE email = 'bot@predicts.info'",
            # Slack: canal de notificação do Oráculo
            "ALTER TABLE bot_decision_logs ADD COLUMN IF NOT EXISTS slack_sent BOOLEAN DEFAULT FALSE",
            # source pode guardar tag de modelo longa (ex: llm/openrouter/anthropic/claude-sonnet-4-5)
            "ALTER TABLE bot_decision_logs ALTER COLUMN source TYPE VARCHAR(80)",
        ]:
            try:
                conn.execute(text(alter))
                conn.commit()
            except Exception:
                conn.rollback()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    task = asyncio.create_task(_auto_sync_loop())
    report_task = asyncio.create_task(_daily_report_loop())
    oracle_task = asyncio.create_task(_oracle_predictor_loop())
    yield
    for t in (task, report_task, oracle_task):
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Predicts.info — World Cup 2026 Simulator",
    description="Poisson + Elo + Monte Carlo (1M simulações) + xG + Apostas",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://predicts.info",
        "https://www.predicts.info",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router,      prefix="/api")
app.include_router(teams.router,       prefix="/api")
app.include_router(matches.router,     prefix="/api")
app.include_router(auth.router,        prefix="/api")
app.include_router(admin.router,       prefix="/api")
app.include_router(tournament.router,  prefix="/api")
app.include_router(bets.router,        prefix="/api")
app.include_router(groups.router,      prefix="/api")
app.include_router(sync.router,        prefix="/api")
app.include_router(live.router,        prefix="/api")
app.include_router(config_router.router,    prefix="/api")
app.include_router(analytics_router.router, prefix="/api")
app.include_router(user_groups_router.router, prefix="/api")
app.include_router(audit_router.router,       prefix="/api")
app.include_router(poll_router.router,        prefix="/api")
app.include_router(notifications_router.router, prefix="/api")
app.include_router(push_router.router,          prefix="/api")
app.include_router(achievements_router.router,  prefix="/api")
app.include_router(match_comments_router.router, prefix="/api")
app.include_router(version_router.router,        prefix="/api")
app.include_router(pwa_icon_router.router,       prefix="/api")
app.include_router(champion_router.router,       prefix="/api")
app.include_router(knockout_router.router,      prefix="/api")
app.include_router(analysis_router.router,      prefix="/api")
app.include_router(awards_router.router,        prefix="/api")
app.include_router(bot_router.router,           prefix="/api")
app.include_router(bot_public_router,           prefix="/api")
app.include_router(report_router.router,        prefix="/api")
app.include_router(telegram_router.router,      prefix="/api")


@app.get("/api")
def root():
    return {
        "project": "Predicts.info",
        "version": "1.1.0",
        "docs": "/api/docs",
    }
