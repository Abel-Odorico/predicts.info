#!/usr/bin/env python3
"""
Atualiza dados das 48 seleções com dados reais de eloratings.net
- Elo atual (tempo real — inclui partidas WC 2026 já jogadas)
- Média de gols marcados/sofridos (últimas 20 partidas)
- Forma (últimas 5/10/20 partidas) — taxa de pontos: W=1, D=0.5, L=0

Roda DENTRO do container:
  docker exec copa_api python3 /app/update_real_data.py
"""

import sys, os, time
import httpx
from sqlalchemy import create_engine, text

TEAM_MAP = {
    "ARG": ("Argentina",     "AR"),
    "FRA": ("France",        "FR"),
    "ESP": ("Spain",         "ES"),
    "ENG": ("England",       "EN"),
    "BRA": ("Brazil",        "BR"),
    "POR": ("Portugal",      "PT"),
    "GER": ("Germany",       "DE"),
    "NED": ("Netherlands",   "NL"),
    "MAR": ("Morocco",       "MA"),
    "ITA": ("Italy",         "IT"),
    "URU": ("Uruguay",       "UY"),
    "COL": ("Colombia",      "CO"),
    "JPN": ("Japan",         "JP"),
    "CRO": ("Croatia",       "HR"),
    "USA": ("United_States", "US"),
    "BEL": ("Belgium",       "BE"),
    "MEX": ("Mexico",        "MX"),
    "KOR": ("South_Korea",   "KR"),
    "SEN": ("Senegal",       "SN"),
    "SUI": ("Switzerland",   "CH"),
    "AUT": ("Austria",       "AT"),
    "DEN": ("Denmark",       "DK"),
    "TUR": ("Turkey",        "TR"),
    "SRB": ("Serbia",        "RS"),
    "ECU": ("Ecuador",       "EC"),
    "AUS": ("Australia",     "AU"),
    "IRN": ("Iran",          "IR"),
    "NGA": ("Nigeria",       "NG"),
    "CAN": ("Canada",        "CA"),
    "CHI": ("Chile",         "CL"),
    "VEN": ("Venezuela",     "VE"),
    "EGY": ("Egypt",         "EG"),
    "COD": ("DR_Congo",      "CD"),
    "TUN": ("Tunisia",       "TN"),
    "CMR": ("Cameroon",      "CM"),
    "KSA": ("Saudi_Arabia",  "SA"),
    "SVK": ("Slovakia",      "SK"),
    "GHA": ("Ghana",         "GH"),
    "PAN": ("Panama",        "PA"),
    "UZB": ("Uzbekistan",    "UZ"),
    "HON": ("Honduras",      "HN"),
    "RSA": ("South_Africa",  "ZA"),
    "CRC": ("Costa_Rica",    "CR"),
    "SCO": ("Scotland",      "SQ"),
    "IRQ": ("Iraq",          "IQ"),
    "JOR": ("Jordan",        "JO"),
    "NZL": ("New_Zealand",   "NZ"),
    "IDN": ("Indonesia",     "ID"),
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

BASE_URL = "https://www.eloratings.net/{}.tsv"
DB_URL   = os.getenv("DATABASE_URL", "postgresql://copa:Copa2026DBSecure@db:5432/copa2026")


def fetch_tsv(client: httpx.Client, url_name: str) -> list[list[str]] | None:
    url = BASE_URL.format(url_name)
    try:
        r = client.get(url, timeout=15)
        if r.status_code != 200:
            print(f"  ✗ HTTP {r.status_code}")
            return None
        lines = []
        for line in r.text.strip().splitlines():
            cols = line.split("\t")
            if len(cols) >= 8:
                lines.append(cols)
        return lines
    except Exception as e:
        print(f"  ✗ {e}")
        return None


def parse_stats(rows: list[list[str]], elo_code: str, n: int = 20) -> dict:
    matches = []
    for cols in rows:
        try:
            home      = cols[3].strip()
            away      = cols[4].strip()
            hg        = int(cols[5])
            ag        = int(cols[6])
        except (ValueError, IndexError):
            continue

        if home == elo_code:
            gf, ga = hg, ag
            elo_col = 10
        elif away == elo_code:
            gf, ga = ag, hg
            elo_col = 11
        else:
            continue

        try:
            elo_after = float(cols[elo_col])
        except (ValueError, IndexError):
            elo_after = None

        result = 1.0 if gf > ga else (0.5 if gf == ga else 0.0)
        matches.append({"gf": gf, "ga": ga, "result": result, "elo_after": elo_after})

    if not matches:
        return {}

    elo_current = next((m["elo_after"] for m in reversed(matches) if m["elo_after"]), None)

    recent    = matches[-n:]
    recent_5  = matches[-5:]
    recent_10 = matches[-10:]

    def form(subset):
        if not subset: return 0.5
        return round(sum(m["result"] for m in subset) / len(subset), 4)

    def avg(subset, key):
        if not subset: return 1.35
        return round(sum(m[key] for m in subset) / len(subset), 4)

    return {
        "elo":    elo_current,
        "gf":     avg(recent, "gf"),
        "ga":     avg(recent, "ga"),
        "form5":  form(recent_5),
        "form10": form(recent_10),
        "form20": form(recent),
        "n":      len(recent),
    }


def main():
    print("=== COPA 2026 — Atualização dados reais ===")
    print(f"Fonte: eloratings.net  |  {len(TEAM_MAP)} seleções\n")

    engine   = create_engine(DB_URL)
    updates  = {}
    errors   = []

    with httpx.Client(headers=HEADERS, follow_redirects=True) as client:
        for i, (code, (url_name, elo_code)) in enumerate(TEAM_MAP.items(), 1):
            print(f"[{i:02d}/{len(TEAM_MAP)}] {code:4s} → {url_name}", end="  ")
            sys.stdout.flush()

            rows = fetch_tsv(client, url_name)
            if not rows:
                errors.append(code)
                continue

            s = parse_stats(rows, elo_code)
            if not s:
                print(f"⚠ sem partidas para código '{elo_code}'")
                errors.append(code)
                continue

            updates[code] = s
            print(f"Elo {s['elo']:.0f}  GF {s['gf']:.2f}  GA {s['ga']:.2f}  "
                  f"F5={s['form5']:.2f} F10={s['form10']:.2f}  [{s['n']} jogos]")

            if i < len(TEAM_MAP):
                time.sleep(0.35)

    print(f"\n{'─'*60}")
    if errors:
        print(f"Erros ({len(errors)}): {', '.join(errors)}")

    print(f"\nAtualizando {len(updates)} times no banco...")
    ok = skip = 0
    with engine.begin() as conn:
        for code, s in updates.items():
            if not s.get("elo"):
                skip += 1
                continue
            result = conn.execute(text("""
                UPDATE teams SET
                    elo_rating        = :elo,
                    avg_goals_for     = :gf,
                    avg_goals_against = :ga,
                    xg_for            = :gf,
                    xg_against        = :ga,
                    form_5            = :f5,
                    form_10           = :f10,
                    form_20           = :f20
                WHERE code = :code
            """), {"elo": s["elo"], "gf": s["gf"], "ga": s["ga"],
                   "f5": s["form5"], "f10": s["form10"], "f20": s["form20"],
                   "code": code})
            if result.rowcount:
                ok += 1
            else:
                print(f"  ⚠ {code} não encontrado no banco")
                skip += 1

    print(f"✓ Atualizados: {ok}  |  Pulados: {skip}")

    # Invalida cache Redis
    try:
        import redis as redis_lib
        from config import settings
        r = redis_lib.from_url(settings.redis_url, decode_responses=True)
        cleared = sum(1 for k in (*r.scan_iter("tournament:*"), *r.scan_iter("sim:*"))
                      if r.delete(k))
        print(f"Redis: {cleared} chaves removidas")
    except Exception as e:
        print(f"Redis: {e}")

    print("\nPronto! Novas simulações usarão dados reais.\n")


if __name__ == "__main__":
    main()
