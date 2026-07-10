"""whatsapp_group_posts — dedup de avisos automáticos no grupo oficial

Revision ID: gp1a2b3c4d5e
Revises: wa1b2c3d4e5f
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa

revision = "gp1a2b3c4d5e"
down_revision = "wa1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_group_posts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),  # projection | reminder | result
        sa.Column("sent_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("match_id", "kind", name="uq_wa_group_post_match_kind"),
    )


def downgrade() -> None:
    op.drop_table("whatsapp_group_posts")
