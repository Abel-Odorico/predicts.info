from __future__ import annotations

import re
import time
import unicodedata
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import joinedload, sessionmaker

from config import settings
from models import (
    Bet,
    Confederation,
    Match,
    MatchPhase,
    MatchResult,
    MatchStatus,
    Player,
    Ranking,
    SimulationCache,
    Team,
    TournamentSimulation,
)

LogFn = Callable[[str], None] | None

WIKI_RAW_URL = "https://en.wikipedia.org/w/index.php?title={title}&action=raw"
GROUP_LETTERS = list("ABCDEFGHIJKL")
SQUADS_TITLE = "2026_FIFA_World_Cup_squads"
GLOBAL_TEAM_COUNT = 48
DEFAULT_MARKET_VALUE = 0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    )
}

FLAG_ISO2 = {
    "ALG": "dz",
    "ARG": "ar",
    "AUS": "au",
    "AUT": "at",
    "BEL": "be",
    "BIH": "ba",
    "BRA": "br",
    "CAN": "ca",
    "CIV": "ci",
    "CMR": "cm",
    "COD": "cd",
    "COL": "co",
    "CPV": "cv",
    "CRO": "hr",
    "CUW": "cw",
    "CZE": "cz",
    "ECU": "ec",
    "EGY": "eg",
    "ENG": "gb-eng",
    "ESP": "es",
    "FRA": "fr",
    "GER": "de",
    "GHA": "gh",
    "HAI": "ht",
    "IRQ": "iq",
    "IRN": "ir",
    "JOR": "jo",
    "JPN": "jp",
    "KOR": "kr",
    "KSA": "sa",
    "MAR": "ma",
    "MEX": "mx",
    "NED": "nl",
    "NOR": "no",
    "NZL": "nz",
    "PAN": "pa",
    "PAR": "py",
    "POR": "pt",
    "QAT": "qa",
    "RSA": "za",
    "SCO": "gb-sct",
    "SEN": "sn",
    "SUI": "ch",
    "SWE": "se",
    "TUN": "tn",
    "TUR": "tr",
    "URU": "uy",
    "USA": "us",
    "UZB": "uz",
}

ELO_SLUG_ALIASES = {
    "BIH": ["Bosnia_and_Herzegovina"],
    "CIV": ["Ivory_Coast", "Cote_d_Ivoire", "Cote_d'Ivoire"],
    "COD": ["DR_Congo", "Democratic_Republic_of_the_Congo"],
    "CPV": ["Cape_Verde", "Cape_Verde_Islands"],
    "CUW": ["Curacao"],
    "CZE": ["Czechia", "Czech_Republic"],
    "ENG": ["England"],
    "HAI": ["Haiti"],
    "KOR": ["South_Korea"],
    "KSA": ["Saudi_Arabia"],
    "NZL": ["New_Zealand"],
    "RSA": ["South_Africa"],
    "SCO": ["Scotland"],
    "USA": ["United_States"],
}

CONFED_MAP = {
    "UEFA": Confederation.UEFA,
    "CONMEBOL": Confederation.CONMEBOL,
    "CONCACAF": Confederation.CONCACAF,
    "CAF": Confederation.CAF,
    "AFC": Confederation.AFC,
    "OFC": Confederation.OFC,
}


def _log(log: LogFn, message: str) -> None:
    if log:
        log(message)


def _bet_match_key(
    phase: str | None,
    group_name: str | None,
    team_a_code: str,
    team_b_code: str,
) -> tuple[str, str | None, str, str]:
    return (phase or MatchPhase.group.value, group_name, team_a_code, team_b_code)


def _score_points(score_a: int, score_b: int, result_score_a: int, result_score_b: int) -> tuple[int, bool, bool]:
    exact = score_a == result_score_a and score_b == result_score_b
    correct_result = (
        (score_a > score_b) == (result_score_a > result_score_b)
        and (score_a == score_b) == (result_score_a == result_score_b)
    )
    points = 3 if exact else (1 if correct_result else 0)
    return points, exact, correct_result


