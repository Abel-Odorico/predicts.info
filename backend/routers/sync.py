"""
POST /admin/sync-elo  — sincroniza Copa 2026 real:
- grupos e jogos atuais
- convocados
- Elo + forma recente
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

_BRT = ZoneInfo("America/Sao_Paulo")


def _now() -> datetime:
    return datetime.now(_BRT)

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from auth_utils import require_admin
from config import settings
from database import get_db
from models import User
from world_cup_sync import (
    apply_world_cup_snapshot,
    fetch_world_cup_snapshot,
    invalidate_simulation_cache,
    sync_team_stats,
)

router = APIRouter(prefix="/admin", tags=["admin"])

_sync_status = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "updated": 0,
    "errors": [],
    "log": [],
    "auto_sync": True,
    "trigger": None,  # "manual" | "auto"
}

# Histórico dos últimos 10 runs (completed only)
_sync_history: list[dict] = []
_scheduler_status = {
    "server_started_at": _now().isoformat(),
    "scheduler_started_at": None,
    "startup_delay_seconds": 30,
    "last_auto_started_at": None,
    "last_auto_finished_at": None,
    "last_auto_ok": None,
    "next_auto_run_at": None,
}


def _append_log(message: str) -> None:
    _sync_status["log"] = [*_sync_status["log"], message][-200:]


def _auto_generate_analyses(db_url: str) -> None:
    """Gera análises IA para partidas pendentes após cada sync. Roda em thread daemon."""
    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from routers.analysis import _get_config, _generate_all_bg

        engine = create_engine(db_url)
        Sess = sessionmaker(bind=engine)
        db = Sess()
        try:
            cfg = _get_config(db)
        finally:
            db.close()
            engine.dispose()

        if not (cfg.get("gemini_key") or cfg.get("openrouter_key")):
            print("[analysis-auto] nenhum provider configurado — pulando", flush=True)
            return

        _generate_all_bg(db_url, cfg, only_pending=True)
    except Exception as exc:
        print(f"[analysis-auto] erro: {exc}", flush=True)


def _run_sync(db_url: str, trigger: str = "manual"):
    global _sync_status, _sync_history, _scheduler_status
    if trigger == "auto":
        _scheduler_status["last_auto_started_at"] = _now().isoformat()
        _scheduler_status["next_auto_run_at"] = None
    _sync_status.update(
        {
            "running": True,
            "started_at": _now().isoformat(),
            "finished_at": None,
            "updated": 0,
            "errors": [],
            "log": [],
            "trigger": trigger,
        }
    )

    errors: list[str] = []
    try:
        _append_log("● Baixando grupos, jogos e convocados atuais...")
        snapshot = fetch_world_cup_snapshot(log=_append_log)
        summary = apply_world_cup_snapshot(db_url, snapshot, log=_append_log)
        _append_log(
            "✓ Base da Copa atualizada "
            f"({summary['teams']} seleções, {summary['matches']} jogos, {summary['players']} jogadores)"
        )

        _append_log("● Atualizando Elo, gols médios e forma recente...")
        stats = sync_team_stats(db_url, log=_append_log)
        _sync_status["updated"] = stats["updated"]
        errors.extend(stats["errors"])

        _append_log("● Limpando cache de simulação...")
        invalidate_simulation_cache(log=_append_log)

        from routers.knockout import run_knockout_sync
        run_knockout_sync(db_url, log=_append_log)

        import threading
        threading.Thread(
            target=_auto_generate_analyses,
            args=(db_url,),
            daemon=True,
        ).start()
        _append_log("● Análises IA: geração de pendentes iniciada em background")
    except Exception as exc:
        errors.append("sync_failed")
        _append_log(f"✗ Falha geral: {exc}")
    finally:
        finished_at = _now().isoformat()
        if trigger == "auto":
            _scheduler_status["last_auto_finished_at"] = finished_at
            _scheduler_status["last_auto_ok"] = len(errors) == 0
            _scheduler_status["next_auto_run_at"] = (
                _now() + timedelta(hours=settings.auto_sync_interval_hours)
            ).isoformat()
        _sync_status.update(
            {
                "running": False,
                "finished_at": finished_at,
                "updated": _sync_status.get("updated", 0),
                "errors": errors,
                "log": _sync_status["log"],
            }
        )
        # Append to history
        _sync_history = [
            *_sync_history,
            {
                "started_at": _sync_status["started_at"],
                "finished_at": finished_at,
                "updated": _sync_status["updated"],
                "errors": errors,
                "trigger": trigger,
                "ok": len(errors) == 0,
                "summary": _sync_status["log"][-1] if _sync_status["log"] else "",
            },
        ][-10:]  # keep last 10


@router.post("/sync-elo")
def sync_elo(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if _sync_status["running"]:
        return {"status": "already_running", "message": "Sync já em andamento"}
    background_tasks.add_task(_run_sync, settings.database_url, "manual")
    return {"status": "started", "teams": 48}


@router.get("/sync-status")
def sync_status(_: User = Depends(require_admin)):
    return {
        **_sync_status,
        "auto_sync_interval_hours": settings.auto_sync_interval_hours,
        "history": list(reversed(_sync_history)),
        "scheduler": _scheduler_status,
    }
