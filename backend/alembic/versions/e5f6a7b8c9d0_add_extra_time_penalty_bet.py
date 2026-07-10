"""add_extra_time_penalty_bet

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    et_winner_enum = sa.Enum('a', 'b', name='et_winner')
    et_winner_pick_enum = sa.Enum('a', 'b', name='et_winner_pick')
    et_winner_enum.create(op.get_bind(), checkfirst=True)
    et_winner_pick_enum.create(op.get_bind(), checkfirst=True)

    op.add_column('match_results', sa.Column('went_to_extra_time', sa.Boolean(), server_default=sa.false()))
    op.add_column('match_results', sa.Column('decided_by_penalties', sa.Boolean(), server_default=sa.false()))
    op.add_column('match_results', sa.Column('et_winner', et_winner_enum, nullable=True))
    op.add_column('match_results', sa.Column('penalty_score_a', sa.Integer(), nullable=True))
    op.add_column('match_results', sa.Column('penalty_score_b', sa.Integer(), nullable=True))

    op.add_column('bets', sa.Column('et_winner_pick', et_winner_pick_enum, nullable=True))
    op.add_column('bets', sa.Column('et_points_earned', sa.Integer(), server_default='0'))


def downgrade() -> None:
    op.drop_column('bets', 'et_points_earned')
    op.drop_column('bets', 'et_winner_pick')

    op.drop_column('match_results', 'penalty_score_b')
    op.drop_column('match_results', 'penalty_score_a')
    op.drop_column('match_results', 'et_winner')
    op.drop_column('match_results', 'decided_by_penalties')
    op.drop_column('match_results', 'went_to_extra_time')

    sa.Enum(name='et_winner_pick').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='et_winner').drop(op.get_bind(), checkfirst=True)
