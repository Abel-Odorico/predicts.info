"""whatsapp_bet_et_winner_pick

Revision ID: a1b2c3d4e5f6
Revises: fe48c727c0a7
Create Date: 2026-07-09 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'wa1b2c3d4e5f'
down_revision: Union[str, None] = 'fe48c727c0a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    et_winner_pick_enum = sa.Enum('a', 'b', name='et_winner_pick')
    et_winner_pick_enum.create(op.get_bind(), checkfirst=True)
    op.add_column('whatsapp_bet_sessions', sa.Column('draft_et_winner_pick', et_winner_pick_enum, nullable=True))


def downgrade() -> None:
    op.drop_column('whatsapp_bet_sessions', 'draft_et_winner_pick')
