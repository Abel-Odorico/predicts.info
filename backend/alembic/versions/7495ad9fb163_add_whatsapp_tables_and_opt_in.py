"""add whatsapp tables and opt-in

Revision ID: 7495ad9fb163
Revises: e5f6a7b8c9d0
Create Date: 2026-07-07 23:45:03.708917

DB tem drift de legado (DDL idempotente em _run_migrations) vs. models.py — autogenerate
detectou dezenas de mudancas nao relacionadas (drops de tabelas vivas). Poda manual:
so as mudancas de WhatsApp entram aqui.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '7495ad9fb163'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('whatsapp_campaigns',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('target_filter', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('whatsapp_bet_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('phone', sa.String(length=30), nullable=False),
        sa.Column('state', sa.String(length=30), nullable=False),
        sa.Column('match_id', sa.Integer(), nullable=True),
        sa.Column('draft_score_a', sa.Integer(), nullable=True),
        sa.Column('draft_score_b', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['match_id'], ['matches.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_whatsapp_bet_sessions_phone'), 'whatsapp_bet_sessions', ['phone'], unique=False)
    op.create_table('whatsapp_campaign_recipients',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('phone', sa.String(length=30), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=True),
        sa.Column('sent_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['campaign_id'], ['whatsapp_campaigns.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_whatsapp_campaign_recipients_campaign_id'), 'whatsapp_campaign_recipients', ['campaign_id'], unique=False)
    op.create_table('whatsapp_messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('direction', sa.String(length=10), nullable=False),
        sa.Column('phone', sa.String(length=30), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=True),
        sa.Column('match_id', sa.Integer(), nullable=True),
        sa.Column('meta', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['match_id'], ['matches.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_whatsapp_messages_created_at'), 'whatsapp_messages', ['created_at'], unique=False)
    op.create_index(op.f('ix_whatsapp_messages_phone'), 'whatsapp_messages', ['phone'], unique=False)

    op.add_column('users', sa.Column('whatsapp_opt_in', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('users', 'whatsapp_opt_in', server_default=None)


def downgrade() -> None:
    op.drop_column('users', 'whatsapp_opt_in')
    op.drop_index(op.f('ix_whatsapp_messages_phone'), table_name='whatsapp_messages')
    op.drop_index(op.f('ix_whatsapp_messages_created_at'), table_name='whatsapp_messages')
    op.drop_table('whatsapp_messages')
    op.drop_index(op.f('ix_whatsapp_campaign_recipients_campaign_id'), table_name='whatsapp_campaign_recipients')
    op.drop_table('whatsapp_campaign_recipients')
    op.drop_index(op.f('ix_whatsapp_bet_sessions_phone'), table_name='whatsapp_bet_sessions')
    op.drop_table('whatsapp_bet_sessions')
    op.drop_table('whatsapp_campaigns')
