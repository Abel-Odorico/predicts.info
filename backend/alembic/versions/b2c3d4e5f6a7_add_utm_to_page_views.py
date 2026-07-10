"""add_utm_to_page_views

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-04 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('page_views', sa.Column('utm_source', sa.String(60), nullable=True))
    op.add_column('page_views', sa.Column('utm_campaign', sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column('page_views', 'utm_campaign')
    op.drop_column('page_views', 'utm_source')
