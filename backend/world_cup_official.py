from __future__ import annotations

import re
from datetime import datetime
from typing import Callable

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from models import Match, MatchPhase, MatchResult, MatchStatus, Team
from world_cup_sync import _clean_links, _parse_local_datetime, HEADERS

KNOCKOUT_TITLE = "2026_FIFA_World_Cup_knockout_stage"
FINAL_TITLE = "2026_FIFA_World_Cup_final"
R32_TITLE = "2026_FIFA_World_Cup_round_of_32"
RAW_URL = "https://en.wikipedia.org/w/index.php?title={title}&action=raw"

LogFn = Callable[[str], None] | None


def _fetch_raw(title: str) -> str:
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=30.0) as client:
        response = client.get(RAW_URL.format(title=title))
        response.raise_for_status()
        return response.text


def _slot_label(raw: str) -> str:
    value = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
    value = re.sub(r"\{\{#invoke:flag\|fb(?:-rt)?\|[A-Z]{0,3}\}\}", "", value)
    value = _clean_links(value)
    return " ".join(value.split()).strip()


def _parse_stadium(block: str) -> tuple[str | None, str | None]:
    stadium_match = re.search(r"\|stadium=(.+)", block)
    stadium_value = _clean_links(stadium_match.group(1)) if stadium_match else ""
    venue, city = stadium_value, None
    if "," in stadium_value:
        venue, city = stadium_value.rsplit(",", 1)
        venue = venue.strip()
        city = city.strip()
    return venue or None, city or None


def _phase_for_section(section: str) -> str:
    if section.startswith("R32"):
        return "r32"
    if section.startswith("R16"):
        return "r16"
    if section.startswith("QF"):
        return "qf"
    if section.startswith("SF"):
        return "sf"
    if section == "3rd":
        return "3rd"
    return "final"


def fetch_official_knockout_schedule() -> list[dict]:
    text = _fetch_raw(KNOCKOUT_TITLE)
    pattern = re.compile(
        r'<section begin="([^"]+)" />\{\{#invoke:football box\|main(.*?)\}\}<section end="[^"]+" />',
        flags=re.S,
    )
    matches = []
    for section, block in pattern.findall(text):
        team1_match = re.search(r"\|team1=(.+)", block)
        team2_match = re.search(r"\|team2=(.+)", block)
        score_link_match = re.search(r"\|score=\{\{score link\|[^|]+\|Match (\d+)\}\}", block)
        venue, city = _parse_stadium(block)
        matches.append(
            {
                "section": section,
                "phase": _phase_for_section(section),
                "match_number": int(score_link_match.group(1)) if score_link_match else None,
                "match_date": _parse_local_datetime(block),
                "venue": venue,
                "city": city,
                "team_a_label": _slot_label(team1_match.group(1) if team1_match else ""),
                "team_b_label": _slot_label(team2_match.group(1) if team2_match else ""),
            }
        )

    final_raw = _fetch_raw(FINAL_TITLE)
    infobox = re.search(r"\{\{Infobox football match(.*?)\n\}\}", final_raw, flags=re.S)
    if infobox:
        box = infobox.group(1)
        date_match = re.search(r"\|date=\{\{Start date\|(\d{4})\|(\d{2})\|(\d{2})\}\}", box)
        stadium_match = re.search(r"\|stadium=(.+)", box)
        city_match = re.search(r"\|city=(.+)", box)
        if date_match:
            year, month, day = map(int, date_match.groups())
            matches.append(
                {
                    "section": "Final",
                    "phase": "final",
                    "match_number": 104,
                    "match_date": datetime(year, month, day),
                    "venue": _clean_links(stadium_match.group(1)) if stadium_match else None,
                    "city": _clean_links(city_match.group(1)) if city_match else None,
                    "team_a_label": "Winner Match 101",
                    "team_b_label": "Winner Match 102",
                }
            )

    matches.sort(key=lambda item: (item["match_date"] or datetime.max, item["match_number"] or 999))
    return matches


