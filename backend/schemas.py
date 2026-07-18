from datetime import datetime
from typing import Optional, Any, Literal
from pydantic import BaseModel, EmailStr, Field


class TeamBase(BaseModel):
    name: str
    code: str
    confederation: str
    group_name: Optional[str] = None


class TeamResponse(TeamBase):
    id: int
    elo_rating: float
    market_value_eur: int
    avg_age: float
    world_cup_appearances: int
    best_wc_result: str
    avg_goals_for: float
    avg_goals_against: float
    xg_for: float
    xg_against: float
    form_5: float
    form_10: float
    form_20: float
    flag_url: Optional[str] = None

    model_config = {"from_attributes": True}


class TeamUpdate(BaseModel):
    elo_rating: Optional[float] = None
    market_value_eur: Optional[int] = None
    avg_goals_for: Optional[float] = None
    avg_goals_against: Optional[float] = None
    xg_for: Optional[float] = None
    xg_against: Optional[float] = None
    form_5: Optional[float] = None
    form_10: Optional[float] = None
    form_20: Optional[float] = None


class PlayerResponse(BaseModel):
    id: int
    team_id: int
    name: str
    position: Optional[str] = None
    market_value_eur: int
    is_injured: bool
    is_suspended: bool
    impact_weight: float

    model_config = {"from_attributes": True}


class ScoreProb(BaseModel):
    score: str
    prob: float


class MatchSimulationResponse(BaseModel):
    match_id: int
    team_a: str
    team_b: str
    prob_a: float
    prob_draw: float
    prob_b: float
    lambda_a: float
    lambda_b: float
    xg_a: float
    xg_b: float
    top_scores: list[ScoreProb]
    recommended_score: ScoreProb
    model_weights: dict[str, float]
    h2h: dict | None = None
    simulations: int
    cached: bool


class TeamTournamentProb(BaseModel):
    team_id: int
    code: str
    name: str
    confederation: str
    elo_rating: float
    prob_groups: float
    prob_r32: float
    prob_r16: float
    prob_qf: float
    prob_sf: float
    prob_final: float
    prob_title: float


class TournamentSimulationResponse(BaseModel):
    simulations: int
    computed_at: datetime
    teams: list[TeamTournamentProb]


class MatchResponse(BaseModel):
    id: int
    phase: str
    group_name: Optional[str]
    team_a: TeamResponse
    team_b: TeamResponse
    match_date: Optional[datetime]
    venue: Optional[str]
    city: Optional[str]
    status: str
    match_number: Optional[int]
    result: Optional[dict] = None

    model_config = {"from_attributes": True}


class ResultCreate(BaseModel):
    match_id: int
    score_a: int
    score_b: int
    xg_a: Optional[float] = None
    xg_b: Optional[float] = None


class InjuryUpdate(BaseModel):
    is_injured: bool
    is_suspended: bool


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=8)
    username: str | None = None
    phone: str | None = None
    referred_by: int | None = None
    whatsapp_opt_in: bool = False


class UserResponse(BaseModel):
    id: int
    email: str
    username: str | None = None
    phone: str | None = None
    name: str
    role: str
    whatsapp_opt_in: bool = False
    whatsapp_prompted_at: datetime | None = None
    whatsapp_prefs: dict | None = None
    theme: str = 'system'
    ranking_display_pref: str = 'name'
    created_at: datetime

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    name: str | None = None
    username: str | None = None
    phone: str | None = None
    whatsapp_opt_in: bool | None = None
    whatsapp_prompt_dismissed: bool | None = None
    whatsapp_prefs: dict | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class AdminUserUpdate(BaseModel):
    role: str | None = None
    name: str | None = None
    username: str | None = None
    phone: str | None = None
    email: EmailStr | None = None


class AdminAccountEmail(BaseModel):
    action: str  # 'password' | 'email' | 'phone'


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


class BetCreate(BaseModel):
    match_id: int
    score_a: int
    score_b: int
    et_winner_pick: Optional[Literal["a", "b"]] = None


class BetResponse(BaseModel):
    id: int
    match_id: int
    score_a: int
    score_b: int
    points_earned: int
    et_winner_pick: Optional[str] = None
    et_points_earned: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class RankingRow(BaseModel):
    position: int
    user_id: int
    name: str
    total_points: int
    exact_scores: int
    correct_results: int


class HealthResponse(BaseModel):
    status: str
    db: str
    redis: str
    version: str
