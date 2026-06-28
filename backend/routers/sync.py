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

        _generate_all_bg(db_url, cfg, only_pending=True, only_future=False, trigger="auto")
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

        from world_cup_official import sync_knockout_matches
        sync_knockout_matches(db_url, log=_append_log)

        import threading
        threading.Thread(
            target=_auto_generate_analyses,
            args=(db_url,),
            daemon=True,
        ).start()
        _append_log("● Análises IA: geração de pendentes iniciada em background")

        # Bot: gera palpites para partidas abertas ainda sem aposta
        try:
            from routers.bot import _get_bot, _predict_score, BOT_EMAIL
            from models import Bet, Match, MatchStatus, SimulationCache
            from database import SessionLocal
            from datetime import datetime, timezone

            db_bot = SessionLocal()
            bot = _get_bot(db_bot)
            if bot:
                now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
                open_matches = db_bot.query(Match).filter(Match.status == MatchStatus.scheduled).all()
                existing_ids = {b.match_id for b in db_bot.query(Bet.match_id).filter(Bet.user_id == bot.id).all()}
                created = 0
                for m in open_matches:
                    if m.id in existing_ids:
                        continue
                    deadline = m.bet_deadline or m.match_date
                    if deadline and now_utc >= deadline:
                        continue
                    sim = db_bot.query(SimulationCache).filter(SimulationCache.match_id == m.id).first()
                    sa, sb = _predict_score(sim, m)
                    db_bot.add(Bet(user_id=bot.id, match_id=m.id, score_a=sa, score_b=sb, locked_at=m.match_date))
                    created += 1
                if created:
                    db_bot.commit()
                    _append_log(f"● Bot Predictor IA: {created} novo(s) palpite(s) gerado(s)")
                db_bot.close()
        except Exception as exc_bot:
            _append_log(f"⚠ Bot sync: {exc_bot}")
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


@router.get("/sync-report")
def sync_report(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    from sqlalchemy import text
    from pathlib import Path
    import re as _re

    # Phase counters
    rows = db.execute(text("""
        SELECT
            phase::text,
            count(*) AS total,
            count(mr.id) AS with_result,
            sum(CASE WHEN m.status = 'finished' THEN 1 ELSE 0 END) AS finished
        FROM matches m
        LEFT JOIN match_results mr ON mr.match_id = m.id
        GROUP BY phase
        ORDER BY phase
    """)).fetchall()
    phase_stats = [
        {"phase": r[0], "total": int(r[1]), "with_result": int(r[2]), "finished": int(r[3])}
        for r in rows
    ]

    # R32 match detail
    r32_rows = db.execute(text("""
        SELECT
            m.id, m.match_number, m.match_date, m.status::text, m.venue, m.city,
            ta.code AS code_a, ta.name AS name_a, ta.flag_url AS flag_a,
            tb.code AS code_b, tb.name AS name_b, tb.flag_url AS flag_b,
            mr.score_a, mr.score_b
        FROM matches m
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        LEFT JOIN match_results mr ON mr.match_id = m.id
        WHERE m.phase = 'r32'::matchphase
        ORDER BY m.match_number
    """)).fetchall()
    r32_matches = []
    for r in r32_rows:
        r32_matches.append({
            "id": r[0], "match_number": r[1],
            "match_date": r[2].isoformat() if r[2] else None,
            "status": r[3], "venue": r[4], "city": r[5],
            "team_a": {"code": r[6], "name": r[7], "flag_url": r[8]},
            "team_b": {"code": r[9], "name": r[10], "flag_url": r[11]},
            "score": {"a": r[12], "b": r[13]} if r[12] is not None else None,
        })

    # Bets on r32 matches
    bet_counts = db.execute(text("""
        SELECT m.match_number, count(b.id) AS bets
        FROM matches m
        LEFT JOIN bets b ON b.match_id = m.id
        WHERE m.phase = 'r32'::matchphase
        GROUP BY m.match_number
    """)).fetchall()
    bets_by_match = {r[0]: int(r[1]) for r in bet_counts}
    for m in r32_matches:
        m["bets"] = bets_by_match.get(m["match_number"], 0)

    # Cron log tail
    cron_log: list[str] = []
    log_path = Path("/var/log/predicts-cron.log")
    if log_path.exists():
        lines = log_path.read_text(errors="replace").splitlines()
        cron_log = lines[-60:]

    # Last cron run time from log
    last_run_at = None
    for line in reversed(cron_log):
        ts_match = _re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
        if ts_match:
            last_run_at = ts_match.group(1)
            break

    return {
        "generated_at": _now().isoformat(),
        "phase_stats": phase_stats,
        "r32_matches": r32_matches,
        "cron_log": cron_log,
        "last_cron_run_at": last_run_at,
    }
