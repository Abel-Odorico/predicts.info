"""
Monte Carlo match and tournament simulation — fully vectorized with NumPy.
  simulate_match:      1M sims  ~200ms
  simulate_tournament: 100k sims ~8-15s (48 teams, 12 groups, 5 knockout rounds)
"""

import numpy as np
from itertools import combinations

from engine.poisson import dc_score_weights, pick_recommended_score

GLOBAL_AVG = 1.35


def simulate_match(
    lambda_a: float,
    lambda_b: float,
    n: int = 1_000_000,
    seed: int | None = None,
) -> dict:
    rng = np.random.default_rng(seed)

    # Dixon-Coles weighted sampling: corrects low-score joint probabilities
    sa, sb, weights = dc_score_weights(lambda_a, lambda_b)
    idx = rng.choice(len(weights), size=n, p=weights)
    goals_a = sa[idx]
    goals_b = sb[idx]

    prob_a = float((goals_a > goals_b).mean())
    prob_draw = float((goals_a == goals_b).mean())
    prob_b = float((goals_b > goals_a).mean())

    max_g = 8
    scores: dict[str, float] = {}
    for ga in range(max_g + 1):
        for gb in range(max_g + 1):
            p = float(((goals_a == ga) & (goals_b == gb)).mean())
            if p >= 0.0005:
                scores[f"{ga}x{gb}"] = round(p * 100, 3)

    top_scores = sorted(scores.items(), key=lambda x: -x[1])[:20]
    top_scores_list = [{"score": s, "prob": p} for s, p in top_scores]
    recommended_score = pick_recommended_score(
        top_scores_list, prob_a * 100, prob_draw * 100, prob_b * 100
    )

    return {
        "prob_a": round(prob_a * 100, 2),
        "prob_draw": round(prob_draw * 100, 2),
        "prob_b": round(prob_b * 100, 2),
        "lambda_a": round(lambda_a, 4),
        "lambda_b": round(lambda_b, 4),
        "top_scores": top_scores_list,
        "recommended_score": recommended_score,
        "simulations": n,
    }


def _elo_attack_defense(team: dict) -> tuple[float, float]:
    """
    Convert team stats to (attack, defense) Elo-adjusted strengths.
    attack: expected goals scored against average team
    defense: expected goals conceded against average team
    """
    elo_factor = team["elo_rating"] / 1750.0
    attack = float(team["avg_goals_for"]) * elo_factor
    defense = float(team["avg_goals_against"]) / elo_factor
    return max(0.4, attack), max(0.4, defense)


def _match_lambdas(ta: dict, tb: dict) -> tuple[float, float]:
    att_a, def_a = _elo_attack_defense(ta)
    att_b, def_b = _elo_attack_defense(tb)
    la = att_a * def_b / GLOBAL_AVG
    lb = att_b * def_a / GLOBAL_AVG
    return float(np.clip(la, 0.30, 5.0)), float(np.clip(lb, 0.30, 5.0))


_DC_RHO = -0.13


