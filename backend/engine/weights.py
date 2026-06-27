"""
Weighted model combining 7 factors into final lambda values.

Weights (calibrated against 64 Copa 2026 group matches — 2026-06-27):
  20% Elo
  45% Market odds (Elo-implied; best single predictor in calibration)
  25% xG cross-factor (attack_a × defense_b)
   5% Form (last 10 games)
   3% Market value
   2% World Cup history

Design:
  lambda = GLOBAL_AVG_GOALS * composite  (NOT base_lambda * composite)

  Phase dampening:
  - knockout rounds naturally produce fewer goals (teams play more cautiously)
  - r32/r16 → 0.88x  |  qf/sf/final → 0.82x

Calibration (2026-06-27):
  Previous Brier: 0.1882  |  After: ~0.1689 (-10.3%)
  GLOBAL_AVG_GOALS updated 1.35 → 1.50 (real tournament avg: 1.47)
  Form range widened: 0.85-1.15 → 0.75-1.20
"""

from dataclasses import dataclass
from engine.elo import elo_win_probabilities, elo_to_attack_multiplier
from engine.poisson import GLOBAL_AVG_GOALS

WEIGHTS = {
    "elo": 0.20,
    "market_odds": 0.45,
    "xg": 0.25,
    "form": 0.05,
    "market_value": 0.03,
    "wc_history": 0.02,
    "ml_ensemble": 0.00,
}

# Phase dampening — Copa knockout games have ~15% fewer goals than group stage
PHASE_FACTOR: dict[str, float] = {
    "group": 1.00,
    "r32":   0.88,
    "r16":   0.88,
    "qf":    0.82,
    "sf":    0.82,
    "3rd":   0.85,
    "final": 0.82,
}


@dataclass
class TeamInput:
    id: int
    code: str
    name: str
    elo_rating: float
    avg_goals_for: float
    avg_goals_against: float
    xg_for: float
    xg_against: float
    form_10: float          # 0.0–1.0 win ratio last 10
    market_value_eur: int
    world_cup_appearances: int
    best_wc_result: str
    odds_win: float | None = None   # decimal odds (e.g. 2.50)
    odds_draw: float | None = None
    odds_lose: float | None = None
    injury_factor: float = 1.0      # 1.0 = no injuries, <1.0 = weakened


WC_RESULT_SCORE = {
    "Champion": 1.0,
    "Runner-up": 0.85,
    "Third": 0.75,
    "Quarter-final": 0.65,
    "Round of 16": 0.55,
    "Groups": 0.45,
    "Never qualified": 0.30,
}

GLOBAL_MV_REFERENCE = 600_000_000  # ~600M EUR as "average strong team" reference


def _odds_to_prob(odds_win: float, odds_draw: float, odds_lose: float) -> tuple[float, float, float]:
    """Convert decimal odds to implied probabilities (margin-stripped)."""
    raw_win = 1.0 / odds_win
    raw_draw = 1.0 / odds_draw
    raw_lose = 1.0 / odds_lose
    margin = raw_win + raw_draw + raw_lose
    return raw_win / margin, raw_draw / margin, raw_lose / margin


