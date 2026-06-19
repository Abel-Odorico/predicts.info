from datetime import datetime, timezone
from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey,
    Integer, Numeric, String, Text, BigInteger, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from database import Base
import enum


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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


class GroupInviteStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


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
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

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
    bet_deadline = Column(DateTime)

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
    recorded_at = Column(DateTime, default=_utcnow)

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
    computed_at = Column(DateTime, default=_utcnow)
    expires_at = Column(DateTime)

    match = relationship("Match", back_populates="simulation")


class TournamentSimulation(Base):
    __tablename__ = "tournament_simulations"

    id = Column(Integer, primary_key=True)
    computed_at = Column(DateTime, default=_utcnow)
    simulations_count = Column(Integer, default=1_000_000)
    results = Column(JSONB, nullable=False)
    round_number = Column(Integer, default=0)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), nullable=False, unique=True)
    username = Column(String(60), unique=True, nullable=True)
    phone = Column(String(30), nullable=True)
    name = Column(String(100), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.user)
    theme = Column(String(10), default='system', nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    bets = relationship("Bet", back_populates="user")
    ranking = relationship("Ranking", back_populates="user", uselist=False)
    owned_groups = relationship("UserGroup", back_populates="owner", foreign_keys="UserGroup.owner_user_id")
    group_memberships = relationship("UserGroupMember", back_populates="user")
    sent_group_invites = relationship("UserGroupInvite", back_populates="inviter", foreign_keys="UserGroupInvite.inviter_user_id")
    received_group_invites = relationship("UserGroupInvite", back_populates="invitee", foreign_keys="UserGroupInvite.invitee_user_id")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(64), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    user = relationship("User")


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
    created_at = Column(DateTime, default=_utcnow)

    user = relationship("User", back_populates="bets")
    match = relationship("Match", back_populates="bets")


class Ranking(Base):
    __tablename__ = "rankings"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    total_points = Column(Integer, default=0)
    exact_scores = Column(Integer, default=0)
    correct_results = Column(Integer, default=0)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    user = relationship("User", back_populates="ranking")


class UserGroup(Base):
    __tablename__ = "user_groups"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    invite_token = Column(String(64), unique=True, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    owner = relationship("User", back_populates="owned_groups", foreign_keys=[owner_user_id])
    members = relationship("UserGroupMember", back_populates="group", cascade="all, delete-orphan")
    invites = relationship("UserGroupInvite", back_populates="group", cascade="all, delete-orphan")


class UserGroupMember(Base):
    __tablename__ = "user_group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_user_group_member"),)

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("user_groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_owner = Column(Boolean, default=False)
    joined_at = Column(DateTime, default=_utcnow)
    champion_pick_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)

    group = relationship("UserGroup", back_populates="members")
    user = relationship("User", back_populates="group_memberships")
    champion_pick = relationship("Team", foreign_keys=[champion_pick_team_id])


class UserGroupInvite(Base):
    __tablename__ = "user_group_invites"

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("user_groups.id"), nullable=False)
    inviter_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    invitee_user_id = Column(Integer, ForeignKey("users.id"))
    invitee_email = Column(String(255), nullable=False)
    status = Column(Enum(GroupInviteStatus), default=GroupInviteStatus.pending, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    responded_at = Column(DateTime)

    group = relationship("UserGroup", back_populates="invites")
    inviter = relationship("User", back_populates="sent_group_invites", foreign_keys=[inviter_user_id])
    invitee = relationship("User", back_populates="received_group_invites", foreign_keys=[invitee_user_id])


class GroupMessage(Base):
    __tablename__ = "group_messages"

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("user_groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_utcnow)

    group = relationship("UserGroup")
    user = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    action     = Column(String(100), nullable=False)
    details    = Column(Text)
    ip         = Column(String(45))
    created_at = Column(DateTime, default=_utcnow, index=True)

    user = relationship("User")


class SiteConfig(Base):
    __tablename__ = "site_config"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class PageView(Base):
    __tablename__ = "page_views"

    id         = Column(Integer, primary_key=True)
    path       = Column(String(300), nullable=False, default="/")
    ip         = Column(String(45))
    country    = Column(String(2))
    country_name = Column(String(80))
    city       = Column(String(100))
    device     = Column(String(20))   # mobile / tablet / desktop
    browser    = Column(String(40))
    os         = Column(String(40))
    referrer   = Column(String(500))
    created_at = Column(DateTime, default=_utcnow, index=True)
