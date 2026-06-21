"""Integration tests for POST /api/capture-command/generate."""

from unittest.mock import patch

import pytest


@pytest.fixture
def _llm_enabled(monkeypatch):
    import app.config
    monkeypatch.setattr(app.config.settings, "llm_api_key", "sk-test")


def _fake_capture_command_stream(*deltas):
    async def _gen(prompt, platform="tcpdump", capture_context=None):
        for d in deltas:
            yield d
    return _gen


@pytest.mark.integration
class TestGenerateCaptureCommand:
    async def test_valid_prompt_tcpdump(
        self, test_client_authenticated, _llm_enabled
    ):
        with patch(
            "app.api.capture_command.capture_command_generate_stream",
            _fake_capture_command_stream("tcpdump ", "-i eth0"),
        ):
            r = await test_client_authenticated.post(
                "/api/capture-command/generate",
                json={"prompt": "capture HTTP traffic", "platform": "tcpdump"},
            )
            assert r.status_code == 200
            body = r.text
            assert "tcpdump " in body
            assert "-i eth0" in body
            assert "[DONE]" in body

    async def test_valid_prompt_pktmon(
        self, test_client_authenticated, _llm_enabled
    ):
        with patch(
            "app.api.capture_command.capture_command_generate_stream",
            _fake_capture_command_stream("pktmon ", "start"),
        ):
            r = await test_client_authenticated.post(
                "/api/capture-command/generate",
                json={"prompt": "capture DNS traffic", "platform": "pktmon"},
            )
            assert r.status_code == 200
            body = r.text
            assert "pktmon " in body
            assert "start" in body
            assert "[DONE]" in body

    async def test_llm_not_configured_returns_400(
        self, test_client_authenticated
    ):
        # _llm_enabled is NOT used; llm_api_key defaults to "" in conftest.
        r = await test_client_authenticated.post(
            "/api/capture-command/generate",
            json={"prompt": "capture HTTP"},
        )
        assert r.status_code == 400

    async def test_unauthenticated_returns_401_or_403(
        self, test_client
    ):
        r = await test_client.post(
            "/api/capture-command/generate",
            json={"prompt": "capture HTTP"},
        )
        assert r.status_code in (401, 403)

    async def test_default_platform_is_tcpdump(
        self, test_client_authenticated, _llm_enabled
    ):
        captured = {}

        def _capturing_stream(*deltas):
            async def _gen(prompt, platform="tcpdump", capture_context=None):
                captured["platform"] = platform
                for d in deltas:
                    yield d
            return _gen

        with patch(
            "app.api.capture_command.capture_command_generate_stream",
            _capturing_stream("ok"),
        ):
            r = await test_client_authenticated.post(
                "/api/capture-command/generate",
                json={"prompt": "capture HTTP"},
                # no platform field in body
            )
            assert r.status_code == 200
            assert captured["platform"] == "tcpdump"
