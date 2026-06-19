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
        ]:
            try:
                conn.execute(text(ddl))
                conn.commit()
            except Exception:
                conn.rollback()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    task = asyncio.create_task(_auto_sync_loop())
    yield
    task.cancel()
    try:
        await task
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
    allow_origins=["*"],
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


@app.get("/api")
def root():
    return {
        "project": "Predicts.info",
        "version": "1.1.0",
        "docs": "/api/docs",
    }
