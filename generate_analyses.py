#!/usr/bin/env python3
"""
Roda dentro do container predicts_api.
Gera análises IA para partidas pendentes com rate limit controlado.
"""
import json, sys, time
sys.path.insert(0, "/app")

import requests as http_requests
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DB_URL     = "postgresql://predicts:Predicts2026DBSecure@db:5432/predicts2026"
SLEEP_OK   = 20   # entre gerações bem-sucedidas
SLEEP_429  = 90   # após rate limit


def strip_fences(t):
    t = t.strip()
    if t.startswith("```"):
        parts = t.split("```")
        t = parts[1] if len(parts) > 1 else t
        if t.startswith("json"):
            t = t[4:]
    return t.strip()


def call_openrouter(api_key, model, prompt):
    resp = http_requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://predicts.info",
            "X-Title": "Predicts Copa 2026",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 8000,
        },
        timeout=120,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    return json.loads(strip_fences(raw))


def main():
    engine  = create_engine(DB_URL)
    Session = sessionmaker(bind=engine)
    db      = Session()

    # Config do banco
    cfg_rows = db.execute(
        text("SELECT key, value FROM site_config WHERE key IN ('openrouter_api_key','openrouter_model')")
    ).fetchall()
    cfg      = {r[0]: r[1] for r in cfg_rows}
    api_key  = cfg.get("openrouter_api_key", "")
    model    = cfg.get("openrouter_model", "google/gemma-4-31b-it:free")

    if not api_key:
        print("❌ openrouter_api_key não configurada no site_config")
        return

    # Partidas pendentes
    pending = db.execute(text("""
        SELECT m.id, ta.code, tb.code
        FROM matches m
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        WHERE NOT EXISTS (SELECT 1 FROM match_analyses ma WHERE ma.match_id = m.id)
        ORDER BY CASE WHEN m.match_date >= NOW() THEN 0 ELSE 1 END, m.match_date
    """)).fetchall()

    print(f"🎯 {len(pending)} pendentes | modelo: {model}")
    print("-" * 60, flush=True)

    from routers.analysis import _build_prompt, _get_recent_results, _get_mc_prob
    from models import Team, Player

    ok = err = 0
    for i, (mid, code_a, code_b) in enumerate(pending):
        label = f"[{i+1}/{len(pending)}] {code_a} × {code_b} id={mid}"
        retries = 0
        while retries <= 3:
            try:
                row = db.execute(text("""
                    SELECT ta.id, tb.id, m.match_date, m.phase, ta.group_name
                    FROM matches m JOIN teams ta ON ta.id=m.team_a_id JOIN teams tb ON tb.id=m.team_b_id
                    WHERE m.id=:mid
                """), {"mid": mid}).fetchone()
                match_row = {"match_date": row[2], "phase": row[3], "group_name": row[4]}
                team_a  = db.query(Team).get(row[0])
                team_b  = db.query(Team).get(row[1])
                pl_a    = db.query(Player).filter_by(team_id=row[0]).all()
                pl_b    = db.query(Player).filter_by(team_id=row[1]).all()
                prompt  = _build_prompt(match_row, team_a, team_b, pl_a, pl_b,
                                        _get_recent_results(db, team_a.code),
                                        _get_recent_results(db, team_b.code),
                                        _get_mc_prob(db, mid), "")

                content = call_openrouter(api_key, model, prompt)

                db.execute(text("""
                    INSERT INTO match_analyses (match_id, content, model_used, generated_at)
                    VALUES (:mid, :c, :m, NOW())
                    ON CONFLICT (match_id) DO UPDATE
                      SET content=EXCLUDED.content, model_used=EXCLUDED.model_used,
                          generated_at=EXCLUDED.generated_at
                """), {"mid": mid, "c": json.dumps(content), "m": f"openrouter/{model}"})
                db.commit()

                verdict = content.get("verdict", "")[:80]
                print(f"✓ {label} — {verdict}", flush=True)
                ok += 1
                if i < len(pending) - 1:
                    time.sleep(SLEEP_OK)
                break

            except Exception as e:
                emsg = str(e)
                db.rollback()
                if "429" in emsg or "rate" in emsg.lower() or "Too Many" in emsg:
                    retries += 1
                    print(f"⚠️  {label} 429 (try {retries}/3) — sleep {SLEEP_429}s", flush=True)
                    time.sleep(SLEEP_429)
                else:
                    print(f"✗ {label}: {emsg[:120]}", flush=True)
                    err += 1
                    break

    print(f"\n✅ {ok} geradas, {err} erros de {len(pending)} pendentes")
    db.close()
    engine.dispose()


if __name__ == "__main__":
    main()
