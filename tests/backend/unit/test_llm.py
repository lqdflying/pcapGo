"""Tests for app/services/llm.py."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm import (
    _get_client,
    analyze_conversation,
    chat_stream,
    ANALYSIS_SYSTEM_PROMPT,
    CHAT_SYSTEM_PROMPT,
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


class TestChatStream:
    def test_system_prompt_restricts_scope(self):
        assert "capture" in CHAT_SYSTEM_PROMPT.lower()
        assert "decline" in CHAT_SYSTEM_PROMPT.lower()

    @pytest.mark.asyncio
    async def test_streams_deltas_and_sends_context(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream(
                [_delta_chunk("Hello "), _delta_chunk("world"), _delta_chunk(None)]
            )
        )

        with patch("app.services.llm._get_client", return_value=mock_client):
            out = []
            async for d in chat_stream(
                "CONTEXT-XYZ",
                [{"role": "user", "content": "earlier"}],
                "What protocols are here?",
            ):
                out.append(d)

        assert "".join(out) == "Hello world"
        call = mock_client.chat.completions.create.call_args
        assert call[1]["stream"] is True
        messages = call[1]["messages"]
        assert messages[0]["role"] == "system"
        assert "CONTEXT-XYZ" in messages[0]["content"]
        assert messages[-1]["content"] == "What protocols are here?"


class TestGetClient:
    def test_settings_default(self):
        """_get_client exists and is callable."""
        from app.services.llm import _get_client
        # Skip if no API key is configured
        from app.config import settings
        if not settings.llm_api_key:
            return
        client = _get_client()
        assert client is not None


class TestSystemPrompt:
    def test_contains_expected_keys(self):
        assert "summary" in ANALYSIS_SYSTEM_PROMPT
        assert "issues" in ANALYSIS_SYSTEM_PROMPT
        assert "type" in ANALYSIS_SYSTEM_PROMPT
        assert "severity" in ANALYSIS_SYSTEM_PROMPT
        assert "explanation" in ANALYSIS_SYSTEM_PROMPT


class TestAnalyzeConversation:
    @pytest.fixture
    def mock_conv(self):
        conv = MagicMock()
        conv.proto = "tcp"
        conv.src_ip = "10.0.0.1"
        conv.src_port = 443
        conv.dst_ip = "10.0.0.2"
        conv.dst_port = 54321
        conv.packet_count = 10
        conv.byte_count = 1000
        conv.start_ts = 0.0
        conv.end_ts = 1.5
        conv.app_protocol = "TLS"
        conv.flags_summary = "SYN,ACK"
        return conv

    @pytest.fixture
    def mock_capture(self):
        return MagicMock()

    def _mock_usage(self, prompt=123, completion=456):
        u = MagicMock()
        u.prompt_tokens = prompt
        u.completion_tokens = completion
        return u

    @pytest.mark.asyncio
    async def test_valid_json_response(self, mock_capture, mock_conv):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({
                "summary": "TLS handshake completed successfully.",
                "issues": [
                    {"type": "high_latency", "severity": "medium", "explanation": "RTT is 500ms."},
                ],
            })))
        ]
        mock_response.usage = self._mock_usage(111, 222)
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            summary, issues, pt, ct = await analyze_conversation(mock_capture, mock_conv)

        assert "TLS handshake" in summary
        assert len(issues) == 1
        assert issues[0]["type"] == "high_latency"
        assert pt == 111
        assert ct == 222

    @pytest.mark.asyncio
    async def test_response_with_markdown_fence(self, mock_capture, mock_conv):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="```json\n" + json.dumps({
                "summary": "Test summary.",
                "issues": [],
            }) + "\n```"))
        ]
        mock_response.usage = self._mock_usage(0, 0)
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            summary, issues, _, _ = await analyze_conversation(mock_capture, mock_conv)

        assert summary == "Test summary."
        assert issues == []

    @pytest.mark.asyncio
    async def test_json_decode_error_fallback(self, mock_capture, mock_conv):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="This is not valid JSON at all."))
        ]
        mock_response.usage = self._mock_usage(5, 7)
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            summary, issues, pt, ct = await analyze_conversation(mock_capture, mock_conv)

        # Non-JSON: fall back to the raw text as the summary.
        assert summary == "This is not valid JSON at all."
        assert issues == []
        assert pt == 5
        assert ct == 7

    @pytest.mark.asyncio
    async def test_missing_summary_key(self, mock_capture, mock_conv):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({"issues": []})))
        ]
        mock_response.usage = self._mock_usage()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            summary, issues, _, _ = await analyze_conversation(mock_capture, mock_conv)

        assert summary == "No summary provided."
        assert issues == []

    @pytest.mark.asyncio
    async def test_api_exception_propagates(self, mock_capture, mock_conv):
        """LLM errors now propagate so the SSE handler can decide whether to
        record a failure row (Phase 3.4)."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("Network error"))

        with patch("app.services.llm._get_client", return_value=mock_client):
            with pytest.raises(Exception, match="Network error"):
                await analyze_conversation(mock_capture, mock_conv)

    @pytest.mark.asyncio
    async def test_prompt_excludes_none_fields(self, mock_capture):
        mock_conv = MagicMock()
        mock_conv.proto = "tcp"
        mock_conv.src_ip = "10.0.0.1"
        mock_conv.src_port = 443
        mock_conv.dst_ip = "10.0.0.2"
        mock_conv.dst_port = 54321
        mock_conv.packet_count = 5
        mock_conv.byte_count = 500
        mock_conv.start_ts = 0.0
        mock_conv.end_ts = 1.0
        mock_conv.app_protocol = None
        mock_conv.flags_summary = None

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({"summary": "OK", "issues": []})))
        ]
        mock_response.usage = self._mock_usage()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            await analyze_conversation(mock_capture, mock_conv)

        call_args = mock_client.chat.completions.create.call_args
        user_message = call_args[1]["messages"][1]["content"]
        assert "Application protocol" not in user_message
        assert "TCP flags summary" not in user_message

    @pytest.mark.asyncio
    async def test_empty_response_content(self, mock_capture, mock_conv):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=None))
        ]
        mock_response.usage = self._mock_usage()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            summary, issues, _, _ = await analyze_conversation(mock_capture, mock_conv)

        # Empty content → fallback summary string.
        assert summary == "No summary provided."
        assert issues == []

    @pytest.mark.asyncio
    async def test_non_dict_issues_are_dropped(self, mock_capture, mock_conv):
        """Non-object items in the issues array must be dropped, not crash."""
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({
                "summary": "ok",
                "issues": ["high_latency", 42, None, {"type": "reset", "severity": "high", "explanation": "x"}],
            })))
        ]
        mock_response.usage = self._mock_usage()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            summary, issues, _, _ = await analyze_conversation(mock_capture, mock_conv)

        assert summary == "ok"
        assert len(issues) == 1
        assert issues[0]["type"] == "reset"

    @pytest.mark.asyncio
    async def test_severity_normalized_to_enum(self, mock_capture, mock_conv):
        """Unknown severity values default to 'low'; valid ones are lowercased."""
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({
                "summary": "ok",
                "issues": [
                    {"type": "a", "severity": "HIGH", "explanation": ""},
                    {"type": "b", "severity": "extreme", "explanation": ""},
                    {"type": "c", "explanation": ""},
                ],
            })))
        ]
        mock_response.usage = self._mock_usage()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            _, issues, _, _ = await analyze_conversation(mock_capture, mock_conv)

        assert issues[0]["severity"] == "high"
        assert issues[1]["severity"] == "low"  # unknown → low
        assert issues[2]["severity"] == "low"  # missing → low

    @pytest.mark.asyncio
    async def test_non_string_summary_gets_safe_fallback(self, mock_capture, mock_conv):
        """Non-string summary uses a safe fallback rather than str()."""
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({
                "summary": [1, 2, 3],
                "issues": [],
            })))
        ]
        mock_response.usage = self._mock_usage()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            summary, _, _, _ = await analyze_conversation(mock_capture, mock_conv)

        assert summary == "No summary provided."

    @pytest.mark.asyncio
    async def test_evidence_included_in_prompt(self, mock_capture):
        """When evidence_json is set, it appears in the prompt."""
        mock_conv = MagicMock()
        mock_conv.proto = "tcp"
        mock_conv.src_ip = "10.0.0.1"
        mock_conv.src_port = 443
        mock_conv.dst_ip = "10.0.0.2"
        mock_conv.dst_port = 54321
        mock_conv.packet_count = 5
        mock_conv.byte_count = 500
        mock_conv.start_ts = 0.0
        mock_conv.end_ts = 1.0
        mock_conv.app_protocol = None
        mock_conv.flags_summary = None
        mock_conv.evidence_json = json.dumps([
            {"ts": 0.1, "src": "10.0.0.1", "sport": 443, "dst": "10.0.0.2",
             "dport": 54321, "flags": "SYN", "seq": 0, "ack": 0, "payload_len": 0}
        ])

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps({"summary": "ok", "issues": []})))
        ]
        mock_response.usage = self._mock_usage()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("app.services.llm._get_client", return_value=mock_client):
            await analyze_conversation(mock_capture, mock_conv)

        call_args = mock_client.chat.completions.create.call_args
        user_message = call_args[1]["messages"][1]["content"]
        assert "Sampled packets" in user_message
        assert "SYN" in user_message
