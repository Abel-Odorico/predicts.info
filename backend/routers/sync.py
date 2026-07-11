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
                from competitions import get_competition_id
                open_matches = db_bot.query(Match).filter(
                    Match.status == MatchStatus.scheduled,
                    Match.competition_id == get_competition_id(db_bot),
                ).all()
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

    import threading
    threading.Thread(target=_capture_ranking_snapshots, args=(db_url,), daemon=True).start()


def _capture_ranking_snapshots(db_url: str) -> None:
    """Salva snapshot diário da posição de cada usuário no ranking."""
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import sessionmaker
        engine = create_engine(db_url)
        Sess = sessionmaker(bind=engine)
        db = Sess()
        try:
            today = _now().date()
            if db.execute(text("SELECT 1 FROM ranking_snapshots WHERE snapshot_at::date = :d LIMIT 1"), {"d": today}).fetchone():
                return
            ranked = db.execute(text("""
                SELECT u.id, COALESCE(r.total_points, 0), COALESCE(r.exact_scores, 0)
                FROM users u
                LEFT JOIN rankings r ON r.user_id = u.id
                WHERE EXISTS (SELECT 1 FROM bets WHERE user_id = u.id)
                  AND u.email != 'bot@predicts.info'
                ORDER BY COALESCE(r.total_points, 0) DESC,
                         COALESCE(r.exact_scores, 0) DESC,
                         u.name ASC
            """)).fetchall()
            total = len(ranked)
            for pos, row in enumerate(ranked, 1):
                db.execute(text("""
                    INSERT INTO ranking_snapshots (user_id, position, total_users, points)
                    VALUES (:uid, :pos, :total, :pts)
                """), {"uid": row[0], "pos": pos, "total": total, "pts": row[1]})
            db.commit()
            print(f"[ranking-snapshot] {total} snapshots para {today}", flush=True)
        finally:
            db.close()
            engine.dispose()
    except Exception as exc:
        print(f"[ranking-snapshot] erro: {exc}", flush=True)


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
    import os
    from zoneinfo import ZoneInfo

    BRT = ZoneInfo("America/Sao_Paulo")
    now_brt = datetime.now(BRT)
    today_brt = now_brt.date()

    # ── Cron health ──────────────────────────────────────────────────────────
    log_path = Path("/var/log/predicts-cron.log")
    cron_log: list[str] = []
    cron_health: dict = {"available": False}

    if log_path.exists():
        raw = log_path.read_text(errors="replace")
        all_lines = raw.splitlines()
        cron_log = all_lines[-80:]

        # mtime = last time the file was written (= last cron run)
        mtime = os.path.getmtime(str(log_path))
        minutes_ago = (now_brt.timestamp() - mtime) / 60

        # Extract last timestamp line (=== 2026-06-28T09:35:00-0300 ===)
        last_run_ts: str | None = None
        for line in reversed(all_lines):
            m = _re.match(r"=== (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
            if m:
                last_run_ts = m.group(1)
                break

        # Errors in the last run block (lines after last === marker)
        last_block: list[str] = []
        found_marker = False
        for line in reversed(all_lines):
            if _re.match(r"=== \d{4}", line):
                found_marker = True
                break
            last_block.insert(0, line)
        last_run_errors = [l for l in last_block if l.startswith("✗") or "Permission denied" in l or "Error" in l.lower() or "Traceback" in l]

        # Permission denied ever in first 10 lines
        perm_error = any("Permission denied" in l for l in all_lines[:10])

        on_schedule = minutes_ago < 10  # expect every 5 min; warn if > 10 min gap
        cron_health = {
            "available": True,
            "last_modified_minutes_ago": round(minutes_ago, 1),
            "on_schedule": on_schedule,
            "last_run_ts": last_run_ts,
            "has_timestamp": last_run_ts is not None,
            "last_run_errors": last_run_errors,
            "permission_error_ever": perm_error,
        }

    # ── Partidas de hoje (BRT) ────────────────────────────────────────────
    today_rows = db.execute(text("""
        SELECT
            m.id, m.match_number, m.match_date, m.phase::text, m.status::text,
            m.venue, m.city,
            ta.code AS code_a, ta.name AS name_a, ta.flag_url AS flag_a,
            tb.code AS code_b, tb.name AS name_b, tb.flag_url AS flag_b,
            mr.score_a, mr.score_b
        FROM matches m
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        LEFT JOIN match_results mr ON mr.match_id = m.id
        WHERE m.phase != 'group'::matchphase
          AND (m.match_date AT TIME ZONE 'America/Sao_Paulo')::date = :today
        ORDER BY m.match_date
    """), {"today": today_brt}).fetchall()
    def _dt(val):
        if val is None:
            return None
        return val.isoformat() + "+00:00" if val.tzinfo is None else val.isoformat()

    today_matches = [
        {
            "id": r[0], "match_number": r[1],
            "match_date": _dt(r[2]),
            "phase": r[3], "status": r[4],
            "venue": r[5], "city": r[6],
            "team_a": {"code": r[7], "name": r[8], "flag_url": r[9]},
            "team_b": {"code": r[10], "name": r[11], "flag_url": r[12]},
            "score": {"a": r[13], "b": r[14]} if r[13] is not None else None,
        }
        for r in today_rows
    ]

    # ── Anomalias ─────────────────────────────────────────────────────────
    anomalies: list[dict] = []

    # finished sem resultado
    n = db.execute(text("""
        SELECT count(*) FROM matches
        WHERE status = 'finished' AND id NOT IN (SELECT match_id FROM match_results)
    """)).scalar() or 0
    if n > 0:
        anomalies.append({"level": "error", "msg": f"{n} partida(s) com status 'finished' sem resultado no banco"})

    # resultado sem finished
    n = db.execute(text("""
        SELECT count(*) FROM match_results mr
        JOIN matches m ON m.id = mr.match_id
        WHERE m.status != 'finished'
    """)).scalar() or 0
    if n > 0:
        anomalies.append({"level": "warning", "msg": f"{n} resultado(s) registrado(s) mas partida não está como 'finished'"})

    # apostas em finalizadas sem pontuação
    n = db.execute(text("""
        SELECT count(*) FROM bets b
        JOIN matches m ON m.id = b.match_id
        WHERE m.status = 'finished' AND b.points_earned IS NULL
    """)).scalar() or 0
    if n > 0:
        anomalies.append({"level": "error", "msg": f"{n} aposta(s) em partidas finalizadas sem pontuação calculada"})

    # R32 abaixo de 16
    r32_count = db.execute(text(
        "SELECT count(*) FROM matches WHERE phase = 'r32'::matchphase"
    )).scalar() or 0
    if r32_count < 16:
        anomalies.append({"level": "error", "msg": f"Apenas {r32_count}/16 partidas R32 no banco — sync incompleto"})

    # Cron atrasado
    if cron_health.get("available") and not cron_health.get("on_schedule"):
        mins = cron_health["last_modified_minutes_ago"]
        anomalies.append({"level": "error", "msg": f"Cron não executa há {mins:.0f} min (esperado ≤ 10 min)"})

    if not anomalies:
        anomalies.append({"level": "ok", "msg": "Nenhuma anomalia detectada"})

    # ── Phase counters ────────────────────────────────────────────────────
    rows = db.execute(text("""
        SELECT phase::text, count(*) AS total,
               count(mr.id) AS with_result,
               sum(CASE WHEN m.status = 'finished' THEN 1 ELSE 0 END) AS finished
        FROM matches m
        LEFT JOIN match_results mr ON mr.match_id = m.id
        GROUP BY phase ORDER BY phase
    """)).fetchall()
    phase_stats = [
        {"phase": r[0], "total": int(r[1]), "with_result": int(r[2]), "finished": int(r[3])}
        for r in rows
    ]

    # ── R32 detail (for reference grid) ──────────────────────────────────
    r32_rows = db.execute(text("""
        SELECT m.id, m.match_number, m.match_date, m.status::text,
               ta.code, ta.name, ta.flag_url,
               tb.code, tb.name, tb.flag_url,
               mr.score_a, mr.score_b,
               (SELECT count(*) FROM bets WHERE match_id = m.id) AS bets
        FROM matches m
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        LEFT JOIN match_results mr ON mr.match_id = m.id
        WHERE m.phase = 'r32'::matchphase
        ORDER BY m.match_number
    """)).fetchall()
    r32_matches = [
        {
            "id": r[0], "match_number": r[1],
            "match_date": _dt(r[2]),
            "status": r[3],
            "team_a": {"code": r[4], "name": r[5], "flag_url": r[6]},
            "team_b": {"code": r[7], "name": r[8], "flag_url": r[9]},
            "score": {"a": r[10], "b": r[11]} if r[10] is not None else None,
            "bets": int(r[12]),
        }
        for r in r32_rows
    ]

    return {
        "generated_at": now_brt.isoformat(),
        "cron_health": cron_health,
        "today_matches": today_matches,
        "anomalies": anomalies,
        "phase_stats": phase_stats,
        "r32_matches": r32_matches,
        "cron_log": cron_log,
    }
