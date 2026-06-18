#!/usr/bin/env python3
"""
Atualiza dados das 48 seleções com dados reais de eloratings.net
- Elo atual
- Média de gols marcados/sofridos (últimas 20 partidas)
- Forma (últimas 5/10/20 partidas)

Fonte: https://www.eloratings.net/{TeamName}.tsv
"""

import sys
import os
import time
import requests
import psycopg2
from io import StringIO

# ─────────────────────────────────────────────
# Mapeamento: nosso código DB → (nome URL eloratings, código eloratings)
# ─────────────────────────────────────────────
TEAM_MAP = {
    # code_db: (url_name, elo_code)
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
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

BASE_URL = "https://www.eloratings.net/{}.tsv"

# ─────────────────────────────────────────────
# Conexão DB — igual ao .env
# ─────────────────────────────────────────────
DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://copa:Copa2026DBSecure@localhost:5435/copa2026"
)


def fetch_tsv(url_name: str) -> list[list[str]] | None:
    url = BASE_URL.format(url_name)
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            print(f"  ✗ HTTP {r.status_code} — {url}")
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


def parse_team_stats(rows: list[list[str]], elo_code: str, n: int = 20) -> dict:
    """
    Extrai dos últimos n jogos:
      - elo_current: último Elo registrado
      - avg_goals_for, avg_goals_against (últimos n jogos)
      - form_5, form_10, form_20 (taxa de pontos: W=1, D=0.5, L=0)
    """
    matches = []
    for cols in rows:
        try:
            year   = int(cols[0])
            home   = cols[3].strip()
            away   = cols[4].strip()
            gf_raw = cols[5].strip()
            ga_raw = cols[6].strip()
            if not gf_raw.lstrip("-").isdigit():
                continue
            if not ga_raw.lstrip("-").isdigit():
                continue
            home_goals = int(gf_raw)
            away_goals = int(ga_raw)
        except (ValueError, IndexError):
            continue

        if home == elo_code:
            our_goals   = home_goals
            their_goals = away_goals
            is_home     = True
            try:
                elo_after = float(cols[10])
            except (ValueError, IndexError):
                elo_after = None
        elif away == elo_code:
            our_goals   = away_goals
            their_goals = home_goals
            is_home     = False
            try:
                elo_after = float(cols[11])
            except (ValueError, IndexError):
                elo_after = None
        else:
            continue

        if our_goals > their_goals:
            result = 1.0
        elif our_goals == their_goals:
            result = 0.5
        else:
            result = 0.0

        matches.append({
            "year": year,
            "gf": our_goals,
            "ga": their_goals,
            "result": result,
            "elo_after": elo_after,
        })

    if not matches:
        return {}

    # Ordena cronológico (já vem assim, mas garante)
    matches.sort(key=lambda x: x["year"])

    # Elo mais recente
    elo_current = None
    for m in reversed(matches):
        if m["elo_after"] is not None:
            elo_current = m["elo_after"]
            break

    # Últimos n jogos para médias
    recent = matches[-n:]
    recent_5  = matches[-5:]
    recent_10 = matches[-10:]

    def form(subset):
        if not subset:
            return 0.5
        return round(sum(m["result"] for m in subset) / len(subset), 4)

    def avg(subset, key):
        if not subset:
            return 1.35
        return round(sum(m[key] for m in subset) / len(subset), 4)

    return {
        "elo_current":     elo_current,
        "avg_goals_for":   avg(recent, "gf"),
        "avg_goals_against": avg(recent, "ga"),
        "xg_for":          avg(recent, "gf"),       # proxy — sem fonte de xG acessível
        "xg_against":      avg(recent, "ga"),
        "form_5":          form(recent_5),
        "form_10":         form(recent_10),
        "form_20":         form(recent),
        "matches_used":    len(recent),
    }


def update_db(updates: dict[str, dict]) -> None:
    conn = psycopg2.connect(DB_URL)
    cur  = conn.cursor()
    ok = 0
    skip = 0
    for code_db, stats in updates.items():
        if not stats.get("elo_current"):
            print(f"  ⚠ {code_db} — sem Elo, pulando")
            skip += 1
            continue
        cur.execute("""
            UPDATE teams SET
                elo_rating        = %s,
                avg_goals_for     = %s,
                avg_goals_against = %s,
                xg_for            = %s,
                xg_against        = %s,
                form_5            = %s,
                form_10           = %s,
                form_20           = %s
            WHERE code = %s
        """, (
            stats["elo_current"],
            stats["avg_goals_for"],
            stats["avg_goals_against"],
            stats["xg_for"],
            stats["xg_against"],
            stats["form_5"],
            stats["form_10"],
            stats["form_20"],
            code_db,
        ))
        if cur.rowcount:
            ok += 1
        else:
            print(f"  ⚠ {code_db} não encontrado no banco")
            skip += 1
    conn.commit()
    cur.close()
    conn.close()
    print(f"\n✓ Atualizados: {ok} | Pulados: {skip}")


def main():
    print("=== COPA 2026 — Atualização de dados reais ===")
    print(f"Fonte: eloratings.net  |  {len(TEAM_MAP)} seleções\n")

    updates = {}
    errors  = []

    for i, (code_db, (url_name, elo_code)) in enumerate(TEAM_MAP.items(), 1):
        print(f"[{i:02d}/{len(TEAM_MAP)}] {code_db:4s} → {url_name}")
        rows = fetch_tsv(url_name)
        if not rows:
            errors.append(code_db)
            continue

        stats = parse_team_stats(rows, elo_code, n=20)
        if not stats:
            print(f"  ⚠ Sem jogos encontrados para código '{elo_code}'")
            errors.append(code_db)
            continue

        updates[code_db] = stats
        print(f"  Elo {stats['elo_current']:.0f}  |  "
              f"GF {stats['avg_goals_for']:.2f}  GA {stats['avg_goals_against']:.2f}  |  "
              f"Form5 {stats['form_5']:.2f}  Form10 {stats['form_10']:.2f}  |  "
              f"{stats['matches_used']} jogos")

        # Polite delay — 0.4s entre requests
        if i < len(TEAM_MAP):
            time.sleep(0.4)

    print(f"\n{'─'*50}")
    if errors:
        print(f"Erros ({len(errors)}): {', '.join(errors)}")

    print(f"\nAtualizando banco de dados...")
    update_db(updates)

    # Invalida cache Redis
    try:
        import redis
        r = redis.from_url("redis://localhost:6380")
        cleared = 0
        for key in r.scan_iter("tournament:*"):
            r.delete(key)
            cleared += 1
        for key in r.scan_iter("sim:*"):
            r.delete(key)
            cleared += 1
        print(f"Redis: {cleared} chaves de cache removidas")
    except Exception as e:
        print(f"Redis: {e} (pode precisar invalidar manualmente)")

    print("\nDone. Acesse /api/admin e clique 'Limpar Cache' para forçar\n"
          "novas simulações com os dados atualizados.")


if __name__ == "__main__":
    main()