def compute_group_tables(db: Session) -> dict:
    teams = db.query(Team).filter(Team.group_name.isnot(None)).all()
    played = db.query(Match).filter(Match.phase == MatchPhase.group).all()

    groups: dict[str, list[dict]] = {}
    stats_by_team: dict[int, dict] = {}
    for team in teams:
        row = {
            "id": team.id,
            "code": team.code,
            "name": team.name,
            "group_name": team.group_name,
            "points": 0,
            "played": 0,
            "wins": 0,
            "draws": 0,
            "losses": 0,
            "gf": 0,
            "ga": 0,
            "gd": 0,
            "elo_rating": float(team.elo_rating),
            "flag_url": team.flag_url,
            "position": 0,
        }
        stats_by_team[team.id] = row
        groups.setdefault(team.group_name, []).append(row)

    for match in played:
        if not match.result:
            continue
        a = stats_by_team.get(match.team_a_id)
        b = stats_by_team.get(match.team_b_id)
        if not a or not b:
            continue
        a["played"] += 1
        b["played"] += 1
        a["gf"] += match.result.score_a
        a["ga"] += match.result.score_b
        b["gf"] += match.result.score_b
        b["ga"] += match.result.score_a
        if match.result.score_a > match.result.score_b:
            a["wins"] += 1
            a["points"] += 3
            b["losses"] += 1
        elif match.result.score_b > match.result.score_a:
            b["wins"] += 1
            b["points"] += 3
            a["losses"] += 1
        else:
            a["draws"] += 1
            b["draws"] += 1
            a["points"] += 1
            b["points"] += 1

    winners, runners_up, thirds = [], [], []
    for group_name, rows in groups.items():
        for row in rows:
            row["gd"] = row["gf"] - row["ga"]
        rows.sort(key=lambda item: (-item["points"], -item["gd"], -item["gf"], -item["elo_rating"], item["name"]))
        for index, row in enumerate(rows, start=1):
            row["position"] = index
        winners.append(rows[0])
        runners_up.append(rows[1])
        thirds.append(rows[2])

    thirds.sort(key=lambda item: (-item["points"], -item["gd"], -item["gf"], -item["elo_rating"], item["name"]))
    return {
        "groups": dict(sorted(groups.items())),
        "winners": winners,
        "runners_up": runners_up,
        "best_thirds": thirds[:8],
        "thirds": thirds,
    }


def resolve_slot(slot: str, table: dict) -> dict | None:
    groups = table["groups"]
    if slot.startswith("Winner Group "):
        group = slot.split("Winner Group ", 1)[1].strip()
        rows = groups.get(group)
        return rows[0] if rows else None
    if slot.startswith("Runner-up Group "):
        group = slot.split("Runner-up Group ", 1)[1].strip()
        rows = groups.get(group)
        return rows[1] if rows and len(rows) > 1 else None
    return None


def candidate_thirds(slot: str, table: dict) -> list[dict]:
    match = re.match(r"3rd Group ([A-Z/]+)", slot)
    if not match:
        return []
    allowed = set(match.group(1).split("/"))
    return [team for team in table["thirds"] if team["group_name"] in allowed][:8]


def _extract_team_code(raw: str) -> str | None:
    """Extract ISO team code from {{#invoke:flag|fb[-rt]|CODE}} template."""
    m = re.search(r"\{\{#invoke:flag\|fb(?:-rt)?\|([A-Z]{2,4})\}\}", raw)
    return m.group(1) if m else None


def _parse_score_from_block(block: str) -> tuple[int, int] | None:
    """Return (score_a, score_b) if {{score|a|b}} or {{score link|...|a–b}} present in block."""
    m = re.search(r"\|score=\{\{[Ss]core\|(\d+)\|(\d+)\}\}", block)
    if m:
        return int(m.group(1)), int(m.group(2))
    # Handle {{score link|...|A–B}} format (used when match has a dedicated Wikipedia section)
    m2 = re.search(r"\|score=\{\{score link\|[^|]+\|(\d+)–(\d+)\}\}", block)
    if m2:
        return int(m2.group(1)), int(m2.group(2))
    return None


def fetch_r32_schedule() -> list[dict]:
    """Fetch Round of 32 matches from Wikipedia (separate page)."""
    text = _fetch_raw(R32_TITLE)
    pattern = re.compile(
        r'<section begin="([^"]+)" />\{\{#invoke:[Ff]ootball box\|main(.*?)\}\}<section end="[^"]+" />',
        flags=re.S,
    )
    matches = []
    for section, block in pattern.findall(text):
        if not section.startswith("R32"):
            continue
        t1 = re.search(r"\|team1=(.+)", block)
        t2 = re.search(r"\|team2=(.+)", block)
        mn = re.search(r"\|score=\{\{score link\|[^|]+\|Match (\d+)\}\}", block)
        score = _parse_score_from_block(block)
        venue, city = _parse_stadium(block)
        matches.append({
            "section": section,
            "phase": "r32",
            "match_number": int(mn.group(1)) if mn else None,
            "match_date": _parse_local_datetime(block),
            "venue": venue,
            "city": city,
            "team_a_code": _extract_team_code(t1.group(1)) if t1 else None,
            "team_b_code": _extract_team_code(t2.group(1)) if t2 else None,
            "score": score,
        })
    matches.sort(key=lambda m: (m["match_date"] or datetime.max, m["match_number"] or 999))
    return matches


