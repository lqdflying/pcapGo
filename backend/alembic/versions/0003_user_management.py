"""User management: role column on users, allowed_users table

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.add_column(
        "users",
        sa.Column("role", sa.String(32), nullable=False, server_default="user"),
    )

    op.create_table(
        "allowed_users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("github_login", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False, server_default="user"),
        sa.Column("added_by", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_allowed_users_github_login_lower",
        "allowed_users",
        [sa.text("lower(github_login)")],
        unique=True,
    )

    # Migrate existing users into the allowlist so they aren't locked out.
    op.execute(
        """
        INSERT INTO allowed_users (id, github_login, role, added_by, created_at)
        SELECT gen_random_uuid(), login, 'user', NULL, now()
        FROM users
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("allowed_users")
    op.drop_column("users", "role")
