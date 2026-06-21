"""
LLM service for per-conversation analysis.

Uses an OpenAI-compatible client (configurable base_url) to generate
diagnostic summaries and issue detection for TCP/UDP conversations.
"""

from __future__ import annotations

import json
import logging
import re
from typing import AsyncIterator

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_VALID_SEVERITIES = {"low", "medium", "high", "critical"}


def _get_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
    )


ANALYSIS_SYSTEM_PROMPT = """You are a network protocol expert. Analyze the given TCP or UDP conversation from a packet capture and provide a diagnostic assessment.

Respond with a JSON object containing:
- "summary": A markdown paragraph (2-5 sentences) explaining what this conversation is about in plain English. Mention the application protocol, data direction, and key observations.
- "issues": An array of detected issues, each with:
  - "type": Short category like "retransmission", "handshake_failure", "high_latency", "connection_reset", "zero_window", "dns_error", "malformed"
  - "severity": One of "low", "medium", "high", "critical"
  - "explanation": One sentence describing the issue and its impact

If no issues are detected, return an empty issues array. Be concise. Only report issues that are clearly visible from the data provided."""


CHAT_SYSTEM_PROMPT = """You are a packet-capture analysis assistant embedded in a Wireshark-like tool. \
You help the user understand and troubleshoot ONE specific network capture, whose summary is provided below.

Scope rules:
- Only answer questions about analyzing this capture, or about networking and \
network protocols relevant to interpreting it.
- If the user asks something unrelated to this capture or to network/packet analysis \
(for example general trivia, coding help, or personal questions), politely decline in \
one sentence and steer them back to the capture.
- Ground your answers in the provided capture context. If the context does not contain \
enough information to answer, say so rather than inventing packet details.
- Be concise and use plain language. Markdown is fine."""


TCPDUMP_GEN_SYSTEM_PROMPT = """You are a tcpdump command expert. The user will describe what network traffic they want to capture or analyze, and you generate the correct tcpdump command.

Respond with:
1. The exact tcpdump command in a fenced code block (```).
2. A brief explanation of each flag and filter used.
3. Any caveats or alternatives the user should know about.

Rules:
- Always use the full tcpdump command starting with 'tcpdump'.
- Use standard BPF filter syntax.
- Prefer specific filters over broad ones.
- If the user's request is ambiguous, pick the most common interpretation and note the alternatives.
- Be concise."""


PKTMON_GEN_SYSTEM_PROMPT = """You are a Windows pktmon (Packet Monitor) command expert. pktmon is available on Windows Server 2019+ and Windows 10 version 1809+. The user will describe what network traffic they want to capture or monitor, and you generate the correct pktmon commands.

Respond with:
1. The exact pktmon commands in a fenced code block (```), including:
   - `pktmon filter remove` to clear previous filters
   - `pktmon filter add` commands for each filter
   - `pktmon start` with capture options
   - `pktmon stop` to end capture
   - `pktmon etl2pcap` to convert the .etl output to .pcapng if applicable
2. A brief explanation of each parameter used.
3. Any caveats or alternatives the user should know about.

Rules:
- pktmon requires Administrator (elevated) privileges.
- Use --etw flag with pktmon start for packet logging.
- Output files are in .etl format; mention conversion to .pcapng with `pktmon etl2pcap`.
- If the user's request is ambiguous, pick the most common interpretation and note the alternatives.
- Be concise."""


EXPLAIN_SYSTEM_PROMPT = """You are a network protocol expert embedded in a Wireshark-like tool. \
The user has selected one or more packets from a capture and wants you to explain them.

For the selected packets, provide:
1. A clear summary of what is happening in these packets (protocol, purpose, data flow).
2. Notable observations: retransmissions, errors, unusual flags, latency, anomalies.
3. If the packets form part of a conversation (e.g. TCP handshake, DNS query/response), \
explain the sequence and state transitions.

Be concise. Use markdown for formatting. Ground your analysis in the packet data provided."""


