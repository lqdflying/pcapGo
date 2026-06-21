"""Integration tests for admin user management and allowlist enforcement."""

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@pytest.mark.integration
class TestAdminUsers:
    async def test_non_admin_cannot_list_users(self, test_client_authenticated):
        response = await test_client_authenticated.get("/api/admin/users")
        assert response.status_code == 403

    async def test_admin_can_list_allowed_users(self, test_client_admin):
        response = await test_client_admin.get("/api/admin/users")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] >= 1
        assert any(u["github_login"] == test_client_admin._auth_user.login for u in body["users"])

    async def test_admin_can_add_user(self, test_client_admin):
        response = await test_client_admin.post(
            "/api/admin/users",
            json={"github_login": "new-person", "role": "user"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["github_login"] == "new-person"
        assert body["role"] == "user"
        assert body["added_by"] == test_client_admin._auth_user.login
        assert body["has_logged_in"] is False

    async def test_admin_cannot_add_duplicate_case_insensitive(self, test_client_admin):
        first = await test_client_admin.post(
            "/api/admin/users",
            json={"github_login": "OctoCat", "role": "user"},
        )
        assert first.status_code == 201

        second = await test_client_admin.post(
            "/api/admin/users",
            json={"github_login": "octocat", "role": "user"},
        )
        assert second.status_code == 409

    async def test_admin_can_delete_non_seed_user(self, test_client_admin):
        created = await test_client_admin.post(
            "/api/admin/users",
            json={"github_login": "delete-me", "role": "user"},
        )
        assert created.status_code == 201

        deleted = await test_client_admin.delete("/api/admin/users/delete-me")
        assert deleted.status_code == 204

        deleted_again = await test_client_admin.delete("/api/admin/users/delete-me")
        assert deleted_again.status_code == 404

    async def test_seed_admin_cannot_be_deleted(self, test_client_admin, monkeypatch):
        import app.config

        monkeypatch.setattr(app.config.settings, "admin_github_user", test_client_admin._auth_user.login)
        response = await test_client_admin.delete(
            f"/api/admin/users/{test_client_admin._auth_user.login}"
        )
        assert response.status_code == 403

    async def test_seed_admin_role_cannot_be_modified(self, test_client_admin, monkeypatch):
        import app.config

        monkeypatch.setattr(app.config.settings, "admin_github_user", test_client_admin._auth_user.login)
        response = await test_client_admin.patch(
            f"/api/admin/users/{test_client_admin._auth_user.login}",
            json={"github_login": test_client_admin._auth_user.login, "role": "user"},
        )
        assert response.status_code == 403

    async def test_role_update_syncs_existing_user(
        self, test_client_admin, _session_engine
    ):
        from app.models import User
        from tests.backend.conftest import _make_allowed_user, _make_user_async

        user = await _make_user_async(
            _session_engine,
            {
                "id": uuid.uuid4(),
                "github_id": 771001,
                "login": "promote-me",
                "email": "promote@example.com",
                "name": "Promote Me",
                "avatar_url": "https://avatar.example.com/promote.png",
                "role": "user",
            },
        )
        await _make_allowed_user(
            _session_engine,
            {"github_login": user.login, "role": "user", "added_by": "admin"},
        )

        response = await test_client_admin.patch(
            "/api/admin/users/promote-me",
            json={"github_login": "promote-me", "role": "super_admin"},
        )
        assert response.status_code == 200
        assert response.json()["has_logged_in"] is True

        factory = async_sessionmaker(_session_engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as session:
            db_user = await session.get(User, user.id)
            assert db_user.role == "super_admin"


@pytest.mark.integration
class TestAllowlistEnforcement:
    async def test_auth_me_rejects_removed_allowed_user(
        self, test_client, auth_headers, auth_user, _session_engine
    ):
        from app.models import AllowedUser

        factory = async_sessionmaker(_session_engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as session:
            result = await session.execute(
                select(AllowedUser).where(
                    func.lower(AllowedUser.github_login) == func.lower(auth_user.login)
                )
            )
            await session.delete(result.scalar_one())
            await session.commit()

        response = await test_client.get("/auth/me", headers=auth_headers)
        assert response.status_code == 401

    async def test_auth_me_syncs_role_from_allowlist(
        self, test_client, auth_headers, auth_user, _session_engine
    ):
        from app.models import AllowedUser, User

        factory = async_sessionmaker(_session_engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as session:
            result = await session.execute(
                select(AllowedUser).where(
                    func.lower(AllowedUser.github_login) == func.lower(auth_user.login)
                )
            )
            allowed = result.scalar_one()
            allowed.role = "super_admin"
            await session.commit()

        response = await test_client.get("/auth/me", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["role"] == "super_admin"

        async with factory() as session:
            db_user = await session.get(User, auth_user.id)
            assert db_user.role == "super_admin"

    async def test_seed_admin_startup_repairs_existing_user(
        self, monkeypatch, _session_engine
    ):
        import app.config
        from app.main import _ensure_seed_admin
        from app.models import AllowedUser, User
        from tests.backend.conftest import _make_allowed_user, _make_user_async

        user = await _make_user_async(
            _session_engine,
            {
                "id": uuid.uuid4(),
                "github_id": 771002,
                "login": "seed-admin",
                "email": "seed@example.com",
                "name": "Seed Admin",
                "avatar_url": "https://avatar.example.com/seed.png",
                "role": "user",
            },
        )
        await _make_allowed_user(
            _session_engine,
            {"github_login": "seed-admin", "role": "user", "added_by": "someone"},
        )
        monkeypatch.setattr(app.config.settings, "admin_github_user", "seed-admin")

        await _ensure_seed_admin()

        factory = async_sessionmaker(_session_engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as session:
            db_user = await session.get(User, user.id)
            assert db_user.role == "super_admin"
            result = await session.execute(
                select(AllowedUser).where(AllowedUser.github_login == "seed-admin")
            )
            assert result.scalar_one().role == "super_admin"


@pytest.mark.integration
class TestAdminCaptureAccess:
    async def test_admin_can_list_all_captures_with_owner_filter(
        self, test_client_admin, _session_engine
    ):
        from app.models import CaptureStatus
        from tests.backend.conftest import _make_capture_async, _make_user_async

        owner = await _make_user_async(
            _session_engine,
            {
                "id": uuid.uuid4(),
                "github_id": 771003,
                "login": "capture-owner",
                "email": "owner@example.com",
                "name": "Capture Owner",
                "avatar_url": "https://avatar.example.com/owner.png",
                "role": "user",
            },
        )
        capture = await _make_capture_async(
            _session_engine,
            {
                "id": uuid.uuid4(),
                "user_id": owner.id,
                "filename": "owner-capture.pcap",
                "size_bytes": 1024,
                "sha256": "c" * 64,
                "linktype": 1,
                "packet_count": 3,
                "status": CaptureStatus.ready,
                "stored_path": "/tmp/owner-capture.pcap",
                "parsed_index_path": "/tmp/owner-capture.index.json",
            },
        )

        response = await test_client_admin.get("/api/captures?all=true&owner=capture-owner")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["captures"][0]["id"] == str(capture.id)
        assert body["captures"][0]["owner_login"] == "capture-owner"
