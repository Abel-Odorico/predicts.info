"""Leitura cacheada de team_head_to_head (sem chamada a LLM).

Busca via IA fica em projections.py — aqui é só cache-read, usado no motor de
simulação (toda chamada de /matches/{id}/simulate) onde latência de LLM não é
aceitável. Se não houver linha cacheada pro par, retorna None (peso h2h fica
neutro no engine).
"""
import json
from sqlalchemy.orm import Session
from models import TeamHeadToHead


def get_h2h_cached(db: Session, code_a: str, code_b: str) -> dict | None:
    row = (
        db.query(TeamHeadToHead)
        .filter(
            ((TeamHeadToHead.team_a_code == code_a) & (TeamHeadToHead.team_b_code == code_b))
            | ((TeamHeadToHead.team_a_code == code_b) & (TeamHeadToHead.team_b_code == code_a))
        )
        .first()
    )
    if not row or not row.total_matches:
        return None

    wins_a, wins_b = row.wins_a, row.wins_b
    if row.team_a_code == code_b:
        wins_a, wins_b = wins_b, wins_a

    try:
        recent_results = json.loads(row.recent_results) if row.recent_results else []
    except (ValueError, TypeError):
        recent_results = []

    return {
        "wins_a": wins_a,
        "wins_b": wins_b,
        "draws": row.draws,
        "total": row.total_matches,
        "summary": row.summary,
        "recent_results": recent_results,
    }
