"""add_referred_by_to_users

Revision ID: 0585e211e64e
Revises: a48a2805d933
Create Date: 2026-06-26 21:49:58.165502

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0585e211e64e'
down_revision: Union[str, None] = 'a48a2805d933'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('referred_by', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_users_referred_by', 'users', 'users', ['referred_by'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_users_referred_by', 'users', type_='foreignkey')
    op.drop_column('users', 'referred_by')
