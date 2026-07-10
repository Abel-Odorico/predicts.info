"""add_standalone_to_page_views

Revision ID: a1b2c3d4e5f6
Revises: 0585e211e64e
Create Date: 2026-07-04 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '0585e211e64e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('page_views', sa.Column('standalone', sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column('page_views', 'standalone')