def _clean_links(text: str) -> str:
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<ref[^/]*/>", "", text)
    text = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", text)
    text = text.replace("'''", "").replace("''", "")
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _normalize_best_result(raw: str, appearances: int) -> str:
    text = _clean_links(raw)
    if "Winner" in text:
        return "Champion"
    if "Runner-up" in text or "Runners-up" in text or "Second place" in text:
        return "Runner-up"
    if "Third place" in text:
        return "Third"
    if "Quarter-finals" in text or "Quarterfinals" in text or "Quarter-finals" in text:
        return "Quarter-final"
    if "Round of 16" in text or "Second round" in text:
        return "Round of 16"
    if "Group stage" in text:
        return "Groups"
    if appearances <= 1 or text in {"—", "-", ""}:
        return "Never qualified"
    return "Groups"


def _slugify_team_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", normalized)
    return normalized.strip("_")


def _elo_slug_candidates(code: str, name: str) -> list[str]:
    candidates = []
    for alias in ELO_SLUG_ALIASES.get(code, []):
        if alias not in candidates:
            candidates.append(alias)
    default = _slugify_team_name(name)
    if default and default not in candidates:
        candidates.append(default)
    return candidates


def _flag_url(code: str) -> str | None:
    iso2 = FLAG_ISO2.get(code)
    if not iso2:
        return None
    return f"https://flagcdn.com/w80/{iso2}.png"


def _fetch_raw_page(client: httpx.Client, title: str) -> str:
    response = client.get(WIKI_RAW_URL.format(title=title), timeout=30)
    response.raise_for_status()
    return response.text


def _parse_confederation(row: str) -> Confederation:
    match = re.search(r"\[\[(?:[^|\]]+\|)?(UEFA|CONMEBOL|CONCACAF|CAF|AFC|OFC)\]\]", row)
    if not match:
        raise ValueError(f"Unable to parse confederation from row: {row[:140]}")
    return CONFED_MAP[match.group(1)]


def _parse_local_datetime(block: str) -> datetime | None:
    date_match = re.search(r"\|date=\{\{Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})\}\}", block)
    if not date_match:
        return None

    year, month, day = map(int, date_match.groups())
    time_match = re.search(
        r"\|time=(\d{1,2}):(\d{2})&nbsp;(a\.m\.|p\.m\.).*?UTC[−-](\d{1,2})",
        block,
        flags=re.S,
    )
    if not time_match:
        return datetime(year, month, day)

    hour = int(time_match.group(1))
    minute = int(time_match.group(2))
    meridiem = time_match.group(3)
    offset_hours = int(time_match.group(4))

    if meridiem == "p.m." and hour != 12:
        hour += 12
    if meridiem == "a.m." and hour == 12:
        hour = 0

    tzinfo = timezone(-timedelta(hours=offset_hours))
    localized = datetime(year, month, day, hour, minute, tzinfo=tzinfo)
    return localized.astimezone(timezone.utc).replace(tzinfo=None)


