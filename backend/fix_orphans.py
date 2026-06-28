from database import engine
from sqlalchemy import text

OLD = "o.match_number > 1000 AND o.phase = 'r32'::matchphase"
NEW  = "n.match_number <= 200 AND n.phase = 'r32'::matchphase"

with engine.begin() as c:
    r = c.execute(text(f"""
        DELETE FROM bets WHERE id IN (
          SELECT b.id FROM bets b
          JOIN (SELECT o.id AS old_id, n.id AS new_id FROM matches o
                JOIN matches n ON n.team_a_id = o.team_a_id AND n.team_b_id = o.team_b_id AND {NEW}
                WHERE {OLD}) mapping ON b.match_id = mapping.old_id
          JOIN bets b2 ON b2.match_id = mapping.new_id AND b2.user_id = b.user_id)
    """))
    print("bets dup deletadas:", r.rowcount)

    r = c.execute(text(f"""
        UPDATE bets SET match_id = mapping.new_id
        FROM (SELECT o.id AS old_id, n.id AS new_id FROM matches o
              JOIN matches n ON n.team_a_id = o.team_a_id AND n.team_b_id = o.team_b_id AND {NEW}
              WHERE {OLD}) mapping
        WHERE bets.match_id = mapping.old_id
    """))
    print("bets remapeadas:", r.rowcount)

    r = c.execute(text("DELETE FROM simulations_cache WHERE match_id IN (SELECT id FROM matches WHERE match_number > 1000 AND phase='r32'::matchphase)"))
    print("sim cache:", r.rowcount)

    r = c.execute(text("DELETE FROM matches WHERE match_number > 1000 AND phase='r32'::matchphase"))
    print("matches deletados:", r.rowcount)

with engine.connect() as c:
    print("R32 final:", c.execute(text("SELECT count(*) FROM matches WHERE phase='r32'::matchphase")).scalar())
