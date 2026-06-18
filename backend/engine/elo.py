"""
Elo rating system adapted for international football.
K=32 (standard FIFA), home advantage = +100 Elo points.
"""

K_FACTOR = 32
HOME_ADVANTAGE = 100.0
NEUTRAL_ADVANTAGE = 0.0


def expected_score(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def update_ratings(
    rating_a: float,
    rating_b: float,
    result: float,  # 1.0 = A wins, 0.5 = draw, 0.0 = B wins
    k: float = K_FACTOR,
) -> tuple[float, float]:
    ea = expected_score(rating_a, rating_b)
    new_a = rating_a + k * (result - ea)
    new_b = rating_b + k * ((1.0 - result) - (1.0 - ea))
    return round(new_a, 2), round(new_b, 2)


def elo_win_probabilities(
    rating_a: float,
    rating_b: float,
    is_neutral: bool = True,
) -> tuple[float, float, float]:
    """
    Returns (prob_a_win, prob_draw, prob_b_win).
    Draw probability modeled as a function of Elo difference:
    closer ratings → higher draw chance (peaks ~28% at 0 diff).
    """
    advantage = NEUTRAL_ADVANTAGE if is_neutral else HOME_ADVANTAGE
    adjusted_a = rating_a + advantage

    diff = adjusted_a - rating_b
    raw_win_a = 1.0 / (1.0 + 10 ** (-diff / 400.0))

    # Draw probability peaks at ~0.28 when teams are equal, shrinks as diff grows
    draw = max(0.10, 0.28 - abs(diff) / 2500.0)

    remaining = 1.0 - draw
    # Scale win/loss into the remaining probability space
    prob_a = raw_win_a * remaining / (raw_win_a + (1.0 - raw_win_a))
    prob_b = remaining - prob_a

    total = prob_a + draw + prob_b
    return prob_a / total, draw / total, prob_b / total


def elo_to_attack_multiplier(rating: float, base_rating: float = 1750.0) -> float:
    """Translate Elo rating into an attack/defense multiplier relative to average team."""
    diff = rating - base_rating
    return 1.0 + diff / 1000.0