def sync_knockout_matches(db_url: str, log: LogFn = None) -> dict:
    """Upsert R32 knockout matches from Wikipedia into the DB.

    Creates new matches for R32 (teams resolved from codes) and updates
    scores/status for matches already in the DB. R16+ matches are skipped
    until their teams are determined by R32 results.
    """
    def _log(msg: str) -> None:
        if log:
            log(msg)

    engine = create_engine(db_url)
    Sess = sessionmaker(bind=engine)
    db: Session = Sess()

    try:
        r32 = fetch_r32_schedule()
        _log(f"Wikipedia R32: {len(r32)} partidas encontradas")

        teams = {t.code: t.id for t in db.query(Team).all()}

        created = updated = skipped = 0

        for item in r32:
            mn = item["match_number"]
            code_a = item["team_a_code"]
            code_b = item["team_b_code"]
            team_a_id = teams.get(code_a) if code_a else None
            team_b_id = teams.get(code_b) if code_b else None

            if not team_a_id or not team_b_id:
                if mn:
                    _log(f"  ⚠ Match {mn}: código desconhecido ({code_a}/{code_b})")
                skipped += 1
                continue

            # When Wikipedia uses section-link format instead of Match N, match_number is None.
            # Fall back to team-pair lookup so results still sync.
            if mn is None:
                existing = (
                    db.query(Match)
                    .filter(
                        Match.team_a_id == team_a_id,
                        Match.team_b_id == team_b_id,
                        Match.phase == MatchPhase.r32,
                    )
                    .first()
                )
                if existing is None:
                    skipped += 1
                    continue
                score = item["score"]
                if score is not None:
                    sa, sb = score
                    if existing.result is None:
                        outcome = "a" if sa > sb else ("b" if sb > sa else "draw")
                        db.add(MatchResult(
                            match_id=existing.id,
                            score_a=sa,
                            score_b=sb,
                            result=outcome,
                        ))
                        existing.status = MatchStatus.finished
                        updated += 1
                        _log(f"  ✓ Resultado {code_a} x {code_b}: {sa}–{sb}")
                    elif existing.result.score_a != sa or existing.result.score_b != sb:
                        existing.result.score_a = sa
                        existing.result.score_b = sb
                        outcome = "a" if sa > sb else ("b" if sb > sa else "draw")
                        existing.result.result = outcome
                        existing.status = MatchStatus.finished
                        updated += 1
                continue

            existing = db.query(Match).filter(Match.match_number == mn).first()

            if existing is None:
                m = Match(
                    phase=MatchPhase.r32,
                    team_a_id=team_a_id,
                    team_b_id=team_b_id,
                    match_number=mn,
                    match_date=item["match_date"],
                    venue=item["venue"],
                    city=item["city"],
                    status=MatchStatus.scheduled,
                )
                db.add(m)
                db.flush()
                existing = m
                created += 1
                _log(f"  ✓ Criado Match {mn}: {code_a} x {code_b}")
            else:
                changed = False
                if existing.team_a_id != team_a_id:
                    existing.team_a_id = team_a_id
                    changed = True
                if existing.team_b_id != team_b_id:
                    existing.team_b_id = team_b_id
                    changed = True
                if changed:
                    updated += 1

            score = item["score"]
            if score is not None:
                sa, sb = score
                if existing.result is None:
                    outcome = "a" if sa > sb else ("b" if sb > sa else "draw")
                    db.add(MatchResult(
                        match_id=existing.id,
                        score_a=sa,
                        score_b=sb,
                        result=outcome,
                    ))
                    existing.status = MatchStatus.finished
                    updated += 1
                    _log(f"  ✓ Resultado Match {mn}: {sa}–{sb}")
                elif existing.result.score_a != sa or existing.result.score_b != sb:
                    existing.result.score_a = sa
                    existing.result.score_b = sb
                    outcome = "a" if sa > sb else ("b" if sb > sa else "draw")
                    existing.result.result = outcome
                    existing.status = MatchStatus.finished
                    updated += 1

        db.commit()
        _log(f"R32 sync: {created} criadas, {updated} atualizadas, {skipped} puladas")
        return {"created": created, "updated": updated, "skipped": skipped}

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
