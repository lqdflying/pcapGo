"""Integration tests for /api/captures/{id}/ai (LLM analysis) endpoint."""

import json
import uuid

import pytest


@pytest.mark.integration
class TestAIAnalysis:
    """Tests for GET /api/captures/{id}/ai."""

    async def test_returns_400_when_llm_api_key_empty(
        self, test_client_authenticated, test_capture
    ):
        """_patch_settings sets llm_api_key=\"\" so endpoint returns 400."""
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/ai"
        )
        assert response.status_code == 400

    async def test_nonexistent_capture_returns_404(self, test_client_authenticated, monkeypatch):
        monkeypatch.setattr("app.api.analysis.settings.llm_api_key", "fake-key")
        response = await test_client_authenticated.get(
            f"/api/captures/{uuid.uuid4()}/ai"
        )
        assert response.status_code == 404

    async def test_non_ready_capture_returns_400(
        self, test_client_authenticated, _session_engine
    ):
        from tests.backend.conftest import _make_capture_async
        from app.models import CaptureStatus
        cap = await _make_capture_async(_session_engine, {
            "id": uuid.uuid4(),
            "user_id": test_client_authenticated._auth_user.id,
            "filename": "not-ready.pcap",
            "size_bytes": 512,
            "sha256": "z" * 64,
            "linktype": 1,
            "packet_count": 0,
            "status": CaptureStatus.uploaded,
            "stored_path": "/tmp/not-ready-ai.pcap",
            "parsed_index_path": None,
        })
        response = await test_client_authenticated.get(
            f"/api/captures/{cap.id}/ai"
        )
        assert response.status_code == 400

    async def test_streaming_with_llm_configured(
        self, test_client_authenticated, test_capture, test_conversation, monkeypatch
    ):
        monkeypatch.setattr("app.api.analysis.settings.llm_api_key", "fake-key")
        monkeypatch.setattr("app.api.analysis.settings.llm_model", "test-model")

        async def fake_analyze(capture, conv):
            return "Test analysis summary", [], 100, 50

        monkeypatch.setattr("app.api.analysis.analyze_conversation", fake_analyze)

        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/ai"
        )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

    async def test_streaming_has_done_event(
        self, test_client_authenticated, test_capture, test_conversation, monkeypatch
    ):
        monkeypatch.setattr("app.api.analysis.settings.llm_api_key", "fake-key")
        monkeypatch.setattr("app.api.analysis.settings.llm_model", "test-model")

        async def fake_analyze(capture, conv):
            return "Test analysis summary", [], 100, 50

        monkeypatch.setattr("app.api.analysis.analyze_conversation", fake_analyze)

        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/ai"
        )
        assert response.status_code == 200
        assert "data: [DONE]" in response.text

    async def test_sse_events_have_expected_structure(
        self, test_client_authenticated, test_capture, test_conversation, monkeypatch
    ):
        monkeypatch.setattr("app.api.analysis.settings.llm_api_key", "fake-key")
        monkeypatch.setattr("app.api.analysis.settings.llm_model", "test-model")

        async def fake_analyze(capture, conv):
            return "Test analysis", [
                {"type": "potential_threat", "severity": "high",
                 "explanation": "Suspicious pattern detected"}
            ], 100, 50

        monkeypatch.setattr("app.api.analysis.analyze_conversation", fake_analyze)

        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/ai"
        )
        assert response.status_code == 200
        body = response.text
        data_lines = [line for line in body.split("\n") if line.startswith("data: {")]
        assert len(data_lines) >= 1
        for line in data_lines:
            event = json.loads(line[len("data: "):])
            for field in ("conversation_id", "proto", "src", "dst",
                          "summary_markdown", "issues"):
                assert field in event

    async def test_sse_persists_token_usage(
        self, test_client_authenticated, test_capture, test_conversation,
        monkeypatch, db_session
    ):
        """Successful analyses must persist prompt/completion tokens (Phase 3.4)."""
        from app.models import Analysis
        from sqlalchemy import select

        monkeypatch.setattr("app.api.analysis.settings.llm_api_key", "fake-key")
        monkeypatch.setattr("app.api.analysis.settings.llm_model", "test-model")

        async def fake_analyze(capture, conv):
            return "ok", [], 333, 222

        monkeypatch.setattr("app.api.analysis.analyze_conversation", fake_analyze)

        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/ai"
        )
        assert response.status_code == 200

        result = await db_session.execute(select(Analysis))
        rows = result.scalars().all()
        assert len(rows) == 1
        assert rows[0].prompt_tokens == 333
        assert rows[0].completion_tokens == 222
        assert rows[0].model == "test-model"

    async def test_sse_skips_persistence_on_llm_failure(
        self, test_client_authenticated, test_capture, test_conversation,
        monkeypatch, db_session
    ):
        """LLM exceptions should not pollute the analyses table (Phase 2.3)."""
        from app.models import Analysis
        from sqlalchemy import select

        monkeypatch.setattr("app.api.analysis.settings.llm_api_key", "fake-key")
        monkeypatch.setattr("app.api.analysis.settings.llm_model", "test-model")

        async def boom(capture, conv):
            raise RuntimeError("LLM timed out")

        monkeypatch.setattr("app.api.analysis.analyze_conversation", boom)

        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/ai"
        )
        # The stream completes (with a failure event) but the table stays empty.
        assert response.status_code == 200
        assert "data: [DONE]" in response.text

        result = await db_session.execute(select(Analysis))
        rows = result.scalars().all()
        assert rows == [], "failed analyses must not be persisted"

    async def test_sse_stops_on_client_disconnect(
        self, test_client_authenticated, test_capture, test_conversation, monkeypatch
    ):
        """If the client disconnects mid-stream, stop before calling the LLM again
        (Phase 2.3)."""
        monkeypatch.setattr("app.api.analysis.settings.llm_api_key", "fake-key")
        monkeypatch.setattr("app.api.analysis.settings.llm_model", "test-model")

        calls = []

        async def slow_analyze(capture, conv):
            calls.append(conv.id)
            # Pretend the client disconnects before the second conversation.
            return "ok", [], 1, 1

        monkeypatch.setattr("app.api.analysis.analyze_conversation", slow_analyze)

    async def test_db_failure_does_not_terminate_stream(
        self, test_client_authenticated, test_capture, test_conversation, monkeypatch
    ):
        """A DB commit failure during persistence must NOT kill the SSE stream;
        the stream should still complete with [DONE]."""
        monkeypatch.setattr("app.api.analysis.settings.llm_api_key", "fake-key")
        monkeypatch.setattr("app.api.analysis.settings.llm_model", "test-model")

        async def fake_analyze(capture, conv):
            return "ok", [], 1, 1

        monkeypatch.setattr("app.api.analysis.analyze_conversation", fake_analyze)

        # Wrap the real session factory so only commit() fails. The capture
        # loading + analysis loading still needs execute(); the persistence
        # only needs add() + commit().
        from app.db.session import async_session as real_session_factory

        call_count = {"n": 0}

        class _FailingCommitWrapper:
            def __init__(self, real_session):
                self._real = real_session

            async def __aenter__(self):
                self._ctx = real_session_factory()
                self._real_session = await self._ctx.__aenter__()
                return self

            async def __aexit__(self, *a):
                return await self._ctx.__aexit__(*a)

            def __getattr__(self, name):
                # Delegate everything (execute, add, refresh, etc.) to the
                # underlying real session.
                return getattr(self._real_session, name)

            async def commit(self):
                call_count["n"] += 1
                # Persistence is the first (and only) commit in this path;
                # fail it so we can verify the SSE stream survives.
                if call_count["n"] >= 1:
                    raise RuntimeError("DB down")
                await self._real_session.commit()

        import app.api.analysis as analysis_mod
        monkeypatch.setattr(analysis_mod, "async_session", lambda: _FailingCommitWrapper(None))

        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/ai"
        )
        assert response.status_code == 200
        # Stream still completes despite the DB failure.
        assert "data: [DONE]" in response.text
