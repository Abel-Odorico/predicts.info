"""
GET /api/tournament/awards

Estatísticas ao vivo do torneio:
- Artilheiros (Wikipedia Module:Goalscorers)
- Melhor ataque / melhor defesa / clean sheets (DB)
- Melhor goleiro (por clean sheets, DB)
- Suspensos (Wikipedia quando disponível)
"""
import json
import re
from datetime import datetime, timezone

import httpx
import redis as redis_lib
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from config import settings
from database import get_db

router = APIRouter(prefix="/tournament", tags=["tournament"])

AWARDS_CACHE_KEY = "tournament:awards"
AWARDS_CACHE_TTL = 1800  # 30 min

_WIKI_UA = "predicts.info/1.0 (football simulator; open source)"

WIKI_SCORERS_API = (
    "https://en.wikipedia.org/w/api.php"
    "?action=query&prop=revisions&rvprop=content&rvslots=main&format=json"
    "&titles=Module:Goalscorers/data/2026_FIFA_World_Cup"
)
WIKI_DISCIPLINE_API = (
    "https://en.wikipedia.org/w/api.php"
    "?action=query&prop=revisions&rvprop=content&rvslots=main&format=json"
    "&titles=2026_FIFA_World_Cup_statistics"
)


def _redis():
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


def _clean_name(wiki_link: str) -> str:
    """Extract display name from [[Link|Name]] or [[Name]]."""
    m = re.search(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', wiki_link)
    name = m.group(1) if m else wiki_link
    return name.replace("&nbsp;", " ").replace("  ", " ").strip()


def _wiki_page_content(api_url: str) -> str | None:
    """Fetch raw wikitext via MediaWiki API (bypasses ?action=raw 403)."""
    try:
        resp = httpx.get(
            api_url, timeout=15, follow_redirects=True,
            headers={"User-Agent": _WIKI_UA},
        )
        resp.raise_for_status()
        pages = resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            revs = page.get("revisions", [])
            if revs:
                return revs[0].get("slots", {}).get("main", {}).get("*", "")
    except Exception:
        pass
    return None


def _fetch_goalscorers() -> list[dict]:
    """Parse artilheiros do módulo Lua do Wikipedia."""
    text_raw = _wiki_page_content(WIKI_SCORERS_API)
    if not text_raw:
        return []

    # Pattern: {"[[Name]]", "CODE", N}  — skip own-goal entries (3rd elem is table)
    pattern = re.compile(
        r'\{"(\[\[.*?\]\])"[,\s]+"([A-Z]+)"[,\s]+(\d+)\s*\}',
        re.MULTILINE,
    )
    scorers: dict[tuple, int] = {}
    for m in pattern.finditer(text_raw):
        name = _clean_name(m.group(1))
        code = m.group(2)
        goals = int(m.group(3))
        key = (name, code)
        scorers[key] = scorers.get(key, 0) + goals

    result = [{"player": k[0], "team": k[1], "goals": v} for k, v in scorers.items()]
    result.sort(key=lambda x: -x["goals"])
    return result


def _fetch_suspensions() -> list[dict]:
    """Tenta parsear suspensos do Wikipedia statistics page (pode não existir ainda)."""
    try:
        raw = _wiki_page_content(WIKI_DISCIPLINE_API)
        if not raw:
            return []
        # Look for suspended players section
        susp_section = re.search(
            r'==\s*[Ss]uspend|==\s*[Ss]uspens',
            raw
        )
        if not susp_section:
            return []
        section = raw[susp_section.start():]
        next_sec = re.search(r'\n==\s*[^=]', section[3:])
        if next_sec:
            section = section[: next_sec.start() + 3]
        # Extract player entries
        entries = re.findall(
            r'\{\{flagicon\|([^}]+)\}\}.*?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]',
            section
        )
        result = []
        for country, link, display in entries:
            result.append({
                "player": display.strip() if display else link.strip(),
                "team": country.strip().upper()[:3],
            })
        return result
    except Exception:
        return []


def _db_team_stats(db: Session) -> dict:
    """Computa estatísticas de times a partir dos resultados no DB."""
    rows = db.execute(text("""
        SELECT
            t.code, t.name, t.flag_url, t.confederation,
            SUM(CASE WHEN m.team_a_id = t.id THEN mr.score_a ELSE mr.score_b END) AS gf,
            SUM(CASE WHEN m.team_a_id = t.id THEN mr.score_b ELSE mr.score_a END) AS ga,
            COUNT(*)::int AS matches,
            SUM(CASE
                WHEN m.team_a_id = t.id AND mr.score_b = 0 THEN 1
                WHEN m.team_b_id = t.id AND mr.score_a = 0 THEN 1
                ELSE 0
            END)::int AS clean_sheets
        FROM teams t
        JOIN matches m ON (m.team_a_id = t.id OR m.team_b_id = t.id)
        JOIN match_results mr ON mr.match_id = m.id
        GROUP BY t.id, t.code, t.name, t.flag_url, t.confederation
        HAVING COUNT(*) > 0
    """)).fetchall()

    stats = []
    for r in rows:
        gf, ga, mp, cs = int(r[4] or 0), int(r[5] or 0), int(r[6] or 0), int(r[7] or 0)
        stats.append({
            "team": r[0], "name": r[1], "flag_url": r[2], "confederation": r[3],
            "goals_scored": gf, "goals_conceded": ga,
            "matches": mp, "clean_sheets": cs,
            "avg_scored": round(gf / mp, 2) if mp else 0,
            "avg_conceded": round(ga / mp, 2) if mp else 0,
        })
    return stats


def _team_map(db: Session) -> dict[str, dict]:
    """code → {name, flag_url} para enriquecer artilheiros."""
    rows = db.execute(text("SELECT code, name, flag_url FROM teams")).fetchall()
    return {r[0]: {"name": r[1], "flag_url": r[2]} for r in rows}


def _build_awards(db: Session) -> dict:
    team_stats = _db_team_stats(db)
    teams = _team_map(db)
    scorers_raw = _fetch_goalscorers()
    suspensions = _fetch_suspensions()

    # Enrich scorers with team info
    scorers = []
    for i, s in enumerate(scorers_raw[:20]):
        t = teams.get(s["team"], {})
        scorers.append({
            "position": i + 1,
            "player": s["player"],
            "team": s["team"],
            "team_name": t.get("name", s["team"]),
            "flag_url": t.get("flag_url"),
            "goals": s["goals"],
        })

    best_attack = sorted(team_stats, key=lambda x: (-x["goals_scored"], -x["avg_scored"]))[:10]
    best_defense = sorted(
        [t for t in team_stats if t["matches"] > 0],
        key=lambda x: (x["avg_conceded"], x["goals_conceded"])
    )[:10]
    best_gk = sorted(
        [t for t in team_stats if t["clean_sheets"] > 0],
        key=lambda x: (-x["clean_sheets"], x["avg_conceded"])
    )[:8]

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "top_scorers": scorers,
        "best_attack": best_attack,
        "best_defense": best_defense,
        "best_gk": best_gk,
        "suspensions": suspensions,
    }


@router.get("/awards")
def tournament_awards(db: Session = Depends(get_db)):
    try:
        r = _redis()
        cached = r.get(AWARDS_CACHE_KEY)
        if cached:
            data = json.loads(cached)
            data["cached"] = True
            return data
    except Exception:
        pass

    data = _build_awards(db)

    try:
        r = _redis()
        r.setex(AWARDS_CACHE_KEY, AWARDS_CACHE_TTL, json.dumps(data, ensure_ascii=False, default=str))
    except Exception:
        pass

    return data
