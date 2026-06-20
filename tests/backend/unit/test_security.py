"""Tests for app/core/security.py."""

import uuid
from datetime import datetime, timezone, timedelta

import pytest
from jose import JWTError, jwt
from fastapi import HTTPException

from app.core.security import (
    create_access_token,
    decode_access_token,
    get_jwt_from_cookie,
    set_jwt_cookie,
    clear_jwt_cookie,
)
from app.config import Settings


@pytest.fixture
def settings():
    return Settings(
        jwt_secret="test-secret-12345",
        jwt_algorithm="HS256",
        jwt_expire_minutes=60,
        public_base_url="http://localhost",
    )


class TestTokenCreation:
    def test_creates_token(self, settings, monkeypatch):
        monkeypatch.setattr("app.core.security.settings", settings)
        token = create_access_token(uuid.uuid4(), "testuser")
        assert isinstance(token, str)
        assert len(token) > 0

    def test_token_contains_claims(self, settings, monkeypatch):
        monkeypatch.setattr("app.core.security.settings", settings)
        user_id = uuid.uuid4()
        token = create_access_token(user_id, "testuser")
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        assert payload["sub"] == str(user_id)
        assert payload["login"] == "testuser"
        assert "iat" in payload
        assert "exp" in payload

    def test_token_expiry(self, settings, monkeypatch):
        monkeypatch.setattr("app.core.security.settings", settings)
        user_id = uuid.uuid4()
        token = create_access_token(user_id, "testuser")
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        # iat and exp are epoch timestamps; verify exp is iat + 3600 (60 minutes)
        assert payload["exp"] - payload["iat"] == 3600


class TestTokenDecoding:
    def test_decode_valid(self, settings, monkeypatch):
        monkeypatch.setattr("app.core.security.settings", settings)
        user_id = uuid.uuid4()
        token = create_access_token(user_id, "testuser")
        payload = decode_access_token(token)
        assert payload["sub"] == str(user_id)

    def test_decode_tampered(self, settings, monkeypatch):
        monkeypatch.setattr("app.core.security.settings", settings)
        user_id = uuid.uuid4()
        token = create_access_token(user_id, "testuser")
        tampered = token[:-5] + "xxxxx"
        with pytest.raises(JWTError):
            decode_access_token(tampered)

    def test_decode_wrong_secret(self, settings, monkeypatch):
        monkeypatch.setattr("app.core.security.settings", settings)
        user_id = uuid.uuid4()
        token = create_access_token(user_id, "testuser")
        # Try decoding with wrong secret
        with pytest.raises(JWTError):
            jwt.decode(token, "wrong-secret", algorithms=[settings.jwt_algorithm])

    def test_decode_expired(self, settings, monkeypatch):
        monkeypatch.setattr("app.core.security.settings", settings)
        # Create a token that is already expired
        now = datetime.now(timezone.utc)
        payload = {
            "sub": str(uuid.uuid4()),
            "login": "testuser",
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
        }
        token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        with pytest.raises(JWTError):
            decode_access_token(token)


class TestCookieHelpers:
    def test_get_jwt_from_cookie_present(self):
        from fastapi import Request
        from unittest.mock import MagicMock
        request = MagicMock()
        request.cookies = {"pcap_session": "my-token"}
        assert get_jwt_from_cookie(request) == "my-token"

    def test_get_jwt_from_cookie_missing(self):
        from unittest.mock import MagicMock
        from fastapi import Request
        request = MagicMock()
        request.cookies = {}
        assert get_jwt_from_cookie(request) is None

    def test_set_jwt_cookie(self, settings, monkeypatch):
        monkeypatch.setattr("app.core.security.settings", settings)
        from unittest.mock import MagicMock
        response = MagicMock()
        set_jwt_cookie(response, "my-token")
        response.set_cookie.assert_called_once()
        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["key"] == "pcap_session"
        assert call_kwargs["value"] == "my-token"
        assert call_kwargs["httponly"] is True
        assert call_kwargs["samesite"] == "lax"
        # cookie_secure defaults to True in production; the test fixture doesn't
        # override it, so the cookie is marked Secure.
        assert call_kwargs["secure"] is True

    def test_set_jwt_cookie_secure(self, monkeypatch):
        secure_settings = Settings(
            public_base_url="https://example.com",
            jwt_secret="test",
            jwt_expire_minutes=60,
            cookie_secure=True,
        )
        monkeypatch.setattr("app.core.security.settings", secure_settings)
        from unittest.mock import MagicMock
        response = MagicMock()
        set_jwt_cookie(response, "my-token")
        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["secure"] is True

    def test_set_jwt_cookie_insecure_flag(self, monkeypatch):
        """Explicit cookie_secure=False (e.g. behind a TLS-terminating proxy)."""
        insecure_settings = Settings(
            public_base_url="http://localhost",
            jwt_secret="test",
            jwt_expire_minutes=60,
            cookie_secure=False,
        )
        monkeypatch.setattr("app.core.security.settings", insecure_settings)
        from unittest.mock import MagicMock
        response = MagicMock()
        set_jwt_cookie(response, "my-token")
        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["secure"] is False

    def test_clear_jwt_cookie(self):
        from unittest.mock import MagicMock
        response = MagicMock()
        clear_jwt_cookie(response)
        response.delete_cookie.assert_called_once_with(key="pcap_session", path="/")
