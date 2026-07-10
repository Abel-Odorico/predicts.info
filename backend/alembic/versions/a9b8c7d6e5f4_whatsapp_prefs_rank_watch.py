"""whatsapp: preferencias por tipo de mensagem

Revision ID: a9b8c7d6e5f4
Revises: f7a8b9c0d1e2
Create Date: 2026-07-08 21:40:00.000000

whatsapp_prefs (JSONB, chave->bool) deixa o usuário desligar tipos específicos de mensagem
WhatsApp sem sair do opt-in geral: bet_reminder, bet_confirmation, version_update,
ranking_highlight. Ausência de chave = default ligado (opt-in já é o consentimento amplo,
os toggles só afinam pra baixo).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'a9b8c7d6e5f4'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('whatsapp_prefs', JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'whatsapp_prefs')
