"""Integration tests for /auth endpoints: /me and /logout."""

import pytest
from sqlalchemy import select


@pytest.mark.integration
class TestGitHubLogin:
    """Tests for GET /auth/github/login."""

    async def test_redirect_status(self, test_client):
        response = await test_client.get("/auth/github/login", follow_redirects=False)
        assert response.status_code == 302

    async def test_redirect_location_is_github(self, test_client):
        response = await test_client.get("/auth/github/login", follow_redirects=False)
        assert "github.com" in response.headers["location"]

    async def test_redirect_location_has_client_id(self, test_client):
        response = await test_client.get("/auth/github/login", follow_redirects=False)
        assert "test-client-id" in response.headers["location"]


@pytest.mark.integration
class TestGitHubLoginNextValidation:
    """Tests for the ?next= deep-link preservation through OAuth."""

    async def test_valid_next_stored_in_session(self, test_client):
        """A valid relative ?next= path is accepted."""
        response = await test_client.get(
            "/auth/github/login?next=/captures/abc", follow_redirects=False
        )
        assert response.status_code == 302

    async def test_protocol_relative_next_rejected(self, test_client):
        """//evil.com is rejected (no open-redirect via protocol-relative)."""
        from app.api.auth import _validate_next
        assert _validate_next("//evil.com/path") is None

    async def test_absolute_url_next_rejected(self):
        from app.api.auth import _validate_next
        assert _validate_next("https://evil.com/path") is None
        assert _validate_next("javascript:alert(1)") is None

    async def test_none_next_rejected(self):
        from app.api.auth import _validate_next
        assert _validate_next(None) is None
        assert _validate_next("") is None

    async def test_valid_relative_next_accepted(self):
        from app.api.auth import _validate_next
        assert _validate_next("/") == "/"
        assert _validate_next("/captures/abc") == "/captures/abc"


