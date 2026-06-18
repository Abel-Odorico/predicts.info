"""
Poisson lambda computation for goal expectation.

λ_A = (attack_strength_A / global_avg) * (defense_weakness_B / global_avg) * global_avg * home_factor
This is the Dixon-Coles approach adapted for international football.
"""

GLOBAL_AVG_GOALS = 1.35  # international football average goals per team per match


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
    """Exact Poisson probability for a specific scoreline."""
    from math import exp, factorial
    p_a = (lambda_a ** ga) * exp(-lambda_a) / factorial(ga)
    p_b = (lambda_b ** gb) * exp(-lambda_b) / factorial(gb)
    return p_a * p_b


def analytical_probabilities(lambda_a: float, lambda_b: float, max_goals: int = 8) -> dict:
    """
    Compute win/draw/loss and top scores analytically (no simulation).
    Fast path used for cache priming; Monte Carlo is the accurate path.
    """
    prob_a = 0.0
    prob_draw = 0.0
    prob_b = 0.0
    scores: dict[str, float] = {}

    for ga in range(max_goals + 1):
        for gb in range(max_goals + 1):
            p = poisson_score_prob(lambda_a, lambda_b, ga, gb)
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
