"""Tests for app.config settings."""

from pathlib import Path
import pytest
from app.config import Settings


# These env vars are set by the root conftest so the module-level Settings()
# can bootstrap. Strip them here so each test observes clean defaults.
_SECRET_ENV_VARS = ["JWT_SECRET", "DEV_MODE", "SESSION_SECRET", "DATABASE_URL"]


@pytest.fixture(autouse=True)
def _clean_secret_env(monkeypatch):
    for var in _SECRET_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


class TestSettings:
    """Test Settings class configuration."""

    def test_defaults(self, monkeypatch):
        """Settings should load sensible defaults."""
        s = Settings(dev_mode=True)
        assert s.database_url == "postgresql+asyncpg://pcap:pcap@localhost:5432/pcap"
        assert s.max_upload_mb == 100
        assert s.jwt_algorithm == "HS256"
        assert s.jwt_expire_minutes == 1440
        assert s.jwt_secret == "change-me-in-production"

    def test_max_upload_bytes(self):
        """Computed property max_upload_bytes should be max_upload_mb * 1024 * 1024."""
        s = Settings(max_upload_mb=1, dev_mode=True)
        assert s.max_upload_bytes == 1 * 1024 * 1024

        s2 = Settings(max_upload_mb=100, dev_mode=True)
        assert s2.max_upload_bytes == 100 * 1024 * 1024

        s3 = Settings(max_upload_mb=0, dev_mode=True)
        assert s3.max_upload_bytes == 0

    def test_custom_values(self):
        """Settings should accept custom values."""
        s = Settings(
            database_url="postgresql+asyncpg://user:pw@host:5432/db",
            jwt_secret="a" * 32,
            max_upload_mb=50,
            public_base_url="https://example.com",
        )
        assert s.database_url == "postgresql+asyncpg://user:pw@host:5432/db"
        assert s.jwt_secret == "a" * 32
        assert s.max_upload_bytes == 50 * 1024 * 1024
        assert s.public_base_url == "https://example.com"

    def test_extra_ignore(self):
        """Settings should ignore unknown fields per extra='ignore'."""
        s = Settings(dev_mode=True)
        assert "extra" in s.model_config

    def test_upload_dir_is_path(self):
        """upload_dir should be a Path object."""
        s = Settings(dev_mode=True)
        assert isinstance(s.upload_dir, Path)

    def test_custom_upload_dir(self):
        """Custom upload_dir should work."""
        s = Settings(upload_dir=Path("/custom/uploads"), dev_mode=True)
        assert s.upload_dir == Path("/custom/uploads")

    def test_github_oauth_defaults(self):
        """GitHub OAuth fields default to empty/insecure values."""
        s = Settings(dev_mode=True)
        assert s.github_client_id == ""
        assert s.github_client_secret == ""
        assert s.github_oauth_redirect_url == "http://localhost/auth/github/callback"


class TestSecretValidator:
    """Verify the production secret validator (Phase 1.2)."""

    def test_rejects_default_secret(self):
        with pytest.raises(ValueError, match="JWT_SECRET"):
            Settings(jwt_secret="change-me-in-production")

    def test_rejects_empty_secret(self):
        with pytest.raises(ValueError, match="JWT_SECRET"):
            Settings(jwt_secret="")

    def test_rejects_change_me(self):
        with pytest.raises(ValueError, match="JWT_SECRET"):
            Settings(jwt_secret="CHANGE_ME")

    def test_rejects_documented_placeholder(self):
        """The CHANGE_ME_TO_A_RANDOM_SECRET placeholder from tests/.env.example
        must be rejected in production."""
        with pytest.raises(ValueError, match="JWT_SECRET"):
            Settings(jwt_secret="CHANGE_ME_TO_A_RANDOM_SECRET")

    def test_rejects_short_secret(self):
        """Secrets shorter than 32 characters are rejected in production."""
        with pytest.raises(ValueError, match="JWT_SECRET"):
            Settings(jwt_secret="a" * 31)

    def test_accepts_strong_secret(self):
        s = Settings(jwt_secret="a" * 32)
        assert s.jwt_secret == "a" * 32

    def test_dev_mode_skips_validation(self):
        """dev_mode=True must allow insecure defaults for local/test use."""
        s = Settings(dev_mode=True)
        assert s.jwt_secret == "change-me-in-production"

    def test_effective_session_secret_explicit(self):
        s = Settings(jwt_secret="a" * 32, session_secret="b" * 32)
        assert s.effective_session_secret == "b" * 32

    def test_effective_session_secret_falls_back(self):
        s = Settings(jwt_secret="a" * 32, session_secret="")
        assert s.effective_session_secret == "a" * 32

    def test_rejects_test_secret_in_production(self):
        with pytest.raises(ValueError, match="JWT_SECRET"):
            Settings(jwt_secret="test-secret")

    def test_rejects_session_secret_insecure_values(self):
        """Insecure session_secret falls back to jwt_secret instead of being used raw."""
        s = Settings(jwt_secret="a" * 32, session_secret="change-me-in-production")
        assert s.effective_session_secret == "a" * 32

    def test_rejects_short_session_secret_in_production(self):
        """An explicitly set SESSION_SECRET must be at least 32 characters."""
        with pytest.raises(ValueError, match="SESSION_SECRET"):
            Settings(jwt_secret="a" * 32, session_secret="b" * 31)

    def test_accepts_strong_session_secret(self):
        s = Settings(jwt_secret="a" * 32, session_secret="b" * 32)
        assert s.effective_session_secret == "b" * 32
