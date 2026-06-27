"""
Poisson lambda computation for goal expectation with Dixon-Coles (1997) correction.

λ_A = (attack_strength_A / global_avg) * (defense_weakness_B / global_avg) * global_avg * home_factor

DC correction adjusts low-score joint probabilities (ga+gb ≤ 2) using a correlation
parameter ρ. With ρ < 0: 0-0 and 1-1 draws become more likely; 1-0 and 0-1 less likely.
"""
import numpy as np

GLOBAL_AVG_GOALS = 1.50  # calibrated against Copa 2026 group stage (64 matches avg 1.47)
DC_RHO = -0.13           # Dixon-Coles ρ — calibrated for international football


def compute_lambdas(
    avg_goals_for_a: float,
    avg_goals_against_a: float,
    avg_goals_for_b: float,
    avg_goals_against_b: float,
    home_factor: float = 1.0,
) -> tuple[float, float]:
    """
    Returns (lambda_a, lambda_b) — expected goals for each team.
    home_factor: 1.0 = neutral, ~1.15 = home advantage.
    """
    attack_a = avg_goals_for_a / GLOBAL_AVG_GOALS
    defense_b = avg_goals_against_b / GLOBAL_AVG_GOALS
    lambda_a = attack_a * defense_b * GLOBAL_AVG_GOALS * home_factor

    attack_b = avg_goals_for_b / GLOBAL_AVG_GOALS
    defense_a = avg_goals_against_a / GLOBAL_AVG_GOALS
    lambda_b = attack_b * defense_a * GLOBAL_AVG_GOALS

    # Floor at 0.3 — even weakest teams score occasionally
    return max(0.30, round(lambda_a, 4)), max(0.30, round(lambda_b, 4))


def poisson_score_prob(lambda_a: float, lambda_b: float, ga: int, gb: int) -> float:
    """Exact Poisson probability for a specific scoreline (no DC correction)."""
    from math import exp, factorial
    p_a = (lambda_a ** ga) * exp(-lambda_a) / factorial(ga)
    p_b = (lambda_b ** gb) * exp(-lambda_b) / factorial(gb)
    return p_a * p_b


def dc_score_weights(
    lambda_a: float,
    lambda_b: float,
    rho: float = DC_RHO,
    max_goals: int = 8,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Returns (scores_a, scores_b, weights) arrays for Dixon-Coles corrected sampling.
    Weights are a normalized PMF over all (ga, gb) pairs up to max_goals.
    """
    from math import exp, factorial

    size = (max_goals + 1) ** 2
    sa = np.empty(size, dtype=np.int32)
    sb = np.empty(size, dtype=np.int32)
    w  = np.empty(size, dtype=np.float64)

    idx = 0
    for ga in range(max_goals + 1):
        p_a = (lambda_a ** ga) * exp(-lambda_a) / factorial(ga)
        for gb in range(max_goals + 1):
            p_b = (lambda_b ** gb) * exp(-lambda_b) / factorial(gb)
            if ga == 0 and gb == 0:
                tau = 1.0 - lambda_a * lambda_b * rho
            elif ga == 1 and gb == 0:
                tau = 1.0 + lambda_b * rho
            elif ga == 0 and gb == 1:
                tau = 1.0 + lambda_a * rho
            elif ga == 1 and gb == 1:
                tau = 1.0 - rho
            else:
                tau = 1.0
            sa[idx] = ga
            sb[idx] = gb
            w[idx]  = max(0.0, p_a * p_b * tau)
            idx += 1

    w /= w.sum()
    return sa, sb, w


def analytical_probabilities(lambda_a: float, lambda_b: float, max_goals: int = 8) -> dict:
    """
    Compute win/draw/loss and top scores analytically with Dixon-Coles correction.
    Fast path used for cache priming; Monte Carlo is the accurate path.
    """
    sa, sb, weights = dc_score_weights(lambda_a, lambda_b, max_goals=max_goals)

    prob_a = 0.0
    prob_draw = 0.0
    prob_b = 0.0
    scores: dict[str, float] = {}

    for i in range(len(sa)):
        ga, gb, p = int(sa[i]), int(sb[i]), float(weights[i])
        scores[f"{ga}x{gb}"] = round(p * 100, 3)
        if ga > gb:
            prob_a += p
        elif ga == gb:
            prob_draw += p
        else:
            prob_b += p

    top_scores = sorted(scores.items(), key=lambda x: -x[1])[:20]
    return {
        "prob_a": round(prob_a * 100, 2),
        "prob_draw": round(prob_draw * 100, 2),
        "prob_b": round(prob_b * 100, 2),
        "top_scores": [{"score": s, "prob": p} for s, p in top_scores],
    }
