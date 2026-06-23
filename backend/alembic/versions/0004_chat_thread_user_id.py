"""Add user_id and updated_at to chat_threads for session management

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-23
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_threads",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "chat_threads",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.execute(
        """
        UPDATE chat_threads
        SET user_id = captures.user_id
        FROM captures
        WHERE chat_threads.capture_id = captures.id
          AND chat_threads.user_id IS NULL
        """
    )

    op.alter_column("chat_threads", "user_id", nullable=False)

    op.create_foreign_key(
        "fk_chat_threads_user_id",
        "chat_threads",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_chat_threads_user_id", "chat_threads", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_threads_user_id", table_name="chat_threads")
    op.drop_constraint("fk_chat_threads_user_id", "chat_threads", type_="foreignkey")
    op.drop_column("chat_threads", "updated_at")
    op.drop_column("chat_threads", "user_id")
