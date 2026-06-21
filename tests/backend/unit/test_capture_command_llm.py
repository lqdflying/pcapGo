"""Tests for capture-command LLM functions in app/services/llm.py."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm import (
    TCPDUMP_GEN_SYSTEM_PROMPT,
    PKTMON_GEN_SYSTEM_PROMPT,
    capture_command_generate_stream,
)


class _FakeAsyncStream:
    """Minimal async-iterable mimicking the OpenAI streaming response."""

    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        self._it = iter(self._chunks)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def _delta_chunk(text):
    return MagicMock(choices=[MagicMock(delta=MagicMock(content=text))])


# ---------------------------------------------------------------------------
# System prompt content checks
# ---------------------------------------------------------------------------


class TestTcpdumpSystemPrompt:
    def test_contains_tcpdump(self):
        assert "tcpdump" in TCPDUMP_GEN_SYSTEM_PROMPT.lower()

    def test_contains_bpf(self):
        assert "bpf" in TCPDUMP_GEN_SYSTEM_PROMPT.lower()

    def test_contains_code_block(self):
        assert "code block" in TCPDUMP_GEN_SYSTEM_PROMPT.lower()


class TestPktmonSystemPrompt:
    def test_contains_pktmon(self):
        assert "pktmon" in PKTMON_GEN_SYSTEM_PROMPT.lower()

    def test_contains_windows(self):
        assert "windows" in PKTMON_GEN_SYSTEM_PROMPT.lower()

    def test_contains_etl2pcap(self):
        assert "etl2pcap" in PKTMON_GEN_SYSTEM_PROMPT.lower()

    def test_contains_administrator(self):
        assert "administrator" in PKTMON_GEN_SYSTEM_PROMPT.lower()


# ---------------------------------------------------------------------------
# Streaming tests
# ---------------------------------------------------------------------------


class TestCaptureCommandGenerateStream:
    @pytest.mark.asyncio
    async def test_streams_deltas_tcpdump(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream(
                [_delta_chunk("tcpdump "), _delta_chunk("-i eth0")]
            )
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            out = []
            async for d in capture_command_generate_stream("capture HTTP", platform="tcpdump"):
                out.append(d)

        assert "".join(out) == "tcpdump -i eth0"

    @pytest.mark.asyncio
    async def test_streams_deltas_pktmon(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream(
                [_delta_chunk("pktmon "), _delta_chunk("start")]
            )
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            out = []
            async for d in capture_command_generate_stream("capture DNS", platform="pktmon"):
                out.append(d)

        assert "".join(out) == "pktmon start"

    @pytest.mark.asyncio
    async def test_tcpdump_uses_tcpdump_system_prompt(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream([])
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            async for _ in capture_command_generate_stream("capture HTTP", platform="tcpdump"):
                pass

        call = mock_client.chat.completions.create.call_args
        system_msg = call[1]["messages"][0]["content"]
        assert TCPDUMP_GEN_SYSTEM_PROMPT in system_msg

    @pytest.mark.asyncio
    async def test_pktmon_uses_pktmon_system_prompt(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream([])
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            async for _ in capture_command_generate_stream("capture DNS", platform="pktmon"):
                pass

        call = mock_client.chat.completions.create.call_args
        system_msg = call[1]["messages"][0]["content"]
        assert PKTMON_GEN_SYSTEM_PROMPT in system_msg

    @pytest.mark.asyncio
    async def test_prompt_included_in_user_message(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream([])
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            async for _ in capture_command_generate_stream("capture all HTTPS traffic on port 443"):
                pass

        call = mock_client.chat.completions.create.call_args
        user_msg = call[1]["messages"][1]["content"]
        assert user_msg == "capture all HTTPS traffic on port 443"

    @pytest.mark.asyncio
    async def test_capture_context_appended_to_system_prompt(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream([])
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            async for _ in capture_command_generate_stream(
                "capture HTTP", platform="tcpdump", capture_context="some capture info"
            ):
                pass

        call = mock_client.chat.completions.create.call_args
        system_msg = call[1]["messages"][0]["content"]
        assert "Capture context" in system_msg
        assert "some capture info" in system_msg

    @pytest.mark.asyncio
    async def test_no_capture_context_means_system_prompt_alone(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream([])
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            async for _ in capture_command_generate_stream("capture HTTP", platform="tcpdump"):
                pass

        call = mock_client.chat.completions.create.call_args
        system_msg = call[1]["messages"][0]["content"]
        assert "Capture context" not in system_msg

    @pytest.mark.asyncio
    async def test_none_deltas_skipped(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream(
                [_delta_chunk("Hello"), _delta_chunk(None), _delta_chunk(" World")]
            )
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            out = []
            async for d in capture_command_generate_stream("capture HTTP"):
                out.append(d)

        assert out == ["Hello", " World"]
