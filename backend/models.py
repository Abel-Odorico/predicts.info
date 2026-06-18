from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey,
    Integer, Numeric, String, Text, BigInteger, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from database import Base
import enum


class Confederation(str, enum.Enum):
    UEFA = "UEFA"
    CONMEBOL = "CONMEBOL"
    CONCACAF = "CONCACAF"
    CAF = "CAF"
    AFC = "AFC"
    OFC = "OFC"


class MatchPhase(str, enum.Enum):
    group = "group"
    r32 = "r32"
    r16 = "r16"
    qf = "qf"
    sf = "sf"
    third = "3rd"
    final = "final"


class MatchStatus(str, enum.Enum):
    scheduled = "scheduled"
    live = "live"
    finished = "finished"


class UserRole(str, enum.Enum):
    user = "user"
    admin = "admin"


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    code = Column(String(3), nullable=False, unique=True)
    confederation = Column(Enum(Confederation), nullable=False)
    group_name = Column(String(1))

    elo_rating = Column(Numeric(8, 2), default=1500.0)
    market_value_eur = Column(BigInteger, default=0)
    avg_age = Column(Numeric(4, 1), default=26.0)
    world_cup_appearances = Column(Integer, default=0)
    best_wc_result = Column(String(20), default="Groups")

    avg_goals_for = Column(Numeric(4, 2), default=1.35)
    avg_goals_against = Column(Numeric(4, 2), default=1.35)
    xg_for = Column(Numeric(4, 2), default=1.35)
    xg_against = Column(Numeric(4, 2), default=1.35)
    form_5 = Column(Numeric(4, 3), default=0.500)
    form_10 = Column(Numeric(4, 3), default=0.500)
    form_20 = Column(Numeric(4, 3), default=0.500)

    flag_url = Column(String(200))
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    players = relationship("Player", back_populates="team", lazy="dynamic")
    home_matches = relationship("Match", foreign_keys="Match.team_a_id", back_populates="team_a")
    away_matches = relationship("Match", foreign_keys="Match.team_b_id", back_populates="team_b")


class Player(Base):
    __tablename__ = "players"

    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    name = Column(String(100), nullable=False)
    position = Column(String(20))
    market_value_eur = Column(BigInteger, default=0)
    is_injured = Column(Boolean, default=False)
    is_suspended = Column(Boolean, default=False)
    impact_weight = Column(Numeric(4, 3), default=0.010)

    team = relationship("Team", back_populates="players")


class Match(Base):
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True)
    phase = Column(Enum(MatchPhase), nullable=False, default=MatchPhase.group)
    team_a_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    team_b_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    group_name = Column(String(1))
    match_date = Column(DateTime)
    venue = Column(String(100))
    city = Column(String(50))
    is_neutral = Column(Boolean, default=True)
    status = Column(Enum(MatchStatus), default=MatchStatus.scheduled)
    match_number = Column(Integer)

    team_a = relationship("Team", foreign_keys=[team_a_id], back_populates="home_matches")
    team_b = relationship("Team", foreign_keys=[team_b_id], back_populates="away_matches")
    result = relationship("MatchResult", back_populates="match", uselist=False)
    simulation = relationship("SimulationCache", back_populates="match", uselist=False)
    bets = relationship("Bet", back_populates="match")


class MatchResult(Base):
    __tablename__ = "match_results"

    id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False, unique=True)
    score_a = Column(Integer, nullable=False)
    score_b = Column(Integer, nullable=False)
    xg_a = Column(Numeric(4, 2))
    xg_b = Column(Numeric(4, 2))
    result = Column(Enum("a", "draw", "b", name="match_outcome"), nullable=False)
    recorded_at = Column(DateTime, default=datetime.utcnow)

    match = relationship("Match", back_populates="result")


class SimulationCache(Base):
    __tablename__ = "simulations_cache"

    id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False, unique=True)
    data_hash = Column(String(64), nullable=False)

    prob_a = Column(Numeric(6, 4))
    prob_draw = Column(Numeric(6, 4))
    prob_b = Column(Numeric(6, 4))
    lambda_a = Column(Numeric(6, 4))
    lambda_b = Column(Numeric(6, 4))
    xg_a = Column(Numeric(4, 2))
    xg_b = Column(Numeric(4, 2))
    top_scores = Column(JSONB)
    model_weights = Column(JSONB)
    simulations_count = Column(Integer, default=1_000_000)
    computed_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)

    match = relationship("Match", back_populates="simulation")


class TournamentSimulation(Base):
    __tablename__ = "tournament_simulations"

    id = Column(Integer, primary_key=True)
    computed_at = Column(DateTime, default=datetime.utcnow)
    simulations_count = Column(Integer, default=1_000_000)
    results = Column(JSONB, nullable=False)
    round_number = Column(Integer, default=0)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), nullable=False, unique=True)
    name = Column(String(100), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.user)
    created_at = Column(DateTime, default=datetime.utcnow)

    bets = relationship("Bet", back_populates="user")
    ranking = relationship("Ranking", back_populates="user", uselist=False)


class Bet(Base):
    __tablename__ = "bets"
    __table_args__ = (UniqueConstraint("user_id", "match_id", name="uq_user_match_bet"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False)
    score_a = Column(Integer, nullable=False)
    score_b = Column(Integer, nullable=False)
    points_earned = Column(Integer, default=0)
    locked_at = Column(DateTime)
    evaluated_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="bets")
    match = relationship("Match", back_populates="bets")


class Ranking(Base):
    __tablename__ = "rankings"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    total_points = Column(Integer, default=0)
    exact_scores = Column(Integer, default=0)
    correct_results = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="ranking")
