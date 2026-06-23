"""Integration tests for the AI chat thread/message endpoints."""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest


@pytest.fixture
def _llm_enabled(monkeypatch):
    import app.config
    monkeypatch.setattr(app.config.settings, "llm_api_key", "sk-test")


def _fake_stream_factory(*deltas, raise_after=False):
    async def _gen(context, history, question):
        for d in deltas:
            yield d
        if raise_after:
            raise RuntimeError("boom")
    return _gen


@pytest.mark.integration
class TestThreadCrud:
    async def test_create_list_get_delete(self, test_client_authenticated, test_capture):
        # create
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={"title": "My chat"}
        )
        assert r.status_code == 200
        tid = r.json()["id"]
        assert r.json()["title"] == "My chat"

        # list
        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/threads"
        )
        assert r.status_code == 200
        assert any(t["id"] == tid for t in r.json())

        # get
        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/threads/{tid}"
        )
        assert r.status_code == 200
        assert r.json()["messages"] == []

        # delete
        r = await test_client_authenticated.delete(
            f"/api/captures/{test_capture.id}/threads/{tid}"
        )
        assert r.status_code == 200
        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/threads/{tid}"
        )
        assert r.status_code == 404

    async def test_thread_for_unknown_capture_404(self, test_client_authenticated):
        r = await test_client_authenticated.post(
            f"/api/captures/{uuid.uuid4()}/threads", json={}
        )
        assert r.status_code == 404

    async def test_requires_auth(self, test_client, test_capture):
        r = await test_client.get(f"/api/captures/{test_capture.id}/threads")
        assert r.status_code in (401, 403)

    async def test_batch_delete_removes_selected_threads(
        self, test_client_authenticated, test_capture
    ):
        first = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={"title": "First"}
        )
        second = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={"title": "Second"}
        )
        third = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={"title": "Third"}
        )
        ids = [first.json()["id"], second.json()["id"]]

        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads/batch-delete",
            json={"thread_ids": ids},
        )

        assert r.status_code == 200
        assert r.json() == {"deleted": 2}
        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/threads"
        )
        remaining_ids = {thread["id"] for thread in r.json()}
        assert remaining_ids == {third.json()["id"]}

    async def test_batch_delete_rejects_empty_payload(
        self, test_client_authenticated, test_capture
    ):
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads/batch-delete",
            json={"thread_ids": []},
        )

        assert r.status_code == 422

    async def test_batch_delete_is_scoped_to_capture(
        self, test_client_authenticated, test_capture, _session_engine, auth_user
    ):
        from tests.backend.conftest import _make_capture_async
        from app.models import CaptureStatus

        other_capture = await _make_capture_async(
            _session_engine,
            {
                "id": uuid.uuid4(),
                "user_id": auth_user.id,
                "filename": "other.pcap",
                "size_bytes": 2048,
                "sha256": "b" * 64,
                "linktype": 1,
                "packet_count": 5,
                "status": CaptureStatus.ready,
                "stored_path": "/tmp/other.pcap",
                "parsed_index_path": "/tmp/other.index.json",
            },
        )
        other_thread = await test_client_authenticated.post(
            f"/api/captures/{other_capture.id}/threads", json={"title": "Other"}
        )

        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads/batch-delete",
            json={"thread_ids": [other_thread.json()["id"]]},
        )

        assert r.status_code == 200
        assert r.json() == {"deleted": 0}
        r = await test_client_authenticated.get(
            f"/api/captures/{other_capture.id}/threads/{other_thread.json()['id']}"
        )
        assert r.status_code == 200

    async def test_thread_user_id_is_enforced_for_admin_visible_capture(
        self, test_client_authenticated, test_capture, _session_engine, _llm_enabled
    ):
        from sqlalchemy import select
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
        from tests.backend.conftest import _make_user_async
        from app.models import ChatThread

        other_user = await _make_user_async(
            _session_engine,
            {
                "id": uuid.uuid4(),
                "github_id": 70001,
                "login": "other-chat-owner",
                "email": "other@example.com",
                "name": "Other Chat Owner",
                "avatar_url": "https://avatar.example.com/other.png",
                "created_at": datetime.now(timezone.utc),
            },
        )
        factory = async_sessionmaker(
            _session_engine, class_=AsyncSession, expire_on_commit=False
        )
        async with factory() as session:
            thread = ChatThread(
                capture_id=test_capture.id,
                user_id=other_user.id,
                title="Other user's chat",
            )
            session.add(thread)
            await session.commit()
            await session.refresh(thread)
            other_thread_id = thread.id

        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/threads"
        )
        assert all(thread["id"] != str(other_thread_id) for thread in r.json())

        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/threads/{other_thread_id}"
        )
        assert r.status_code == 404

        r = await test_client_authenticated.delete(
            f"/api/captures/{test_capture.id}/threads/{other_thread_id}"
        )
        assert r.status_code == 404

        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads/{other_thread_id}/messages",
            json={"content": "hi"},
        )
        assert r.status_code == 404

        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads/batch-delete",
            json={"thread_ids": [str(other_thread_id)]},
        )
        assert r.status_code == 200
        assert r.json() == {"deleted": 0}
        async with factory() as session:
            exists = (
                await session.execute(
                    select(ChatThread).where(ChatThread.id == other_thread_id)
                )
            ).scalar_one_or_none()
        assert exists is not None


