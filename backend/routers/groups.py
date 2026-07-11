from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import Match, MatchPhase, Team

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("")
def list_groups(db: Session = Depends(get_db)):
    teams = db.query(Team).filter(Team.group_name.isnot(None)).order_by(Team.group_name, Team.name).all()
    from competitions import get_competition_id
    matches = db.query(Match).filter(
        Match.phase == MatchPhase.group, Match.competition_id == get_competition_id(db)
    ).all()

    group_rows: dict[str, list] = defaultdict(list)
    stats_by_team: dict[int, dict] = {}
    for team in teams:
        stats = {
            "id": team.id,
            "code": team.code,
            "name": team.name,
            "elo_rating": float(team.elo_rating),
            "flag_url": team.flag_url,
            "confederation": team.confederation.value if hasattr(team.confederation, "value") else str(team.confederation),
            "points": 0,
            "played": 0,
            "wins": 0,
            "draws": 0,
            "losses": 0,
            "gf": 0,
            "ga": 0,
            "gd": 0,
        }
        stats_by_team[team.id] = stats
        group_rows[team.group_name].append(stats)

    for match in matches:
        result = match.result
        if not result:
            continue
        team_a = stats_by_team.get(match.team_a_id)
        team_b = stats_by_team.get(match.team_b_id)
        if not team_a or not team_b:
            continue

        team_a["played"] += 1
        team_b["played"] += 1
        team_a["gf"] += result.score_a
        team_a["ga"] += result.score_b
        team_b["gf"] += result.score_b
        team_b["ga"] += result.score_a

        if result.score_a > result.score_b:
            team_a["wins"] += 1
            team_a["points"] += 3
            team_b["losses"] += 1
        elif result.score_b > result.score_a:
            team_b["wins"] += 1
            team_b["points"] += 3
            team_a["losses"] += 1
        else:
            team_a["draws"] += 1
            team_b["draws"] += 1
            team_a["points"] += 1
            team_b["points"] += 1

    for group_name, rows in group_rows.items():
        for row in rows:
            row["gd"] = row["gf"] - row["ga"]
        rows.sort(
            key=lambda item: (
                -item["points"],
                -item["gd"],
                -item["gf"],
                -item["elo_rating"],
                item["name"],
            )
        )
        for index, row in enumerate(rows, start=1):
            row["position"] = index

    return {"groups": dict(sorted(group_rows.items()))}
