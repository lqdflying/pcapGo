from __future__ import annotations

from pathlib import Path
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Values that must never be used as secrets in a non-dev deployment.
_INSECURE_SECRETS = {
    "",
    "change-me-in-production",
    "CHANGE_ME",
    "CHANGE_ME_TO_A_RANDOM_SECRET",
    "test-secret",
    "test-session-secret",
}
_MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Database
    database_url: str = "postgresql+asyncpg://pcap:pcap@localhost:5432/pcap"

    # GitHub OAuth
    github_client_id: str = ""
    github_client_secret: str = ""
    github_oauth_redirect_url: str = "http://localhost/auth/github/callback"

    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours

    # LLM
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_api_key: str = ""
    llm_model: str = "deepseek-chat"

    # App
    public_base_url: str = "http://localhost"
    max_upload_mb: int = 100
    upload_dir: Path = Path("uploads")

    # Security knobs
    # When True, the secret/cookie validators below are skipped. Intended for
    # local development and the test suite. Production must set dev_mode=False
    # (the default) and provide real secrets.
    dev_mode: bool = False
    # Explicit cookie Secure flag. Defaults to True; set False only behind a
    # TLS-terminating proxy when you know what you're doing.
    cookie_secure: bool = True
    # Separate secret for Starlette SessionMiddleware (OAuth state cookies).
    # If empty, falls back to jwt_secret (dev only).
    session_secret: str = ""

    # User management
    admin_github_user: str = ""

    # GeoIP
    geoip_db_path: Path = Path("data/GeoLite2-Country.mmdb")

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @model_validator(mode="after")
    def _check_secrets(self) -> "Settings":
        if self.dev_mode:
            return self
        if self.jwt_secret in _INSECURE_SECRETS:
            raise ValueError(
                "JWT_SECRET must be set to a strong random value in production "
                "(set dev_mode=true only for local development)."
            )
        if len(self.jwt_secret) < _MIN_SECRET_LENGTH:
            raise ValueError(
                f"JWT_SECRET must be at least {_MIN_SECRET_LENGTH} characters "
                f"in production (generate one with: openssl rand -hex 32)."
            )
        # SESSION_SECRET is optional; when empty it falls back to jwt_secret.
        # If it is explicitly set, it must also be strong.
        if (
            self.session_secret
            and self.session_secret not in _INSECURE_SECRETS
            and len(self.session_secret) < _MIN_SECRET_LENGTH
        ):
            raise ValueError(
                f"SESSION_SECRET must be at least {_MIN_SECRET_LENGTH} characters "
                f"in production when explicitly set."
            )
        return self

    @property
    def effective_session_secret(self) -> str:
        """Secret for SessionMiddleware, falling back to jwt_secret in dev."""
        if self.session_secret and self.session_secret not in _INSECURE_SECRETS:
            return self.session_secret
        return self.jwt_secret


settings = Settings()
