"""Initial schema: users, captures, conversations, analyses

Revision ID: 0001
Revises:
Create Date: 2026-06-19
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("github_id", sa.Integer(), unique=True, index=True, nullable=False),
        sa.Column("login", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("avatar_url", sa.String(1024), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "captures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        ),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("linktype", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("packet_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "status",
            sa.Enum("uploaded", "parsing", "ready", "failed", name="capturestatus"),
            nullable=False,
            server_default="uploaded",
        ),
        sa.Column("stored_path", sa.String(1024), nullable=False),
        sa.Column("parsed_index_path", sa.String(1024), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "capture_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("captures.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        ),
        sa.Column("proto", sa.String(8), nullable=False),
        sa.Column("src_ip", sa.String(45), nullable=False),
        sa.Column("src_port", sa.Integer(), nullable=False),
        sa.Column("dst_ip", sa.String(45), nullable=False),
        sa.Column("dst_port", sa.Integer(), nullable=False),
        sa.Column("packet_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("byte_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fwd_packet_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fwd_byte_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("start_ts", sa.Float(), nullable=False, server_default="0"),
        sa.Column("end_ts", sa.Float(), nullable=False, server_default="0"),
        sa.Column("app_protocol", sa.String(32), nullable=True),
        sa.Column("flags_summary", sa.Text(), nullable=True),
        sa.Column("evidence_json", sa.Text(), nullable=True),
    )

    op.create_table(
        "analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        ),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("summary_markdown", sa.Text(), nullable=True),
        sa.Column("issues_json", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("analyses")
    op.drop_table("conversations")
    op.drop_table("captures")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS capturestatus")
