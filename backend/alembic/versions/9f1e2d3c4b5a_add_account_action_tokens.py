"""admin: tokens de troca de e-mail/telefone iniciados pelo painel

Revision ID: 9f1e2d3c4b5a
Revises: a9b8c7d6e5f4
Create Date: 2026-07-08 21:00:00.000000

Admin manda e-mail com link pro usuário trocar e-mail ou telefone.
Token genérico (action='email'|'phone'), mesmo padrão do password_reset_tokens
mas sem acoplar ao fluxo de senha (que já tem tabela própria).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '9f1e2d3c4b5a'
down_revision: Union[str, None] = 'a9b8c7d6e5f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'account_action_tokens',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('action', sa.String(length=20), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False, unique=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_account_action_tokens_token', 'account_action_tokens', ['token'])


def downgrade() -> None:
    op.drop_index('ix_account_action_tokens_token', table_name='account_action_tokens')
    op.drop_table('account_action_tokens')