@pytest.mark.integration
class TestGitHubCallbackAllowlist:
    async def test_rejects_user_not_in_allowlist(self, test_client, monkeypatch):
        import app.api.auth

        async def fake_authorize_access_token(request):
            return {"access_token": "token"}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "id": 111,
                    "login": "not-allowed",
                    "email": "not@example.com",
                    "name": "Not Allowed",
                    "avatar_url": "https://avatar.example.com/not.png",
                }

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, *args, **kwargs):
                return FakeResponse()

        monkeypatch.setattr(
            app.api.auth.oauth.github,
            "authorize_access_token",
            fake_authorize_access_token,
        )
        monkeypatch.setattr(app.api.auth, "AsyncClient", FakeClient)

        response = await test_client.get("/auth/github/callback", follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == "/login?auth_error=not_allowed"

    async def test_allows_and_syncs_allowlisted_role(
        self, test_client, monkeypatch, _session_engine
    ):
        import app.api.auth
        from app.models import User
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
        from tests.backend.conftest import _make_allowed_user

        await _make_allowed_user(
            _session_engine,
            {"github_login": "allowed-admin", "role": "super_admin", "added_by": None},
        )

        async def fake_authorize_access_token(request):
            return {"access_token": "token"}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "id": 112,
                    "login": "allowed-admin",
                    "email": "allowed@example.com",
                    "name": "Allowed Admin",
                    "avatar_url": "https://avatar.example.com/allowed.png",
                }

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, *args, **kwargs):
                return FakeResponse()

        monkeypatch.setattr(
            app.api.auth.oauth.github,
            "authorize_access_token",
            fake_authorize_access_token,
        )
        monkeypatch.setattr(app.api.auth, "AsyncClient", FakeClient)

        response = await test_client.get("/auth/github/callback", follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == "/"
        assert "pcap_session=" in response.headers.get("set-cookie", "")

        factory = async_sessionmaker(_session_engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as session:
            result = await session.execute(select(User).where(User.github_id == 112))
            assert result.scalar_one().role == "super_admin"


@pytest.mark.integration
class TestAuthMe:
    """Tests for GET /auth/me with cookie-based authentication."""

    async def test_returns_user_with_valid_auth(self, test_client, auth_headers, auth_user):
        response = await test_client.get("/auth/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["login"] == auth_user.login
        assert data["id"] == str(auth_user.id)

    async def test_unauthorized_without_cookie(self, test_client):
        response = await test_client.get("/auth/me")
        assert response.status_code == 401

    async def test_tampered_token_returns_401(self, test_client):
        response = await test_client.get(
            "/auth/me",
            headers={"Cookie": "pcap_session=not.a.valid.token"},
        )
        assert response.status_code == 401

    async def test_invalid_token_format_returns_401(self, test_client):
        response = await test_client.get(
            "/auth/me",
            headers={"Cookie": "pcap_session=invalid"},
        )
        assert response.status_code == 401

    async def test_empty_token_returns_401(self, test_client):
        response = await test_client.get(
            "/auth/me",
            headers={"Cookie": "pcap_session="},
        )
        assert response.status_code == 401

    async def test_expired_token_returns_401(self, test_client):
        from datetime import datetime, timezone, timedelta
        from jose import jwt

        expired = jwt.encode(
            {
                "sub": "00000000-0000-0000-0000-000000000000",
                "login": "expired",
                "iat": datetime.now(timezone.utc) - timedelta(hours=2),
                "exp": datetime.now(timezone.utc) - timedelta(hours=1),
            },
            "test-secret",
            algorithm="HS256",
        )
        response = await test_client.get(
            "/auth/me",
            headers={"Cookie": f"pcap_session={expired}"},
        )
        assert response.status_code == 401


@pytest.mark.integration
class TestAuthMeAuthenticated:
    """Tests for GET /auth/me using authenticated test client (dependency override)."""

    async def test_returns_user_without_cookie(self, test_client_authenticated):
        response = await test_client_authenticated.get("/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["login"] == test_client_authenticated._auth_user.login

    async def test_response_fields(self, test_client_authenticated):
        response = await test_client_authenticated.get("/auth/me")
        assert response.status_code == 200
        data = response.json()
        for field in ("id", "login", "email", "name", "avatar_url", "created_at"):
            assert field in data, f"Missing field: {field}"

    async def test_user_id_is_valid_uuid(self, test_client_authenticated):
        response = await test_client_authenticated.get("/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(test_client_authenticated._auth_user.id)

    async def test_created_at_is_iso_datetime(self, test_client_authenticated):
        response = await test_client_authenticated.get("/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert "T" in data["created_at"] or "+" in data["created_at"]


@pytest.mark.integration
class TestLogout:
    """Tests for POST /auth/logout."""

    async def test_returns_status_ok(self, test_client, auth_headers):
        response = await test_client.post("/auth/logout", headers=auth_headers)
        assert response.status_code == 200

    async def test_returns_expected_message(self, test_client, auth_headers):
        response = await test_client.post("/auth/logout", headers=auth_headers)
        data = response.json()
        assert data == {"message": "logged out"}

    async def test_clears_session_cookie(self, test_client, auth_headers):
        response = await test_client.post("/auth/logout", headers=auth_headers)
        set_cookie = response.headers.get("set-cookie", "")
        # The cookie should be cleared (empty value or max-age=0)
        assert "pcap_session=" in set_cookie or "Max-Age=0" in set_cookie


@pytest.mark.integration
class TestOAuthUserUpsert:
    """Verify the race-safe _upsert_user helper (Phase 1.5)."""

    async def test_inserts_new_user(self, db_session):
        from app.api.auth import _upsert_user
        from app.models import User
        from sqlalchemy import select

        user = await _upsert_user(
            github_id=12345,
            login="alice",
            email="alice@example.com",
            name="Alice",
            avatar_url="https://example.com/a.png",
        )
        assert user.login == "alice"

        result = await db_session.execute(select(User).where(User.github_id == 12345))
        persisted = result.scalar_one()
        assert persisted.login == "alice"
        assert persisted.email == "alice@example.com"

    async def test_updates_existing_user_on_conflict(self, db_session):
        """Second call with the same github_id must update rather than 500."""
        from app.api.auth import _upsert_user
        from app.models import User
        from sqlalchemy import select

        await _upsert_user(
            github_id=67890,
            login="bob-old",
            email="bob-old@example.com",
            name="Bob",
            avatar_url="https://example.com/old.png",
        )
        # Simulate the race: concurrent first login, second call updates fields.
        updated = await _upsert_user(
            github_id=67890,
            login="bob-new",
            email="bob-new@example.com",
            name="Bob New",
            avatar_url="https://example.com/new.png",
        )
        assert updated.login == "bob-new"
        assert updated.email == "bob-new@example.com"

        result = await db_session.execute(select(User).where(User.github_id == 67890))
        rows = result.scalars().all()
        assert len(rows) == 1, "ON CONFLICT must not duplicate the user"