@pytest.mark.integration
class TestPostMessage:
    async def test_message_streams_and_persists(
        self, test_client_authenticated, test_capture, _llm_enabled
    ):
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={}
        )
        tid = r.json()["id"]

        with patch(
            "app.api.chat.chat_stream",
            _fake_stream_factory("Hello ", "world"),
        ):
            r = await test_client_authenticated.post(
                f"/api/captures/{test_capture.id}/threads/{tid}/messages",
                json={"content": "What is in this capture?"},
            )
            assert r.status_code == 200
            body = r.text
            assert "Hello " in body
            assert "world" in body
            assert "[DONE]" in body

        # The user + assistant turns are persisted.
        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/threads/{tid}"
        )
        msgs = r.json()["messages"]
        assert [m["role"] for m in msgs] == ["user", "assistant"]
        assert msgs[0]["content"] == "What is in this capture?"
        assert msgs[1]["content"] == "Hello world"

    async def test_partial_answer_persisted_on_error(
        self, test_client_authenticated, test_capture, _llm_enabled
    ):
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={}
        )
        tid = r.json()["id"]

        with patch(
            "app.api.chat.chat_stream",
            _fake_stream_factory("partial", raise_after=True),
        ):
            r = await test_client_authenticated.post(
                f"/api/captures/{test_capture.id}/threads/{tid}/messages",
                json={"content": "hi"},
            )
            assert r.status_code == 200

        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/threads/{tid}"
        )
        msgs = r.json()["messages"]
        assert msgs[-1]["role"] == "assistant"
        assert msgs[-1]["content"] == "partial"

    async def test_empty_message_rejected(
        self, test_client_authenticated, test_capture, _llm_enabled
    ):
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={}
        )
        tid = r.json()["id"]
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads/{tid}/messages",
            json={"content": "   "},
        )
        assert r.status_code == 422

    async def test_message_without_llm_configured_400(
        self, test_client_authenticated, test_capture
    ):
        # llm_api_key is "" by default in the test settings.
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={}
        )
        tid = r.json()["id"]
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads/{tid}/messages",
            json={"content": "hi"},
        )
        assert r.status_code == 400


@pytest.mark.integration
class TestCascadeDelete:
    async def test_deleting_capture_removes_threads_and_messages(
        self, test_client_authenticated, test_capture, _session_engine, _llm_enabled
    ):
        r = await test_client_authenticated.post(
            f"/api/captures/{test_capture.id}/threads", json={}
        )
        tid = r.json()["id"]
        with patch("app.api.chat.chat_stream", _fake_stream_factory("hi")):
            await test_client_authenticated.post(
                f"/api/captures/{test_capture.id}/threads/{tid}/messages",
                json={"content": "q"},
            )

        # Delete the capture; FK cascade must remove threads + messages.
        r = await test_client_authenticated.delete(
            f"/api/captures/{test_capture.id}"
        )
        assert r.status_code == 200

        from sqlalchemy import select, func
        from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
        from app.models import ChatThread, ChatMessage

        factory = async_sessionmaker(_session_engine, class_=AsyncSession)
        async with factory() as s:
            threads = (
                await s.execute(select(func.count()).select_from(ChatThread))
            ).scalar_one()
            messages = (
                await s.execute(select(func.count()).select_from(ChatMessage))
            ).scalar_one()
        assert threads == 0
        assert messages == 0