async def explain_packets_stream(
    context: str,
    packets_block: str,
) -> AsyncIterator[str]:
    """Stream a one-shot explanation of selected packets."""
    client = _get_client()

    messages: list[dict] = [
        {
            "role": "system",
            "content": f"{EXPLAIN_SYSTEM_PROMPT}\n\n## Capture context\n{context}",
        },
        {
            "role": "user",
            "content": f"Explain these selected packets:\n\n{packets_block}",
        },
    ]

    stream = await client.chat.completions.create(
        model=settings.llm_model,
        messages=messages,
        temperature=0.3,
        stream=True,
    )
    async for chunk in stream:
        choices = getattr(chunk, "choices", None)
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        text = getattr(delta, "content", None) if delta else None
        if text:
            yield text


async def chat_stream(
    context: str,
    history: list[dict],
    question: str,
) -> AsyncIterator[str]:
    """Stream an assistant reply to a user question about a capture.

    ``context`` is a compact, pre-built summary of the capture. ``history`` is
    the prior turns as ``[{"role": "user"|"assistant", "content": str}, ...]``.
    Yields text deltas as they arrive so the API layer can forward them over SSE
    and the user can stop generation mid-stream.
    """
    client = _get_client()

    messages: list[dict] = [
        {"role": "system", "content": f"{CHAT_SYSTEM_PROMPT}\n\n## Capture context\n{context}"}
    ]
    for m in history:
        role = m.get("role")
        content = m.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})

    stream = await client.chat.completions.create(
        model=settings.llm_model,
        messages=messages,
        temperature=0.3,
        stream=True,
    )
    async for chunk in stream:
        choices = getattr(chunk, "choices", None)
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        text = getattr(delta, "content", None) if delta else None
        if text:
            yield text


async def capture_command_generate_stream(
    prompt: str,
    platform: str = "tcpdump",
    capture_context: str | None = None,
) -> AsyncIterator[str]:
    """Stream a capture command (tcpdump or pktmon) based on a natural language prompt."""
    client = _get_client()

    system_prompt = (
        PKTMON_GEN_SYSTEM_PROMPT if platform == "pktmon" else TCPDUMP_GEN_SYSTEM_PROMPT
    )
    if capture_context:
        system_prompt = f"{system_prompt}\n\n## Capture context\n{capture_context}"

    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]

    stream = await client.chat.completions.create(
        model=settings.llm_model,
        messages=messages,
        temperature=0.3,
        stream=True,
    )
    async for chunk in stream:
        choices = getattr(chunk, "choices", None)
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        text = getattr(delta, "content", None) if delta else None
        if text:
            yield text


# Extract the first {...} JSON object from a model response. Handles raw JSON,
# fenced ```json blocks, fenced ``` blocks with any language tag, and prose
# around the object.
_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}")


