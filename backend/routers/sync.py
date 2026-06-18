"""
POST /admin/sync-elo  — sincroniza Copa 2026 real:
- grupos e jogos atuais
- convocados
- Elo + forma recente
"""
from datetime import datetime

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


def _append_log(message: str) -> None:
    _sync_status["log"] = [*_sync_status["log"], message][-200:]


def _run_sync(db_url: str, trigger: str = "manual"):
    global _sync_status, _sync_history
    _sync_status.update(
        {
            "running": True,
            "started_at": datetime.utcnow().isoformat(),
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
    except Exception as exc:
        errors.append("sync_failed")
        _append_log(f"✗ Falha geral: {exc}")
    finally:
        finished_at = datetime.utcnow().isoformat()
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
    }
