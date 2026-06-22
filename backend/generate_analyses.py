#!/usr/bin/env python3
"""
Gera análises IA para partidas pendentes com fallback automático de providers.
Cadeia: Gemini key1 → Gemini key2 → OpenRouter best free (Nemotron 550B)
Rodar dentro do container: docker exec predicts_api python3 /app/generate_analyses.py
"""
import json, sys, time
sys.path.insert(0, "/app")

import requests as http_requests
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DB_URL      = "postgresql://predicts:Predicts2026DBSecure@db:5432/predicts2026"
SLEEP_OK    = 15    # entre gerações bem-sucedidas
SLEEP_429   = 60    # após rate limit temporário (mesmo provider)
SLEEP_CHAIN = 5     # entre troca de provider


def strip_fences(t):
    t = t.strip()
    if t.startswith("```"):
        parts = t.split("```")
        t = parts[1] if len(parts) > 1 else t
        if t.startswith("json"):
            t = t[4:]
    return t.strip()


def is_quota_err(e):
    s = str(e).lower()
    return "429" in str(e) or "too many" in s or "quota" in s or "resource_exhausted" in s or "rate" in s


def call_gemini(api_key, model, prompt):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    resp = http_requests.post(
        url,
        headers={"Content-Type": "application/json"},
        json={"contents": [{"parts": [{"text": prompt}]}],
              "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.7}},
        timeout=120,
    )
    resp.raise_for_status()
    text_out = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(strip_fences(text_out))


def call_openrouter(api_key, model, prompt):
    resp = http_requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                 "HTTP-Referer": "https://predicts.info", "X-Title": "Predicts Copa 2026"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}],
              "temperature": 0.7, "max_tokens": 8000},
        timeout=120,
    )
    resp.raise_for_status()
    return json.loads(strip_fences(resp.json()["choices"][0]["message"]["content"]))


def call_with_chain(chain, prompt):
    """Tenta cada provider em ordem. Quota/429 → avança. Outro erro → propaga."""
    for idx, p in enumerate(chain):
        try:
            if p["type"] == "gemini":
                result = call_gemini(p["key"], p["model"], prompt)
            else:
                result = call_openrouter(p["key"], p["model"], prompt)
            return result, p["label"]
        except Exception as e:
            if is_quota_err(e) and idx < len(chain) - 1:
                print(f"  ⚡ {p['label']} exausto → {chain[idx+1]['label']}", flush=True)
                time.sleep(SLEEP_CHAIN)
                continue
            raise
    raise RuntimeError("Todos os providers exaustos")


def main():
    engine  = create_engine(DB_URL)
    Session = sessionmaker(bind=engine)
    db      = Session()

    # Ler config do banco
    cfg_rows = db.execute(text(
        "SELECT key,value FROM site_config WHERE key IN ("
        "'openrouter_api_key','openrouter_model','gemini_api_key','gemini_api_key_2','gemini_model')"
    )).fetchall()
    cfg = {r[0]: r[1] for r in cfg_rows}

    gemini_model = cfg.get("gemini_model", "gemini-2.5-flash")
    or_key       = cfg.get("openrouter_api_key", "")
    best_free    = "nvidia/nemotron-3-ultra-550b-a55b:free"

    # Montar cadeia
    chain = []
    if cfg.get("gemini_api_key"):
        chain.append({"type": "gemini",     "key": cfg["gemini_api_key"],   "model": gemini_model, "label": f"Gemini key1 ({gemini_model})"})
    if cfg.get("gemini_api_key_2"):
        chain.append({"type": "gemini",     "key": cfg["gemini_api_key_2"], "model": gemini_model, "label": f"Gemini key2 ({gemini_model})"})
    if or_key:
        chain.append({"type": "openrouter", "key": or_key,                  "model": best_free,    "label": f"OpenRouter {best_free}"})

    if not chain:
        print("❌ Nenhum provider configurado"); return

    # Partidas pendentes
    pending = db.execute(text("""
        SELECT m.id, ta.code, tb.code
        FROM matches m
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        WHERE NOT EXISTS (SELECT 1 FROM match_analyses ma WHERE ma.match_id = m.id)
        ORDER BY CASE WHEN m.match_date >= NOW() THEN 0 ELSE 1 END, m.match_date
    """)).fetchall()

    print(f"🎯 {len(pending)} pendentes")
    print(f"📡 Cadeia: {' → '.join(p['label'] for p in chain)}")
    print("-" * 70, flush=True)

    from routers.analysis import _build_prompt, _get_recent_results, _get_mc_prob
    from models import Team, Player

    ok = err = 0
    for i, (mid, code_a, code_b) in enumerate(pending):
        label = f"[{i+1}/{len(pending)}] {code_a} × {code_b} id={mid}"
        retries = 0
        while True:
            try:
                row = db.execute(text("""
                    SELECT ta.id, tb.id, m.match_date, m.phase, ta.group_name
                    FROM matches m JOIN teams ta ON ta.id=m.team_a_id JOIN teams tb ON tb.id=m.team_b_id
                    WHERE m.id=:mid
                """), {"mid": mid}).fetchone()
                match_row = {"match_date": row[2], "phase": row[3], "group_name": row[4]}
                team_a = db.get(Team, row[0])
                team_b = db.get(Team, row[1])
                pl_a   = db.query(Player).filter_by(team_id=row[0]).all()
                pl_b   = db.query(Player).filter_by(team_id=row[1]).all()
                prompt = _build_prompt(match_row, team_a, team_b, pl_a, pl_b,
                                       _get_recent_results(db, team_a.code),
                                       _get_recent_results(db, team_b.code),
                                       _get_mc_prob(db, mid), "")

                content, provider_used = call_with_chain(chain, prompt)

                db.execute(text("""
                    INSERT INTO match_analyses (match_id, content, model_used, generated_at)
                    VALUES (:mid, :c, :m, NOW())
                    ON CONFLICT (match_id) DO UPDATE
                      SET content=EXCLUDED.content, model_used=EXCLUDED.model_used,
                          generated_at=EXCLUDED.generated_at
                """), {"mid": mid, "c": json.dumps(content), "m": provider_used})
                db.commit()

                verdict = content.get("verdict", "")[:80]
                print(f"✓ {label} [{provider_used.split('/')[0]}] — {verdict}", flush=True)
                ok += 1
                if i < len(pending) - 1:
                    time.sleep(SLEEP_OK)
                break

            except Exception as e:
                db.rollback()
                emsg = str(e)
                if is_quota_err(emsg) and retries < 3:
                    retries += 1
                    print(f"⚠️  {label} rate limit (try {retries}/3) — sleep {SLEEP_429}s", flush=True)
                    time.sleep(SLEEP_429)
                else:
                    print(f"✗ {label}: {emsg[:120]}", flush=True)
                    err += 1
                    break

    print(f"\n{'='*70}")
    print(f"✅ {ok} geradas, {err} erros de {len(pending)} pendentes")
    db.close()
    engine.dispose()


if __name__ == "__main__":
    main()
