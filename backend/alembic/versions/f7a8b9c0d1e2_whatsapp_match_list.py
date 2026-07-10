"""whatsapp bet session: coluna list_json p/ listagem numerada de jogos

Revision ID: f7a8b9c0d1e2
Revises: e6bd7571ff0d
Create Date: 2026-07-08 20:30:00.000000

Comando "jogos" no bot WhatsApp lista partidas abertas numeradas; usuário responde
"1 2x1" pra apostar pelo número em vez de digitar nome dos times. list_json guarda
o array ordenado de match_id (state='lista_enviada') pra resolver o índice depois.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'e6bd7571ff0d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('whatsapp_bet_sessions', sa.Column('list_json', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('whatsapp_bet_sessions', 'list_json')
