"""Tests for the explain-related LLM additions in app/services/llm.py."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.llm import EXPLAIN_SYSTEM_PROMPT, explain_packets_stream


class _FakeAsyncStream:
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


class TestExplainSystemPrompt:
    def test_prompt_mentions_packets(self):
        assert "packet" in EXPLAIN_SYSTEM_PROMPT.lower()

    def test_prompt_mentions_markdown(self):
        assert "markdown" in EXPLAIN_SYSTEM_PROMPT.lower()


class TestExplainPacketsStream:
    @pytest.mark.asyncio
    async def test_streams_deltas(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream(
                [_delta_chunk("This "), _delta_chunk("is a "), _delta_chunk("TCP handshake.")]
            )
        )

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.services.llm._get_client", lambda: mock_client)
            result = []
            async for delta in explain_packets_stream("context", "packets block"):
                result.append(delta)

        assert "".join(result) == "This is a TCP handshake."

    @pytest.mark.asyncio
    async def test_includes_context_and_packets_in_messages(self):
        mock_client = AsyncMock()
        captured_kwargs = {}

        async def fake_create(**kwargs):
            captured_kwargs.update(kwargs)
            return _FakeAsyncStream([])

        mock_client.chat.completions.create = fake_create

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.services.llm._get_client", lambda: mock_client)
            async for _ in explain_packets_stream("my-context", "my-packets"):
                pass

        messages = captured_kwargs["messages"]
        system_msg = messages[0]["content"]
        user_msg = messages[1]["content"]
        assert "my-context" in system_msg
        assert "my-packets" in user_msg

    @pytest.mark.asyncio
    async def test_skips_none_deltas(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_FakeAsyncStream(
                [_delta_chunk("Hello"), _delta_chunk(None), _delta_chunk(" World")]
            )
        )

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.services.llm._get_client", lambda: mock_client)
            result = []
            async for delta in explain_packets_stream("ctx", "pkts"):
                result.append(delta)

        assert result == ["Hello", " World"]
