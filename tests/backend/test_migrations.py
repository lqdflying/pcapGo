"""Tests for Alembic migration 0001_initial."""

from pathlib import Path

import pytest
from sqlalchemy import inspect, text

from app.db.session import Base


@pytest.fixture
def alembic_cfg():
    """Get the Alembic configuration."""
    from alembic.config import Config
    root = Path(__file__).parent.parent.parent
    cfg = Config(str(root / "backend" / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "backend" / "alembic"))
    return cfg


class TestMigration0001:
    """Test the initial migration creates correct schema."""

    def test_migration_version_exists(self):
        """The migration file should exist."""
        root = Path(__file__).parent.parent.parent
        migration_path = root / "backend" / "alembic" / "versions" / "0001_initial.py"
        assert migration_path.exists()

    def test_model_tables_are_defined(self):
        """All expected tables should be in the model metadata."""
        table_names = set(Base.metadata.tables.keys())
        assert "users" in table_names
        assert "captures" in table_names
        assert "conversations" in table_names
        assert "analyses" in table_names

    def test_users_table_columns(self):
        """Users table should have all expected columns."""
        table = Base.metadata.tables["users"]
        column_names = {c.name for c in table.columns}
        expected = {
            "id",
            "github_id",
            "login",
            "email",
            "name",
            "avatar_url",
            "role",
            "created_at",
        }
        assert expected.issubset(column_names)

    def test_captures_table_columns(self):
        """Captures table should have all expected columns."""
        table = Base.metadata.tables["captures"]
        column_names = {c.name for c in table.columns}
        expected = {
            "id", "user_id", "filename", "size_bytes", "sha256",
            "linktype", "packet_count", "status", "stored_path",
            "parsed_index_path", "created_at",
        }
        assert expected.issubset(column_names)

    def test_conversations_table_columns(self):
        """Conversations table should have all expected columns."""
        table = Base.metadata.tables["conversations"]
        column_names = {c.name for c in table.columns}
        expected = {
            "id", "capture_id", "proto", "src_ip", "src_port",
            "dst_ip", "dst_port", "packet_count", "byte_count",
            "start_ts", "end_ts", "app_protocol", "flags_summary",
            "fwd_packet_count", "fwd_byte_count", "evidence_json",
        }
        assert expected.issubset(column_names)

    def test_analyses_table_columns(self):
        """Analyses table should have all expected columns."""
        table = Base.metadata.tables["analyses"]
        column_names = {c.name for c in table.columns}
        expected = {
            "id", "conversation_id", "model", "prompt_tokens",
            "completion_tokens", "summary_markdown", "issues_json", "created_at",
        }
        assert expected.issubset(column_names)

    def test_foreign_key_constraints(self):
        """Verify foreign key relationships are defined."""
        captures = Base.metadata.tables["captures"]
        fk_cols = [c.name for c in captures.columns if c.foreign_keys]
        assert "user_id" in fk_cols

        conversations = Base.metadata.tables["conversations"]
        fk_cols = [c.name for c in conversations.columns if c.foreign_keys]
        assert "capture_id" in fk_cols

        analyses = Base.metadata.tables["analyses"]
        fk_cols = [c.name for c in analyses.columns if c.foreign_keys]
        assert "conversation_id" in fk_cols

    @pytest.mark.asyncio
    async def test_upgrade_then_downgrade_roundtrip(self, alembic_cfg):
        """Run the real Alembic upgrade then downgrade against a scratch DB.

        This catches issues the metadata-only tests above cannot: column type
        mismatches, enum creation, missing DROP statements, etc.
        """
        from alembic import command
        from sqlalchemy.ext.asyncio import create_async_engine
        import os

        db_url = os.environ.get(
            "DATABASE_URL", "postgresql+asyncpg://pcap:pcap@localhost:5432/pcap_test"
        )
        # Use a dedicated scratch database suffix so we don't clobber the
        # main test DB tables managed by conftest.
        test_db_url = db_url.rsplit("/", 1)[0] + "/pcap_migration_test"
        # Admin URL points at an existing database (postgres) so we can issue
        # CREATE/DROP DATABASE outside a transaction.
        admin_url = db_url.rsplit("/", 1)[0] + "/postgres"

        admin_engine = create_async_engine(
            admin_url, echo=False, isolation_level="AUTOCOMMIT"
        )
        try:
            async with admin_engine.connect() as conn:
                await conn.exec_driver_sql(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = 'pcap_migration_test' AND pid <> pg_backend_pid()"
                )
                await conn.exec_driver_sql("DROP DATABASE IF EXISTS pcap_migration_test")
                await conn.exec_driver_sql("CREATE DATABASE pcap_migration_test")
        except Exception:
            await admin_engine.dispose()
            pytest.skip("Cannot create scratch database for migration test")

        await admin_engine.dispose()

        # Point alembic at the scratch DB (sync URL for alembic command).
        sync_url = test_db_url.replace("+asyncpg", "")
        alembic_cfg.set_main_option("sqlalchemy.url", sync_url)
        # backend/alembic/env.py reads DATABASE_URL and overrides the config URL,
        # so we must point the environment at the scratch DB too.
        original_database_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = test_db_url

        try:
            command.upgrade(alembic_cfg, "head")
            command.downgrade(alembic_cfg, "base")
        finally:
            # Restore the original DATABASE_URL for other tests.
            if original_database_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = original_database_url
            # Clean up the scratch database using autocommit admin connection.
            admin_engine = create_async_engine(
                admin_url, echo=False, isolation_level="AUTOCOMMIT"
            )
            async with admin_engine.connect() as conn:
                await conn.exec_driver_sql(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = 'pcap_migration_test' AND pid <> pg_backend_pid()"
                )
                await conn.exec_driver_sql("DROP DATABASE IF EXISTS pcap_migration_test")
            await admin_engine.dispose()

    def test_conversations_has_fwd_and_evidence_columns(self):
        """The conversations table must have fwd_* and evidence_json columns."""
        table = Base.metadata.tables["conversations"]
        column_names = {c.name for c in table.columns}
        assert "fwd_packet_count" in column_names
        assert "fwd_byte_count" in column_names
        assert "evidence_json" in column_names


