"""add_h2h_and_projections

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-06 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'team_head_to_head',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('team_a_code', sa.String(3), nullable=False),
        sa.Column('team_b_code', sa.String(3), nullable=False),
        sa.Column('wins_a', sa.Integer(), nullable=True),
        sa.Column('wins_b', sa.Integer(), nullable=True),
        sa.Column('draws', sa.Integer(), nullable=True),
        sa.Column('total_matches', sa.Integer(), nullable=True),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('source', sa.String(20), nullable=False, server_default='web_search'),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        'ix_team_head_to_head_pair', 'team_head_to_head',
        ['team_a_code', 'team_b_code'], unique=True,
    )

    op.create_table(
        'match_projections',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('match_id', sa.Integer(), sa.ForeignKey('matches.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('sent_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('telegram_message_id', sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('match_projections')
    op.drop_index('ix_team_head_to_head_pair', table_name='team_head_to_head')
    op.drop_table('team_head_to_head')
