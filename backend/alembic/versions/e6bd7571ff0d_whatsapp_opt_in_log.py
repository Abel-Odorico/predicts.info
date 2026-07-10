"""whatsapp opt-in/opt-out timestamps + prompt flag

Revision ID: e6bd7571ff0d
Revises: 7495ad9fb163
Create Date: 2026-07-08 12:10:00.000000

Popup persistente de opt-in (AppPopups) precisa saber se o usuário já respondeu
alguma vez (whatsapp_prompted_at) pra não reaparecer toda sessão. Datas de
opt_in/opt_out ficam no User pra exibição rápida (admin, auditoria complementa
via AuditLog com o histórico completo de mudanças).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e6bd7571ff0d'
down_revision: Union[str, None] = '7495ad9fb163'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('whatsapp_opt_in_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('whatsapp_opt_out_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('whatsapp_prompted_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'whatsapp_prompted_at')
    op.drop_column('users', 'whatsapp_opt_out_at')
    op.drop_column('users', 'whatsapp_opt_in_at')