class TestMigration0002:
    """The chat-threads migration must exist and define the chat tables."""

    def test_migration_version_exists(self):
        root = Path(__file__).parent.parent.parent
        migration_path = (
            root / "backend" / "alembic" / "versions" / "0002_chat_threads.py"
        )
        assert migration_path.exists()

    def test_chat_tables_defined_in_metadata(self):
        table_names = set(Base.metadata.tables.keys())
        assert "chat_threads" in table_names
        assert "chat_messages" in table_names

    def test_chat_threads_columns(self):
        table = Base.metadata.tables["chat_threads"]
        column_names = {c.name for c in table.columns}
        assert {"id", "capture_id", "title", "created_at"}.issubset(column_names)
        fk_cols = [c.name for c in table.columns if c.foreign_keys]
        assert "capture_id" in fk_cols

    def test_chat_messages_columns(self):
        table = Base.metadata.tables["chat_messages"]
        column_names = {c.name for c in table.columns}
        assert {"id", "thread_id", "role", "content", "created_at"}.issubset(
            column_names
        )
        fk_cols = [c.name for c in table.columns if c.foreign_keys]
        assert "thread_id" in fk_cols


class TestMigration0003:
    """The user-management migration must define roles and allowlist metadata."""

    def test_migration_version_exists(self):
        root = Path(__file__).parent.parent.parent
        migration_path = (
            root / "backend" / "alembic" / "versions" / "0003_user_management.py"
        )
        assert migration_path.exists()

    def test_allowed_users_table_defined_in_metadata(self):
        table_names = set(Base.metadata.tables.keys())
        assert "allowed_users" in table_names

    def test_allowed_users_columns(self):
        table = Base.metadata.tables["allowed_users"]
        column_names = {c.name for c in table.columns}
        assert {"id", "github_login", "role", "added_by", "created_at"}.issubset(
            column_names
        )

    def test_users_role_column(self):
        table = Base.metadata.tables["users"]
        assert "role" in {c.name for c in table.columns}

    def test_allowed_users_lower_login_unique_index(self):
        table = Base.metadata.tables["allowed_users"]
        indexes = {idx.name: idx for idx in table.indexes}
        index = indexes.get("ix_allowed_users_github_login_lower")
        assert index is not None
        assert index.unique is True
        assert "lower" in str(index.expressions[0]).lower()
