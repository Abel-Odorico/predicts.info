#!/usr/bin/env python3
"""Migrate old r32 orphan matches to new canonical ones."""
import sys
from database import engine
from sqlalchemy import text

OLD = "o.match_number > 1000 AND o.phase = 'r32'::matchphase"
NEW = "n.match_number <= 200 AND n.phase = 'r32'::matchphase"

sql_bets_dup = f"""
DELETE FROM bets
WHERE id IN (
  SELECT b.id FROM bets b
  JOIN (
    SELECT o.id AS old_id, n.id AS new_id
    FROM matches o
    JOIN matches n ON n.team_a_id = o.team_a_id
                  AND n.team_b_id = o.team_b_id
                  AND {NEW}
    WHERE {OLD}
  ) mapping ON b.match_id = mapping.old_id
  JOIN bets b2 ON b2.match_id = mapping.new_id AND b2.user_id = b.user_id
)
"""

sql_bets_remap = f"""
UPDATE bets SET match_id = mapping.new_id
FROM (
  SELECT o.id AS old_id, n.id AS new_id
  FROM matches o
  JOIN matches n ON n.team_a_id = o.team_a_id
                AND n.team_b_id = o.team_b_id
                AND {NEW}
  WHERE {OLD}
) mapping
WHERE bets.match_id = mapping.old_id
"""

sql_sim_cache = """
DELETE FROM simulations_cache
WHERE match_id IN (
  SELECT id FROM matches WHERE match_number > 1000 AND phase = 'r32'::matchphase
)
"""

sql_del_matches = "DELETE FROM matches WHERE match_number > 1000 AND phase = 'r32'::matchphase"

with engine.begin() as conn:
    r = conn.execute(text(sql_bets_dup))
    print(f"Step 1 — bets duplicadas deletadas: {r.rowcount}", flush=True)

    r = conn.execute(text(sql_bets_remap))
    print(f"Step 2 — bets remapeadas: {r.rowcount}", flush=True)

    r = conn.execute(text(sql_sim_cache))
    print(f"Step 3 — simulations_cache limpo: {r.rowcount}", flush=True)

    r = conn.execute(text(sql_del_matches))
    print(f"Step 4 — matches antigos deletados: {r.rowcount}", flush=True)

print("Commit OK", flush=True)

with engine.connect() as conn:
    r = conn.execute(text("SELECT count(*) FROM matches WHERE phase = 'r32'::matchphase"))
    print(f"Matches r32 finais: {r.scalar()}", flush=True)
    r = conn.execute(text("SELECT count(*) FROM bets"))
    print(f"Total bets: {r.scalar()}", flush=True)