def _parse_group_page(client: httpx.Client, group: str) -> tuple[list[dict], list[dict]]:
    title = f"2026_FIFA_World_Cup_Group_{group}"
    text = _fetch_raw_page(client, title)

    intro = re.search(r"The group consists of (.+?)\. The top two teams", text, flags=re.S)
    if not intro:
        raise ValueError(f"Could not parse intro for Group {group}")
    team_names = re.findall(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", intro.group(1))

    table_match = re.search(r"==Teams==\n(.*?)\n'''Notes'''", text, flags=re.S)
    if not table_match:
        raise ValueError(f"Could not parse Teams table for Group {group}")

    row_pattern = re.compile(rf"^\|\s*{group}\d\s*\|\|.*?(?=\n\|-\n|\n\|\}})", flags=re.M | re.S)
    rows = row_pattern.findall(table_match.group(1))
    if len(rows) != 4 or len(team_names) != 4:
        raise ValueError(f"Unexpected team count in Group {group}: rows={len(rows)} names={len(team_names)}")

    teams = []
    for idx, row in enumerate(rows):
        parts = [part.strip() for part in row.split("||")]
        if len(parts) < 9:
            raise ValueError(f"Could not parse row for Group {group}: {row[:160]}")

        code_match = re.search(r"\{\{#invoke:flag\|fb\|([A-Z]{3})\}\}", parts[1])
        appearances_match = re.search(r"(\d+)(?:st|nd|rd|th)", parts[6])
        if not code_match or not appearances_match:
            raise ValueError(f"Could not parse row for Group {group}: {row[:160]}")

        code = code_match.group(1)
        appearances = int(appearances_match.group(1))
        best_raw = re.sub(r'^data-sort-value="[^"]+"\s*\|\s*', "", parts[8]).strip()

        teams.append(
            {
                "group_name": group,
                "code": code,
                "name": team_names[idx],
                "confederation": _parse_confederation(parts[3]),
                "flag_url": _flag_url(code),
                "world_cup_appearances": appearances,
                "best_wc_result": _normalize_best_result(best_raw, appearances),
            }
        )

    match_pattern = re.compile(
        rf'<section begin="?({group}\d)"? />\{{\{{#invoke:football box\|main(.*?)\}}\}}<section end="?\1"? />',
        flags=re.S,
    )
    matches = []
    for section, block in match_pattern.findall(text):
        team_a_match = re.search(r"\|team1=\{\{#invoke:flag\|fb(?:-rt)?\|([A-Z]{3})\}\}", block)
        team_b_match = re.search(r"\|team2=\{\{#invoke:flag\|fb(?:-rt)?\|([A-Z]{3})\}\}", block)
        stadium_match = re.search(r"\|stadium=(.+)", block)
        score_match = re.search(r"\|score=\{\{score link\|[^|]+\|(\d+)–(\d+)\}\}", block)

        if not team_a_match or not team_b_match:
            raise ValueError(f"Could not parse fixture block {group}/{section}")

        stadium_value = _clean_links(stadium_match.group(1)) if stadium_match else ""
        venue, city = stadium_value, None
        if "," in stadium_value:
            venue, city = stadium_value.rsplit(",", 1)
            venue = venue.strip()
            city = city.strip()

        score_a = int(score_match.group(1)) if score_match else None
        score_b = int(score_match.group(2)) if score_match else None

        matches.append(
            {
                "section": section,
                "group_name": group,
                "match_date": _parse_local_datetime(block),
                "team_a_code": team_a_match.group(1),
                "team_b_code": team_b_match.group(1),
                "venue": venue or None,
                "city": city or None,
                "score_a": score_a,
                "score_b": score_b,
            }
        )

    return teams, matches


def _parse_player_name(line: str) -> str:
    linked = re.search(r"\|name=\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", line)
    if linked:
        return _clean_links(linked.group(1))
    plain = re.search(r"\|name=([^|]+)", line)
    if not plain:
        raise ValueError(f"Could not parse player name: {line[:120]}")
    return _clean_links(plain.group(1))


def _parse_player_age(line: str) -> float | None:
    match = re.search(
        r"birth date and age2\|\d{4}\|\d{1,2}\|\d{1,2}\|(\d{4})\|(\d{1,2})\|(\d{1,2})",
        line,
    )
    if not match:
        return None
    year, month, day = map(int, match.groups())
    birth = datetime(year, month, day)
    ref = datetime(2026, 6, 11)
    return round((ref - birth).days / 365.25, 1)


def _parse_squads(client: httpx.Client, teams_by_name: dict[str, dict]) -> dict[str, list[dict]]:
    text = _fetch_raw_page(client, SQUADS_TITLE)
    squads: dict[str, list[dict]] = {team["code"]: [] for team in teams_by_name.values()}
    ages: dict[str, list[float]] = {team["code"]: [] for team in teams_by_name.values()}

    group_blocks = re.finditer(
        r"^==Group ([A-L])==\n(.*?)(?=^==Group [A-L]==|\Z)",
        text,
        flags=re.M | re.S,
    )
    for group_match in group_blocks:
        block = group_match.group(2)
        team_sections = re.finditer(
            r"^===([^=]+)===\n(.*?)(?=^===|^==Group [A-L]==|\Z)",
            block,
            flags=re.M | re.S,
        )
        for section in team_sections:
            team_name = _clean_links(section.group(1))
            if team_name not in teams_by_name:
                continue
            team_code = teams_by_name[team_name]["code"]
            players = re.findall(r"^\{\{nat fs g player\|(.*?)\}\}$", section.group(2), flags=re.M)
            for player_fields in players:
                line = f"{{{{nat fs g player|{player_fields}}}}}"
                age = _parse_player_age(line)
                if age is not None:
                    ages[team_code].append(age)
                position_match = re.search(r"\|pos=([A-Z]+)", line)
                squads[team_code].append(
                    {
                        "name": _parse_player_name(line),
                        "position": position_match.group(1) if position_match else None,
                        "market_value_eur": 0,
                        "impact_weight": 0.010,
                    }
                )

    for team_name, team in teams_by_name.items():
        age_list = ages.get(team["code"], [])
        if age_list:
            team["avg_age"] = round(sum(age_list) / len(age_list), 1)

    return squads


def fetch_world_cup_snapshot(log: LogFn = None) -> dict:
    teams: list[dict] = []
    matches: list[dict] = []
    with httpx.Client(headers=HEADERS, follow_redirects=True) as client:
        for group in GROUP_LETTERS:
            group_teams, group_matches = _parse_group_page(client, group)
            teams.extend(group_teams)
            matches.extend(group_matches)
            _log(log, f"✓ Grupo {group}: {len(group_teams)} seleções, {len(group_matches)} jogos")

        teams_by_name = {team["name"]: team for team in teams}
        squads = _parse_squads(client, teams_by_name)
        player_total = sum(len(players) for players in squads.values())
        _log(log, f"✓ Convocados importados: {player_total} jogadores")

    return {"teams": teams, "matches": matches, "squads": squads}


def apply_world_cup_snapshot(db_url: str, snapshot: dict, log: LogFn = None) -> dict:
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)

    with Session() as db:
        legacy_teams = {
            team.code: {
                "market_value_eur": team.market_value_eur,
                "elo_rating": float(team.elo_rating),
                "avg_goals_for": float(team.avg_goals_for),
                "avg_goals_against": float(team.avg_goals_against),
                "xg_for": float(team.xg_for),
                "xg_against": float(team.xg_against),
                "form_5": float(team.form_5),
                "form_10": float(team.form_10),
                "form_20": float(team.form_20),
            }
            for team in db.query(Team).all()
        }

        # Build lookup of existing matches by stable key — used for upsert.
        # Bets reference match_id, so updating matches in-place keeps bets valid.
        existing_matches_by_key: dict[tuple, Match] = {}
        for m in db.query(Match).options(
            joinedload(Match.team_a), joinedload(Match.team_b)
        ).all():
            if m.team_a and m.team_b:
                key = _bet_match_key(
                    m.phase.value if m.phase else None,
                    m.group_name,
                    m.team_a.code,
                    m.team_b.code,
                )
                existing_matches_by_key[key] = m

        # Safe deletes: cache, simulations, results (NOT bets, NOT matches, NOT ranking)
        db.query(SimulationCache).delete()
        db.query(TournamentSimulation).delete()
        db.query(MatchResult).delete()
        db.query(Player).delete()

        current_codes = {team["code"] for team in snapshot["teams"]}
        for stale in db.query(Team).filter(~Team.code.in_(current_codes)).all():
            db.delete(stale)
        db.flush()

        team_by_code: dict[str, Team] = {}
        for team_data in snapshot["teams"]:
            existing = db.query(Team).filter(Team.code == team_data["code"]).first()
            legacy = legacy_teams.get(team_data["code"], {})
            team = existing or Team(
                code=team_data["code"],
                elo_rating=legacy.get("elo_rating", 1500.0),
                market_value_eur=legacy.get("market_value_eur", DEFAULT_MARKET_VALUE),
                avg_goals_for=legacy.get("avg_goals_for", 1.35),
                avg_goals_against=legacy.get("avg_goals_against", 1.35),
                xg_for=legacy.get("xg_for", 1.35),
                xg_against=legacy.get("xg_against", 1.35),
                form_5=legacy.get("form_5", 0.5),
                form_10=legacy.get("form_10", 0.5),
                form_20=legacy.get("form_20", 0.5),
            )
            team.name = team_data["name"]
            team.confederation = team_data["confederation"]
            team.group_name = team_data["group_name"]
            team.flag_url = team_data["flag_url"]
            team.avg_age = team_data.get("avg_age") or 26.0
            team.world_cup_appearances = team_data["world_cup_appearances"]
            team.best_wc_result = team_data["best_wc_result"]
            if not existing:
                db.add(team)
            team_by_code[team.code] = team

        db.flush()

        player_count = 0
        for code, squad in snapshot["squads"].items():
            team = team_by_code[code]
            for player_data in squad:
                db.add(
                    Player(
                        team_id=team.id,
                        name=player_data["name"],
                        position=player_data["position"],
                        market_value_eur=player_data["market_value_eur"],
                        impact_weight=player_data["impact_weight"],
                    )
                )
                player_count += 1

        db.flush()

        match_rows = sorted(
            snapshot["matches"],
            key=lambda item: (
                item["match_date"] or datetime.max,
                item["group_name"],
                item["section"],
            ),
        )

        finished_count = 0
        new_matches = 0
        result_by_match_id: dict[int, tuple[int, int]] = {}

        for match_number, item in enumerate(match_rows, start=1):
            key = _bet_match_key(
                MatchPhase.group.value,
                item["group_name"],
                item["team_a_code"],
                item["team_b_code"],
            )
            new_status = MatchStatus.finished if item["score_a"] is not None else MatchStatus.scheduled
            existing = existing_matches_by_key.get(key)

            if existing:
                # Update in place — match.id stays the same, bets remain valid
                existing.match_date = item["match_date"]
                existing.venue = item["venue"]
                existing.city = item["city"]
                existing.status = new_status
                existing.match_number = match_number
                match = existing
            else:
                match = Match(
                    phase=MatchPhase.group,
                    team_a_id=team_by_code[item["team_a_code"]].id,
                    team_b_id=team_by_code[item["team_b_code"]].id,
                    group_name=item["group_name"],
                    match_date=item["match_date"],
                    venue=item["venue"],
                    city=item["city"],
                    is_neutral=True,
                    status=new_status,
                    match_number=match_number,
                )
                db.add(match)
                db.flush()
                new_matches += 1

            if item["score_a"] is not None and item["score_b"] is not None:
                result_by_match_id[match.id] = (item["score_a"], item["score_b"])
                db.add(
                    MatchResult(
                        match_id=match.id,
                        score_a=item["score_a"],
                        score_b=item["score_b"],
                        result=(
                            "a"
                            if item["score_a"] > item["score_b"]
                            else ("b" if item["score_b"] > item["score_a"] else "draw")
                        ),
                    )
                )
                finished_count += 1

        db.flush()

        # Re-evaluate all existing bets against updated results.
        # Rebuild ranking from scratch based on current bets.
        db.query(Ranking).delete()
        db.flush()

        ranking_totals: dict[int, dict[str, int]] = {}
        evaluated_count = 0
        for bet in db.query(Bet).all():
            result_scores = result_by_match_id.get(bet.match_id)
            if result_scores is not None:
                points, exact, correct_result = _score_points(
                    bet.score_a, bet.score_b, result_scores[0], result_scores[1]
                )
                bet.points_earned = points
                bet.evaluated_at = datetime.utcnow()
                evaluated_count += 1
                stats = ranking_totals.setdefault(
                    bet.user_id,
                    {"total_points": 0, "exact_scores": 0, "correct_results": 0},
                )
                stats["total_points"] += points
                if exact:
                    stats["exact_scores"] += 1
                elif correct_result:
                    stats["correct_results"] += 1
            else:
                # Match not yet played — keep bet but clear stale evaluation
                bet.points_earned = 0
                bet.evaluated_at = None

        for user_id, stats in ranking_totals.items():
            db.add(
                Ranking(
                    user_id=user_id,
                    total_points=stats["total_points"],
                    exact_scores=stats["exact_scores"],
                    correct_results=stats["correct_results"],
                )
            )

        db.commit()

    _log(
        log,
        f"✓ Copa real aplicada: {len(snapshot['teams'])} seleções, {len(match_rows)} jogos, {player_count} convocados",
    )
    _log(log, f"✓ Apostas avaliadas: {evaluated_count} (bets nunca apagadas)")
    if new_matches:
        _log(log, f"✓ Novas partidas criadas: {new_matches}")
    return {
        "teams": len(snapshot["teams"]),
        "matches": len(match_rows),
        "players": player_count,
        "finished_matches": finished_count,
        "new_matches": new_matches,
        "evaluated_bets": evaluated_count,
    }


