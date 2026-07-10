"""add user is_active + deactivated_at (soft delete)

Revision ID: fe48c727c0a7
Revises: 9f1e2d3c4b5a
Create Date: 2026-07-08 00:00:00.000000

Exclusão de usuário via admin não pode ser hard delete — bets, ranking,
grupos e convites referenciam users.id sem ON DELETE CASCADE. is_active=False
bloqueia login (get_current_user/login checam), PII (nome/email/username/
phone) é anonimizada no momento da desativação, histórico de apostas e
ranking fica intacto.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'fe48c727c0a7'
down_revision: Union[str, None] = '9f1e2d3c4b5a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('users', sa.Column('deactivated_at', sa.DateTime(), nullable=True))
    op.alter_column('users', 'is_active', server_default=None)


def downgrade() -> None:
    op.drop_column('users', 'deactivated_at')
    op.drop_column('users', 'is_active')