def _extract_json_object(content: str) -> dict | None:
    """Pull the first JSON object out of a (possibly fenced) LLM response."""
    text = content.strip()
    # Strip a single leading/trailing code fence, conservatively.
    if text.startswith("```"):
        # Drop the opening fence line (may include a language tag).
        text = text.split("\n", 1)[1] if "\n" in text else text.lstrip("`")
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    match = _JSON_OBJECT_RE.search(text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def _normalize_summary(summary) -> str:
    """Coerce summary to a safe string. Uses a fallback rather than blind
    str() so objects/lists render as a clear placeholder instead of
    ``[...]`` / ``{...}``."""
    if isinstance(summary, str):
        return summary.strip() or "No summary provided."
    if summary is None:
        return "No summary provided."
    return "No summary provided."


def _normalize_issues(issues) -> list[dict]:
    """Normalize the issues array: drop non-objects, coerce fields to strings,
    and clamp severity to the documented enum."""
    if not isinstance(issues, list):
        return []
    result = []
    for item in issues:
        if not isinstance(item, dict):
            continue
        type_val = item.get("type", "unknown")
        severity_val = item.get("severity", "low")
        explanation_val = item.get("explanation", "")

        type_str = type_val if isinstance(type_val, str) else "unknown"
        explanation_str = explanation_val if isinstance(explanation_val, str) else ""
        if isinstance(severity_val, str) and severity_val.lower() in _VALID_SEVERITIES:
            severity_str = severity_val.lower()
        else:
            severity_str = "low"

        result.append({
            "type": type_str,
            "severity": severity_str,
            "explanation": explanation_str,
        })
    return result


def _format_evidence(evidence_json: str | None) -> str:
    """Format the reservoir-sampled structured evidence into prompt lines."""
    if not evidence_json:
        return ""
    try:
        samples = json.loads(evidence_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    if not isinstance(samples, list) or not samples:
        return ""

    lines = ["", "## Sampled packets (structured evidence):"]
    for s in samples:
        if not isinstance(s, dict):
            continue
        parts = [f"t={s.get('ts', 0):.6f}"]
        sport = s.get("sport", 0)
        dport = s.get("dport", 0)
        src = s.get("src", "?")
        dst = s.get("dst", "?")
        parts.append(f"{src}:{sport} -> {dst}:{dport}")
        flags = s.get("flags", "")
        if flags:
            parts.append(f"[{flags}]")
        seq = s.get("seq")
        ack = s.get("ack")
        if seq and flags and "SYN" not in flags and "FIN" not in flags:
            parts.append(f"seq={seq}")
        if ack and flags and "ACK" in flags:
            parts.append(f"ack={ack}")
        payload_len = s.get("payload_len", 0)
        if payload_len:
            parts.append(f"payload={payload_len}B")
        dns_qname = s.get("dns_qname")
        dns_answer = s.get("dns_answer")
        if dns_qname:
            parts.append(f"DNS_Q={dns_qname}")
        if dns_answer:
            parts.append(f"DNS_A={dns_answer}")
        lines.append("  " + " ".join(parts))
    return "\n".join(lines)


async def analyze_conversation(
    capture, conversation
) -> tuple[str, list[dict], int, int]:
    """Analyze one conversation.

    Returns ``(markdown_summary, issues_list, prompt_tokens, completion_tokens)``.
    Token counts are read from the API response.usage when available so cost
    tracking can be persisted on the Analysis row. On error, raises so callers
    can decide whether to record a failure row.
    """
    client = _get_client()

    prompt_lines = [
        "## Conversation",
        f"Protocol: {conversation.proto}",
        f"Source: {conversation.src_ip}:{conversation.src_port}",
        f"Destination: {conversation.dst_ip}:{conversation.dst_port}",
        f"Packets: {conversation.packet_count}",
        f"Bytes: {conversation.byte_count}",
        f"Duration: {conversation.end_ts - conversation.start_ts:.4f}s",
    ]
    if conversation.app_protocol:
        prompt_lines.append(f"Application protocol: {conversation.app_protocol}")
    if conversation.flags_summary:
        prompt_lines.append(f"TCP flags summary: {conversation.flags_summary}")

    # Append structured per-packet evidence collected during parsing.
    evidence = getattr(conversation, "evidence_json", None)
    evidence_text = _format_evidence(evidence)
    if evidence_text:
        prompt_lines.append(evidence_text)

    prompt = "\n".join(prompt_lines)

    response = await client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=600,
    )

    content = response.choices[0].message.content or ""
    usage = getattr(response, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0

    parsed = _extract_json_object(content)
    if parsed is None:
        logger.warning(
            "LLM returned non-JSON content for conversation %s; using raw text",
            getattr(conversation, "id", "?"),
        )
        safe = content.strip() or "No summary provided."
        return safe, [], prompt_tokens, completion_tokens

    summary = _normalize_summary(parsed.get("summary", "No summary provided."))
    issues = _normalize_issues(parsed.get("issues", []))
    return summary, issues, prompt_tokens, completion_tokens
