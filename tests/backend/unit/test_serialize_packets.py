"""Tests for serialize_packets_for_llm in app/api/packets.py."""

import json
import struct
import tempfile
import os

import pytest

from app.api.packets import serialize_packets_for_llm, _MAX_EXPLAIN_PACKETS


def _write_test_data(num_packets: int):
    """Write summary.jsonl + offsets.bin with test packet data. Returns paths."""
    tmpdir = tempfile.mkdtemp()
    summary_path = os.path.join(tmpdir, "test.summary.jsonl")
    offsets_path = os.path.join(tmpdir, "test.offsets.bin")

    summary_offsets = []
    with open(summary_path, "w") as sf:
        for i in range(num_packets):
            summary_offsets.append(sf.tell())
            record = {
                "idx": i,
                "ts": 1000.0 + i * 0.001,
                "src": f"10.0.0.{i % 256}",
                "dst": f"10.0.1.{i % 256}",
                "proto": "TCP",
                "length": 100 + i,
                "info": f"Packet {i}",
            }
            sf.write(json.dumps(record) + "\n")

    fmt = struct.Struct("<QQ")
    with open(offsets_path, "wb") as of:
        for i in range(num_packets):
            of.write(fmt.pack(0, summary_offsets[i]))

    return summary_path, offsets_path


class TestSerializePacketsForLLM:
    def test_basic_serialization(self):
        summary_path, offsets_path = _write_test_data(5)
        result = serialize_packets_for_llm(summary_path, offsets_path, [0, 2, 4])
        lines = result.strip().split("\n")
        assert len(lines) == 3
        assert "#0" in lines[0]
        assert "#2" in lines[1]
        assert "#4" in lines[2]
        assert "10.0.0.0" in lines[0]

    def test_caps_at_max(self):
        summary_path, offsets_path = _write_test_data(100)
        indices = list(range(100))
        result = serialize_packets_for_llm(summary_path, offsets_path, indices)
        lines = result.strip().split("\n")
        assert len(lines) == _MAX_EXPLAIN_PACKETS

    def test_out_of_range_indices_skipped(self):
        summary_path, offsets_path = _write_test_data(3)
        result = serialize_packets_for_llm(summary_path, offsets_path, [0, 999])
        lines = result.strip().split("\n")
        assert len(lines) == 1
        assert "#0" in lines[0]

    def test_empty_indices(self):
        summary_path, offsets_path = _write_test_data(3)
        result = serialize_packets_for_llm(summary_path, offsets_path, [])
        assert result == ""