def _fetch_tsv_rows(client: httpx.Client, slug: str) -> list[list[str]] | None:
    response = client.get(f"https://www.eloratings.net/{slug}.tsv", timeout=20)
    if response.status_code != 200:
        return None
    rows = []
    for line in response.text.strip().splitlines():
        cols = line.split("\t")
        if len(cols) >= 12:
            rows.append(cols)
    return rows or None


def _infer_elo_code(rows: list[list[str]]) -> str | None:
    counts: Counter[str] = Counter()
    for cols in rows:
        if len(cols) < 7:
            continue
        counts[cols[3].strip()] += 1
        counts[cols[4].strip()] += 1
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def _parse_elo_stats(rows: list[list[str]], elo_code: str, n: int = 20) -> dict | None:
    matches = []
    for cols in rows:
        try:
            home = cols[3].strip()
            away = cols[4].strip()
            hg = int(cols[5])
            ag = int(cols[6])
        except (ValueError, IndexError):
            continue

        if home == elo_code:
            gf, ga, elo_idx = hg, ag, 10
        elif away == elo_code:
            gf, ga, elo_idx = ag, hg, 11
        else:
            continue

        try:
            elo_after = float(cols[elo_idx])
        except (ValueError, IndexError):
            elo_after = None

        result = 1.0 if gf > ga else (0.5 if gf == ga else 0.0)
        matches.append({"gf": gf, "ga": ga, "result": result, "elo_after": elo_after})

    if not matches:
        return None

    elo_current = next((m["elo_after"] for m in reversed(matches) if m["elo_after"] is not None), None)
    if elo_current is None:
        return None

    recent = matches[-n:]
    recent_5 = matches[-5:]
    recent_10 = matches[-10:]

    def avg(subset: list[dict], key: str) -> float:
        return round(sum(m[key] for m in subset) / len(subset), 4) if subset else 1.35

    def form(subset: list[dict]) -> float:
        return round(sum(m["result"] for m in subset) / len(subset), 4) if subset else 0.5

    return {
        "elo_rating": elo_current,
        "avg_goals_for": avg(recent, "gf"),
        "avg_goals_against": avg(recent, "ga"),
        "xg_for": avg(recent, "gf"),
        "xg_against": avg(recent, "ga"),
        "form_5": form(recent_5),
        "form_10": form(recent_10),
        "form_20": form(recent),
    }


