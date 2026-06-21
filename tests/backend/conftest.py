"""Shared fixtures for the pcapGo backend tests.

Runs against PostgreSQL (pcap_test database).  DATABASE_URL is set via env var
before any app imports so app.db.session naturally points at the test DB.

All fixtures are async, session-scoped engine shared between app and fixtures.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # project root

import os
# Use setdefault so a developer can override the test DB via the environment.
# Both the bootstrap env var and the session engine derive from this single
# value (previously the URL was hardcoded in two places).
_DEFAULT_TEST_DB = "postgresql+asyncpg://pcap:pcap@localhost:5432/pcap_test"
os.environ.setdefault("DATABASE_URL", _DEFAULT_TEST_DB)
# Allow insecure defaults while the test process is bootstrapping — the autouse
# _patch_settings fixture below then pins the real values used by each test.
os.environ.setdefault("DEV_MODE", "true")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("SESSION_SECRET", "test-session-secret")

import uuid
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
import httpx
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_counter = 0


# ---------------------------------------------------------------------------
# Settings patch
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _patch_settings(monkeypatch):
    import app.config
    monkeypatch.setattr(app.config.settings, "upload_dir", Path("/tmp/pcap_test_uploads"))
    monkeypatch.setattr(app.config.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(app.config.settings, "jwt_algorithm", "HS256")
    monkeypatch.setattr(app.config.settings, "jwt_expire_minutes", 60)
    monkeypatch.setattr(app.config.settings, "llm_api_key", "")
    monkeypatch.setattr(app.config.settings, "llm_base_url", "https://api.example.com/v1")
    monkeypatch.setattr(app.config.settings, "llm_model", "test-model")
    monkeypatch.setattr(app.config.settings, "github_client_id", "test-client-id")
    monkeypatch.setattr(app.config.settings, "github_client_secret", "test-client-secret")
    monkeypatch.setattr(app.config.settings, "public_base_url", "http://localhost")
    monkeypatch.setattr(app.config.settings, "max_upload_mb", 100)
    monkeypatch.setattr(app.config.settings, "dev_mode", True)
    monkeypatch.setattr(app.config.settings, "cookie_secure", False)
    monkeypatch.setattr(app.config.settings, "session_secret", "test-session-secret")
    monkeypatch.setattr(app.config.settings, "admin_github_user", "test-admin")
    Path("/tmp/pcap_test_uploads").mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Mock parse_pcap
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _mock_parse_pcap(monkeypatch):
    async def _noop(capture_id: str):
        pass
    monkeypatch.setattr("app.api.uploads.parse_pcap", _noop)


# ---------------------------------------------------------------------------
# Database — session-scoped engine shared by app AND fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _session_engine():
    """Session-scoped async PostgreSQL engine. Patches app.db.session."""
    import app.db.session as app_db

    PG_URL = os.environ.get("DATABASE_URL", _DEFAULT_TEST_DB)
    engine = create_async_engine(PG_URL, echo=False)

    original_engine = app_db.engine
    original_sessionmaker = app_db.async_session
    app_db.engine = engine
    app_db.async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    yield engine

    app_db.engine = original_engine
    app_db.async_session = original_sessionmaker
    await engine.dispose()


@pytest_asyncio.fixture(scope="session", autouse=True, loop_scope="session")
async def _session_create_tables(_session_engine):
    """Create all tables once at session start; drop at session end."""
    from app.db.session import Base
    import app.models  # noqa: F401

    async with _session_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    async with _session_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def _delete_all(_session_engine):
    """DELETE all rows before each test for isolation."""
    from app.db.session import Base
    import app.models  # noqa: F401
    async with _session_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(sa_text(f"DELETE FROM {table.name}"))
    yield


# ---------------------------------------------------------------------------
# DB session for model/unit tests
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def db_session(_session_engine):
    """Yield an async SQLAlchemy session for model tests."""
    factory = async_sessionmaker(_session_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


# ---------------------------------------------------------------------------
# Test client — httpx AsyncClient
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def test_client(_delete_all):
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        client._app = app
        yield client


@pytest_asyncio.fixture
async def test_client_authenticated(test_client, auth_user):
    """Test client with get_current_user overridden for auth_user."""
    from app.core.security import get_current_user

    async def override_get_current_user(request=None):
        return auth_user

    app = test_client._app
    app.dependency_overrides[get_current_user] = override_get_current_user
    test_client._auth_user = auth_user
    yield test_client
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

async def _make_user(engine, data: dict[str, Any]) -> Any:
    from app.models import User
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        user = User(**data)
        s.add(user)
        await s.commit()
        await s.refresh(user)
        return user


async def _make_capture(engine, data: dict[str, Any]) -> Any:
    from app.models import Capture
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        capture = Capture(**data)
        s.add(capture)
        await s.commit()
        await s.refresh(capture)
        return capture


async def _make_conversation(engine, data: dict[str, Any]) -> Any:
    from app.models import Conversation
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        conv = Conversation(**data)
        s.add(conv)
        await s.commit()
        await s.refresh(conv)
        return conv


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def auth_user_data() -> dict[str, Any]:
    global _counter
    _counter += 1
    from datetime import datetime, timezone
    return {
        "id": uuid.uuid4(),
        "github_id": 90000 + _counter,
        "login": f"testuser{_counter}",
        "email": f"test{_counter}@example.com",
        "name": f"Test User {_counter}",
        "avatar_url": f"https://avatar.example.com/{_counter}.png",
        "created_at": datetime.now(timezone.utc),
    }


@pytest_asyncio.fixture
async def auth_user(_session_engine, auth_user_data):
    return await _make_user(_session_engine, auth_user_data)


@pytest.fixture
def auth_token(auth_user):
    from datetime import datetime, timezone, timedelta
    from jose import jwt
    payload = {
        "sub": str(auth_user.id),
        "login": auth_user.login,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
    }
    return jwt.encode(payload, "test-secret", algorithm="HS256")


@pytest.fixture
def auth_headers(auth_token) -> dict[str, str]:
    return {"Cookie": f"pcap_session={auth_token}"}


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def test_capture(_session_engine, auth_user) -> "Capture":
    from app.models import CaptureStatus
    return await _make_capture(
        _session_engine,
        {
            "id": uuid.uuid4(),
            "user_id": auth_user.id,
            "filename": "test.pcap",
            "size_bytes": 1024,
            "sha256": "a" * 64,
            "linktype": 1,
            "packet_count": 10,
            "status": CaptureStatus.ready,
            "stored_path": "/tmp/test.pcap",
            "parsed_index_path": "/tmp/test.index.json",
        },
    )


@pytest_asyncio.fixture
async def test_conversation(_session_engine, test_capture) -> "Conversation":
    return await _make_conversation(
        _session_engine,
        {
            "id": uuid.uuid4(),
            "capture_id": test_capture.id,
            "proto": "tcp",
            "src_ip": "10.0.0.1",
            "src_port": 443,
            "dst_ip": "10.0.0.2",
            "dst_port": 54321,
            "packet_count": 5,
            "byte_count": 1000,
            "fwd_packet_count": 3,
            "fwd_byte_count": 600,
            "start_ts": 0.0,
            "end_ts": 1.0,
            "app_protocol": "TLS",
            "flags_summary": "SYN,ACK",
        },
    )


async def _make_allowed_user(engine, data: dict[str, Any]) -> Any:
    from app.models import AllowedUser
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        au = AllowedUser(**data)
        s.add(au)
        await s.commit()
        await s.refresh(au)
        return au


@pytest.fixture
def admin_user_data() -> dict[str, Any]:
    global _counter
    _counter += 1
    from datetime import datetime, timezone
    return {
        "id": uuid.uuid4(),
        "github_id": 80000 + _counter,
        "login": f"admin{_counter}",
        "email": f"admin{_counter}@example.com",
        "name": f"Admin {_counter}",
        "avatar_url": f"https://avatar.example.com/admin{_counter}.png",
        "role": "super_admin",
        "created_at": datetime.now(timezone.utc),
    }


@pytest_asyncio.fixture
async def admin_user(_session_engine, admin_user_data):
    return await _make_user(_session_engine, admin_user_data)


@pytest_asyncio.fixture
async def test_client_admin(test_client, admin_user):
    """Test client with get_current_user overridden for an admin user."""
    from app.core.security import get_current_user

    async def override_get_current_user(request=None):
        return admin_user

    app = test_client._app
    app.dependency_overrides[get_current_user] = override_get_current_user
    test_client._auth_user = admin_user
    yield test_client
    app.dependency_overrides.clear()


# Backwards-compat aliases
_make_user_async = _make_user
_make_capture_async = _make_capture
_make_conversation_async = _make_conversation