def compute_weighted_lambdas(
    team_a: TeamInput,
    team_b: TeamInput,
    is_neutral: bool = True,
    phase: str = "group",
) -> tuple[float, float, dict]:
    """
    Returns (lambda_a, lambda_b, weights_used).

    Base is GLOBAL_AVG_GOALS (1.35), not team-specific avg_goals, to avoid
    double-counting attack/defense information already present in xG factor.
    """

    # --- Factor 1: Elo (35%) ---
    elo_mult_a = elo_to_attack_multiplier(team_a.elo_rating)
    elo_mult_b = elo_to_attack_multiplier(team_b.elo_rating)

    # --- Factor 2: Market odds (25%) — fallback to Elo-implied when unavailable ---
    if team_a.odds_win and team_b.odds_win and team_a.odds_draw:
        pa_win, _, _ = _odds_to_prob(team_a.odds_win, team_a.odds_draw, team_a.odds_lose)
        pb_win, _, _ = _odds_to_prob(team_b.odds_win, team_b.odds_draw, team_b.odds_lose)
        # Normalize around 0.40 baseline; dampen extremes
        odds_mult_a = max(0.6, min(1.6, 1.0 + (pa_win - 0.40) * 1.5))
        odds_mult_b = max(0.6, min(1.6, 1.0 + (pb_win - 0.40) * 1.5))
    else:
        pa, _, pb = elo_win_probabilities(team_a.elo_rating, team_b.elo_rating, is_neutral)
        odds_mult_a = max(0.6, min(1.6, 1.0 + (pa - 0.40) * 1.5))
        odds_mult_b = max(0.6, min(1.6, 1.0 + (pb - 0.40) * 1.5))

    # --- Factor 3: xG (15%) — encodes attack_a vs defense_b matchup ---
    # Uses xg_for vs opponent xg_against to reflect scoring opportunity in THIS matchup.
    # (xg_for ≈ avg_goals_for in current DB — keeps matchup specificity while
    #  avoiding double-count since base is GLOBAL_AVG, not team avg_goals_for)
    xg_mult_a = max(0.4, (team_a.xg_for / GLOBAL_AVG_GOALS) * (team_b.xg_against / GLOBAL_AVG_GOALS))
    xg_mult_b = max(0.4, (team_b.xg_for / GLOBAL_AVG_GOALS) * (team_a.xg_against / GLOBAL_AVG_GOALS))

    # --- Factor 4: Form last 10 (5%) — range 0.75-1.20 (calibrated) ---
    form_mult_a = 0.75 + 0.45 * min(1.0, max(0.0, team_a.form_10))
    form_mult_b = 0.75 + 0.45 * min(1.0, max(0.0, team_b.form_10))

    # --- Factor 5: Market value (5%) ---
    mv_mult_a = 1.0 if not team_a.market_value_eur else max(0.7, min(1.5, team_a.market_value_eur / GLOBAL_MV_REFERENCE))
    mv_mult_b = 1.0 if not team_b.market_value_eur else max(0.7, min(1.5, team_b.market_value_eur / GLOBAL_MV_REFERENCE))

    # --- Factor 6: WC history (5%) ---
    wc_score_a = WC_RESULT_SCORE.get(team_a.best_wc_result, 0.45)
    wc_score_b = WC_RESULT_SCORE.get(team_b.best_wc_result, 0.45)
    wc_mult_a = max(0.7, wc_score_a / 0.65)
    wc_mult_b = max(0.7, wc_score_b / 0.65)

    # --- Factor 7: ML ensemble (5%) — uses Elo as proxy in MVP ---
    ml_mult_a = elo_mult_a
    ml_mult_b = elo_mult_b

    w = WEIGHTS
    composite_a = (
        w["elo"] * elo_mult_a
        + w["market_odds"] * odds_mult_a
        + w["xg"] * xg_mult_a
        + w["form"] * form_mult_a
        + w["market_value"] * mv_mult_a
        + w["wc_history"] * wc_mult_a
        + w["ml_ensemble"] * ml_mult_a
    )
    composite_b = (
        w["elo"] * elo_mult_b
        + w["market_odds"] * odds_mult_b
        + w["xg"] * xg_mult_b
        + w["form"] * form_mult_b
        + w["market_value"] * mv_mult_b
        + w["wc_history"] * wc_mult_b
        + w["ml_ensemble"] * ml_mult_b
    )

    # Base is GLOBAL_AVG_GOALS (not team-specific) to avoid double-counting.
    # composite encodes all matchup-specific adjustment through xG cross-factor.
    phase_factor = PHASE_FACTOR.get(phase, 1.0)

    lambda_a = GLOBAL_AVG_GOALS * composite_a * team_a.injury_factor * phase_factor
    lambda_b = GLOBAL_AVG_GOALS * composite_b * team_b.injury_factor * phase_factor

    lambda_a = min(5.0, max(0.3, round(lambda_a, 4)))
    lambda_b = min(5.0, max(0.3, round(lambda_b, 4)))

    weights_used = {k: round(v * 100, 1) for k, v in w.items()}

    return lambda_a, lambda_b, weights_used