def sync_team_stats(db_url: str, log: LogFn = None) -> dict:
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)

    updated = 0
    errors: list[str] = []
    with Session() as db, httpx.Client(headers=HEADERS, follow_redirects=True) as client:
        teams = db.query(Team).order_by(Team.code).all()
        for index, team in enumerate(teams, start=1):
            stats = None
            for slug in _elo_slug_candidates(team.code, team.name):
                rows = _fetch_tsv_rows(client, slug)
                if not rows:
                    continue
                elo_code = _infer_elo_code(rows)
                if not elo_code:
                    continue
                stats = _parse_elo_stats(rows, elo_code)
                if stats:
                    break

            if not stats:
                errors.append(team.code)
                _log(log, f"✗ {team.code} sem estatísticas do EloRatings")
                continue

            team.elo_rating = stats["elo_rating"]
            team.avg_goals_for = stats["avg_goals_for"]
            team.avg_goals_against = stats["avg_goals_against"]
            team.xg_for = stats["xg_for"]
            team.xg_against = stats["xg_against"]
            team.form_5 = stats["form_5"]
            team.form_10 = stats["form_10"]
            team.form_20 = stats["form_20"]
            updated += 1
            _log(
                log,
                (
                    f"✓ {team.code} Elo={stats['elo_rating']:.0f} "
                    f"GF={stats['avg_goals_for']:.2f} "
                    f"GA={stats['avg_goals_against']:.2f}"
                ),
            )
            if index < len(teams):
                time.sleep(0.20)

        db.commit()

    return {"updated": updated, "errors": errors}


def invalidate_simulation_cache(log: LogFn = None) -> int:
    cleared = 0
    try:
        import redis as redis_lib

        redis_conn = redis_lib.from_url(settings.redis_url, decode_responses=True)
        for key in list(redis_conn.scan_iter("tournament:*")) + list(redis_conn.scan_iter("sim:*")):
            redis_conn.delete(key)
            cleared += 1
    except Exception as exc:
        _log(log, f"✗ Redis: {exc}")
        return 0

    if cleared:
        _log(log, f"✓ Cache invalidado: {cleared} chaves")
    return cleared
