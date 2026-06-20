"""Integration tests for the AI chat thread/message endpoints."""

import uuid
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