def _dc_thin_knockout(
    ga: np.ndarray,
    gb: np.ndarray,
    la: np.ndarray,
    lb: np.ndarray,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Vectorized Dixon-Coles thinning for knockout rounds.
    1-0 and 0-1 outcomes are overrepresented by Poisson (τ < 1 with ρ < 0).
    Rejected samples are converted to draws (→ penalty shootout).
    0-0 and 1-1 upsampling is omitted (small effect, can't add samples mid-array).
    """
    n = len(ga)
    # τ for 1-0: 1 + lb*ρ  (< 1 since ρ < 0)
    # τ for 0-1: 1 + la*ρ  (< 1 since ρ < 0)
    tau_10 = np.clip(1.0 + lb * _DC_RHO, 0.0, 1.0)
    tau_01 = np.clip(1.0 + la * _DC_RHO, 0.0, 1.0)

    mask_10 = (ga == 1) & (gb == 0)
    mask_01 = (ga == 0) & (gb == 1)

    rand = rng.random(n)
    reject_10 = mask_10 & (rand > tau_10)
    reject_01 = mask_01 & (rand > tau_01)
    reassign  = reject_10 | reject_01

    # Convert to 0-0 draw (exact score irrelevant in knockout — only draw matters)
    ga = np.where(reassign, 0, ga)
    gb = np.where(reassign, 0, gb)
    return ga, gb


def _knockout_round(
    bracket: np.ndarray,           # (n, 2k) team IDs
    attack: np.ndarray,            # (max_id,) attack indexed by team_id
    defense: np.ndarray,           # (max_id,) defense indexed by team_id
    rng: np.random.Generator,
    n: int,
) -> np.ndarray:                   # (n, k) winner team IDs
    num_matches = bracket.shape[1] // 2
    winners = np.empty((n, num_matches), dtype=np.int32)

    for m in range(num_matches):
        ta_ids = bracket[:, m * 2]
        tb_ids = bracket[:, m * 2 + 1]

        la = np.clip(attack[ta_ids] * defense[tb_ids] / GLOBAL_AVG, 0.30, 5.0)
        lb = np.clip(attack[tb_ids] * defense[ta_ids] / GLOBAL_AVG, 0.30, 5.0)

        # variable-lambda poisson: rng.poisson accepts array lam
        ga = rng.poisson(la)
        gb = rng.poisson(lb)

        # Dixon-Coles thinning: 1-0 and 0-1 are overrepresented in Poisson (τ < 1)
        # Reject fraction and convert to draws → more penalty shootouts
        ga, gb = _dc_thin_knockout(ga, gb, la, lb, rng)

        draw = ga == gb
        penalty_a = rng.random(n) > 0.5
        a_wins = (ga > gb) | (draw & penalty_a)
        winners[:, m] = np.where(a_wins, ta_ids, tb_ids)

    return winners


def simulate_tournament(
    teams: list[dict],
    groups: dict[str, list[int]],
    played_matches: list[dict] | None = None,
    n: int = 100_000,
    seed: int | None = None,
) -> dict[int, dict]:
    """
    Simulate the full Copa do Mundo 2026.
    teams:  [{id, code, name, elo_rating, avg_goals_for, avg_goals_against}]
    groups: {"A": [team_id, ...], ...}  12 groups × 4 teams
    played_matches: [{"group_name", "team_a_id", "team_b_id", "score_a", "score_b"}]
    Returns: {team_id: {code, name, prob_groups, prob_r32, ..., prob_title}}
    """
    rng = np.random.default_rng(seed)

    team_by_id = {t["id"]: t for t in teams}
    all_ids = [t["id"] for t in teams]
    n_teams = len(all_ids)
    max_id = max(all_ids) + 1

    # Map team_id → 0-based index for counting arrays
    id_to_idx = np.full(max_id, -1, dtype=np.int32)
    for i, tid in enumerate(all_ids):
        id_to_idx[tid] = i

    # attack[team_id], defense[team_id] — indexed directly by team_id
    attack_by_id = np.zeros(max_id, dtype=np.float64)
    defense_by_id = np.zeros(max_id, dtype=np.float64)
    for t in teams:
        att, dfs = _elo_attack_defense(t)
        attack_by_id[t["id"]] = att
        defense_by_id[t["id"]] = dfs

    # --- GROUP STAGE -------------------------------------------------------
    group_list = list(groups.items())   # [("A", [id,id,id,id]), ...]
    n_groups = len(group_list)          # 12

    group_ids_arr = np.array([gids for _, gids in group_list], dtype=np.int32)  # (12, 4)

    played_lookup = {}
    for match in played_matches or []:
        key = (
            match["group_name"],
            frozenset((match["team_a_id"], match["team_b_id"])),
        )
        played_lookup[key] = match

    # Build unplayed group matches; fixed results are injected below.
    gm_la, gm_lb, gm_g, gm_li, gm_lj = [], [], [], [], []
    fixed_results = []
    for g_idx, (_, g_ids) in enumerate(group_list):
        for li, lj in combinations(range(4), 2):
            ta_id = g_ids[li]
            tb_id = g_ids[lj]
            played = played_lookup.get((group_list[g_idx][0], frozenset((ta_id, tb_id))))
            if played:
                ga = played["score_a"] if played["team_a_id"] == ta_id else played["score_b"]
                gb = played["score_b"] if played["team_a_id"] == ta_id else played["score_a"]
                fixed_results.append((g_idx, li, lj, ga, gb))
                continue
            la, lb = _match_lambdas(team_by_id[ta_id], team_by_id[tb_id])
            gm_la.append(la)
            gm_lb.append(lb)
            gm_g.append(g_idx)
            gm_li.append(li)
            gm_lj.append(lj)

    # Accumulate points and goal difference: (n, n_groups, 4)
    pts = np.zeros((n, n_groups, 4), dtype=np.int32)
    gd  = np.zeros((n, n_groups, 4), dtype=np.int32)

    for g, li, lj, ga_fixed, gb_fixed in fixed_results:
        a_pts = 3 if ga_fixed > gb_fixed else (1 if ga_fixed == gb_fixed else 0)
        b_pts = 3 if gb_fixed > ga_fixed else (1 if ga_fixed == gb_fixed else 0)
        pts[:, g, li] += a_pts
        pts[:, g, lj] += b_pts
        diff = ga_fixed - gb_fixed
        gd[:, g, li] += diff
        gd[:, g, lj] -= diff

    n_gm = len(gm_la)
    if n_gm:
        la_arr = np.array(gm_la)
        lb_arr = np.array(gm_lb)
        gm_g = np.array(gm_g, dtype=np.int32)
        gm_li = np.array(gm_li, dtype=np.int32)
        gm_lj = np.array(gm_lj, dtype=np.int32)

        # Dixon-Coles corrected sampling per group match (exact scores matter for GD)
        goals_a = np.empty((n, n_gm), dtype=np.int32)
        goals_b = np.empty((n, n_gm), dtype=np.int32)
        for m in range(n_gm):
            sa, sb, wt = dc_score_weights(float(la_arr[m]), float(lb_arr[m]))
            idx = rng.choice(len(wt), size=n, p=wt)
            goals_a[:, m] = sa[idx]
            goals_b[:, m] = sb[idx]
    else:
        goals_a = np.zeros((n, 0), dtype=np.int32)
        goals_b = np.zeros((n, 0), dtype=np.int32)
        gm_g = np.array([], dtype=np.int32)
        gm_li = np.array([], dtype=np.int32)
        gm_lj = np.array([], dtype=np.int32)

    for m_idx in range(n_gm):
        ga = goals_a[:, m_idx]
        gb = goals_b[:, m_idx]
        g  = gm_g[m_idx]
        li = gm_li[m_idx]
        lj = gm_lj[m_idx]
        a_win = ga > gb
        draw  = ga == gb
        b_win = gb > ga
        pts[:, g, li] += 3 * a_win.astype(np.int32) + draw.astype(np.int32)
        pts[:, g, lj] += 3 * b_win.astype(np.int32) + draw.astype(np.int32)
        diff = (ga - gb).astype(np.int32)
        gd[:, g, li] += diff
        gd[:, g, lj] -= diff

    # Sort within each group: key = pts*1000 + clip(gd, -500, 500)
    sort_key = pts * 1000 + np.clip(gd, -500, 500)                 # (n, 12, 4)
    local_ranks = np.argsort(-sort_key, axis=2)                     # (n, 12, 4) local idx

    # Ranked team IDs: ranked_ids[s, g, r] = team_id of r-th place in group g sim s
    g_idx_broadcast = np.arange(n_groups)[np.newaxis, :, np.newaxis]  # (1, 12, 1)
    ranked_ids = group_ids_arr[g_idx_broadcast, local_ranks]           # (n, 12, 4)

    # Top-2 qualifiers → (n, 24)
    top2 = ranked_ids[:, :, :2].reshape(n, n_groups * 2)

    # Best-8 third-place by pts+gd score
    third_ids   = ranked_ids[:, :, 2]                                  # (n, 12)
    third_score = sort_key[np.arange(n)[:, None], np.arange(n_groups)[None, :],
                           local_ranks[:, :, 2]]                        # (n, 12)
    top8_group_idx = np.argsort(-third_score, axis=1)[:, :8]           # (n, 8)
    best_third = third_ids[np.arange(n)[:, None], top8_group_idx]      # (n, 8)

    # R32 bracket: 24 + 8 = 32 teams
    r32 = np.concatenate([top2, best_third], axis=1).astype(np.int32)  # (n, 32)

    # Random bracket order (faithful to statistical independence)
    rand_order = np.argsort(rng.random((n, 32)), axis=1)
    r32 = r32[np.arange(n)[:, None], rand_order]

    # --- PHASE COUNTS -------------------------------------------------------
    phase_counts = {
        phase: np.zeros(n_teams, dtype=np.int64)
        for phase in ("groups", "r32", "r16", "qf", "sf", "final", "title")
    }

    def _count(ids_2d: np.ndarray, phase: str) -> None:
        np.add.at(phase_counts[phase], id_to_idx[ids_2d.flatten()], 1)

    _count(top2,       "groups")
    _count(best_third, "groups")
    _count(r32,        "r32")

    # --- KNOCKOUT ROUNDS ----------------------------------------------------
    bracket = r32
    sf_bracket = None
    finals_bracket = None
    for phase in ("r16", "qf", "sf", "final"):
        bracket = _knockout_round(bracket, attack_by_id, defense_by_id, rng, n)
        _count(bracket, phase)
        if phase == "sf":
            sf_bracket = bracket.copy()   # (n, 4) — the 4 semifinalists
        if phase == "final":
            finals_bracket = bracket      # (n, 2) — [champion, runner-up]

    # Champion: last team standing
    champion_idx = id_to_idx[bracket[:, 0]]
    np.add.at(phase_counts["title"], champion_idx, 1)

    # --- TRACK COMBO DISTRIBUTIONS ------------------------------------------
    PACK = 10_000  # safe for team IDs < 10000

    def _top_combos(arr: np.ndarray, top_k: int = 20) -> list[list[int]]:
        """Return top-k most frequent rows (sorted within each row)."""
        sorted_arr = np.sort(arr, axis=1)
        ncols = sorted_arr.shape[1]
        packed = np.zeros(n, dtype=np.int64)
        for c in range(ncols):
            packed = packed * PACK + sorted_arr[:, c].astype(np.int64)
        unique, counts = np.unique(packed, return_counts=True)
        order = np.argsort(-counts)[:top_k]
        result = []
        for idx in order:
            val = int(unique[idx])
            ids = []
            for _ in range(ncols):
                ids.append(val % PACK)
                val //= PACK
            result.append((list(reversed(ids)), int(counts[idx])))
        return result

    # Top finalist pairs with winner probability
    top_finals_raw = []
    if finals_bracket is not None:
        sorted_fin = np.sort(finals_bracket, axis=1)
        packed_fin = sorted_fin[:, 0].astype(np.int64) * PACK + sorted_fin[:, 1].astype(np.int64)
        unique_fin, cnt_fin = np.unique(packed_fin, return_counts=True)
        order_fin = np.argsort(-cnt_fin)[:20]
        for idx in order_fin:
            val = unique_fin[idx]
            tid_a = int(val // PACK)
            tid_b = int(val % PACK)
            mask = packed_fin == val
            wins_a = int((finals_bracket[mask, 0] == tid_a).sum())
            total = int(cnt_fin[idx])
            top_finals_raw.append({
                "team_a_id": tid_a,
                "team_b_id": tid_b,
                "prob": round(total / n * 100, 2),
                "prob_a_wins": round(wins_a / total * 100, 1) if total else 50.0,
                "prob_b_wins": round((total - wins_a) / total * 100, 1) if total else 50.0,
            })

    # Top SF quartets
    top_sf_raw = []
    if sf_bracket is not None:
        for ids, count in _top_combos(sf_bracket, 10):
            top_sf_raw.append({
                "team_ids": ids,
                "prob": round(count / n * 100, 2),
            })

    # --- BUILD RESULT --------------------------------------------------------
    results = {}
    for i, t in enumerate(teams):
        tid = t["id"]
        results[tid] = {
            "code": t["code"],
            "name": t["name"],
            "elo_rating": t["elo_rating"],
            "flag_url": t.get("flag_url", ""),
            "confederation": t.get("confederation", ""),
            "prob_groups": round(phase_counts["groups"][i] / n * 100, 2),
            "prob_r32":    round(phase_counts["r32"][i]    / n * 100, 2),
            "prob_r16":    round(phase_counts["r16"][i]    / n * 100, 2),
            "prob_qf":     round(phase_counts["qf"][i]     / n * 100, 2),
            "prob_sf":     round(phase_counts["sf"][i]     / n * 100, 2),
            "prob_final":  round(phase_counts["final"][i]  / n * 100, 2),
            "prob_title":  round(phase_counts["title"][i]  / n * 100, 2),
        }

    return results, top_finals_raw, top_sf_raw, team_by_id
