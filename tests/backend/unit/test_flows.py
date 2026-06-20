"""Tests for app/services/flows.py."""

import pytest
from app.services.flows import build_conversations, FlowBuilder, _layer_summary


class TestLayerSummary:
    def test_summary_success(self):
        class MockLayer:
            def summary(self):
                return "Ethernet II"

            @property
            def __class__(self):
                return type("Ether", (), {"__name__": "Ether"})()

        assert _layer_summary(MockLayer()) == "Ethernet II"

    def test_summary_fallback(self):
        class MockLayer:
            def summary(self):
                raise RuntimeError("oops")

            @property
            def __class__(self):
                return type("Ether", (), {"__name__": "Ether"})()

        assert _layer_summary(MockLayer()) == "Ether"

    def test_summary_exception(self):
        class MockLayer:
            def summary(self):
                raise Exception("generic error")

            @property
            def __class__(self):
                return type("IP", (), {"__name__": "IP"})()

        assert _layer_summary(MockLayer()) == "IP"


class TestBuildConversations:
    def test_empty_input(self):
        assert build_conversations([]) == []

    def test_single_packet(self):
        raw = [
            {
                "key": "10.0.0.1:443-10.0.0.2:54321-tcp",
                "proto": "tcp",
                "src": "10.0.0.1",
                "sport": 443,
                "dst": "10.0.0.2",
                "dport": 54321,
                "length": 100,
                "ts": 1.0,
                "app_proto": "TLS",
                "flags": "SYN",
            }
        ]
        result = build_conversations(raw)
        assert len(result) == 1
        c = result[0]
        assert c["proto"] == "tcp"
        assert c["src_ip"] == "10.0.0.1"
        assert c["src_port"] == 443
        assert c["dst_ip"] == "10.0.0.2"
        assert c["dst_port"] == 54321
        assert c["packet_count"] == 1
        assert c["byte_count"] == 100
        assert c["fwd_packet_count"] == 1
        assert c["fwd_byte_count"] == 100
        assert c["start_ts"] == 1.0
        assert c["end_ts"] == 1.0
        assert c["app_proto"] == "TLS"
        assert c["flags_summary"] == "SYN"

    def test_bidirectional_flows_collapse_with_fwd_rev(self):
        """Two packets with same canonical key but opposite directions should
        collapse into one conversation with correct fwd/rev split."""
        raw = [
            # Forward: client -> server (canonical forward = smaller endpoint)
            {"key": "10.0.0.1:443-10.0.0.2:54321-tcp", "proto": "tcp",
             "src": "10.0.0.1", "sport": 443, "dst": "10.0.0.2", "dport": 54321,
             "length": 100, "ts": 1.0, "app_proto": None, "flags": "SYN"},
            # Reverse: server -> client (same canonical key)
            {"key": "10.0.0.1:443-10.0.0.2:54321-tcp", "proto": "tcp",
             "src": "10.0.0.2", "sport": 54321, "dst": "10.0.0.1", "dport": 443,
             "length": 200, "ts": 2.0, "app_proto": None, "flags": "SYN,ACK"},
        ]
        result = build_conversations(raw)
        assert len(result) == 1
        c = result[0]
        assert c["packet_count"] == 2
        assert c["byte_count"] == 300
        assert c["fwd_packet_count"] == 1
        assert c["fwd_byte_count"] == 100
        assert c["start_ts"] == 1.0
        assert c["end_ts"] == 2.0
        assert "SYN" in c["flags_summary"]
        assert "ACK" in c["flags_summary"]

    def test_fwd_rev_with_multiple_packets(self):
        """3 forward + 2 reverse packets."""
        key = "10.0.0.1:80-10.0.0.2:9999-tcp"
        raw = [
            {"key": key, "proto": "tcp", "src": "10.0.0.1", "sport": 80,
             "dst": "10.0.0.2", "dport": 9999, "length": 50, "ts": 0.0,
             "app_proto": None, "flags": "SYN"},
            {"key": key, "proto": "tcp", "src": "10.0.0.1", "sport": 80,
             "dst": "10.0.0.2", "dport": 9999, "length": 40, "ts": 0.1,
             "app_proto": None, "flags": "ACK"},
            {"key": key, "proto": "tcp", "src": "10.0.0.2", "sport": 9999,
             "dst": "10.0.0.1", "dport": 80, "length": 30, "ts": 0.2,
             "app_proto": None, "flags": "ACK"},
            {"key": key, "proto": "tcp", "src": "10.0.0.1", "sport": 80,
             "dst": "10.0.0.2", "dport": 9999, "length": 60, "ts": 0.3,
             "app_proto": None, "flags": "PSH,ACK"},
            {"key": key, "proto": "tcp", "src": "10.0.0.2", "sport": 9999,
             "dst": "10.0.0.1", "dport": 80, "length": 20, "ts": 0.4,
             "app_proto": None, "flags": "ACK"},
        ]
        result = build_conversations(raw)
        c = result[0]
        assert c["packet_count"] == 5
        assert c["fwd_packet_count"] == 3
        assert c["byte_count"] == 200
        assert c["fwd_byte_count"] == 150

    def test_missing_src_defaults_all_forward(self):
        """When src/sport are not provided, all packets are forward."""
        raw = [
            {"key": "a:1-b:2-tcp", "length": 10, "ts": 0.0, "app_proto": None, "flags": "SYN"},
        ]
        result = build_conversations(raw)
        assert result[0]["fwd_packet_count"] == 1

    def test_multiple_conversations(self):
        raw = [
            {"key": "a:80-b:1234-tcp", "proto": "tcp", "src": "a", "sport": 80,
             "dst": "b", "dport": 1234, "length": 50, "ts": 1.0, "app_proto": "HTTP", "flags": "SYN"},
            {"key": "c:53-d:5678-udp", "proto": "udp", "src": "c", "sport": 53,
             "dst": "d", "dport": 5678, "length": 30, "ts": 2.0, "app_proto": "DNS", "flags": ""},
        ]
        result = build_conversations(raw)
        assert len(result) == 2
        result.sort(key=lambda x: x["proto"])
        assert result[0]["proto"] == "tcp"
        assert result[1]["proto"] == "udp"
        assert result[0]["app_proto"] == "HTTP"
        assert result[1]["app_proto"] == "DNS"

    def test_missing_key_skipped(self):
        raw = [
            {"key": "", "length": 100, "ts": 1.0, "app_proto": None, "flags": ""},
        ]
        result = build_conversations(raw)
        assert len(result) == 0

    def test_key_without_port(self):
        raw = [
            {"key": "10.0.0.1-10.0.0.2-icmp", "proto": "icmp",
             "src": "10.0.0.1", "sport": 0, "dst": "10.0.0.2", "dport": 0,
             "length": 100, "ts": 1.0, "app_proto": None, "flags": ""},
        ]
        result = build_conversations(raw)
        assert len(result) == 1
        c = result[0]
        assert c["src_ip"] == "10.0.0.1"
        assert c["src_port"] == 0
        assert c["dst_port"] == 0

    def test_flags_aggregation(self):
        key = "a:1-b:2-tcp"
        raw = [
            {"key": key, "src": "a", "sport": 1, "dst": "b", "dport": 2,
             "length": 10, "ts": 0.0, "app_proto": None, "flags": "SYN"},
            {"key": key, "src": "a", "sport": 1, "dst": "b", "dport": 2,
             "length": 10, "ts": 0.1, "app_proto": None, "flags": "SYN,ACK"},
            {"key": key, "src": "a", "sport": 1, "dst": "b", "dport": 2,
             "length": 10, "ts": 0.2, "app_proto": None, "flags": "ACK,FIN"},
        ]
        result = build_conversations(raw)
        assert len(result) == 1
        flags = result[0]["flags_summary"]
        assert "ACK" in flags
        assert "FIN" in flags
        assert "SYN" in flags
        assert flags == "ACK,FIN,SYN"

    def test_empty_flags_returns_none(self):
        raw = [
            {"key": "a:1-b:2-tcp", "src": "a", "sport": 1, "dst": "b", "dport": 2,
             "length": 10, "ts": 0.0, "app_proto": None, "flags": ""},
        ]
        result = build_conversations(raw)
        assert result[0]["flags_summary"] is None

    def test_aggregation_large_counts(self):
        raw = []
        for i in range(100):
            raw.append({
                "key": "a:1-b:2-tcp",
                "src": "a", "sport": 1, "dst": "b", "dport": 2,
                "length": 1,
                "ts": float(i),
                "app_proto": None,
                "flags": "ACK" if i % 2 == 0 else "PSH",
            })
        result = build_conversations(raw)
        assert result[0]["packet_count"] == 100
        assert result[0]["byte_count"] == 100
        assert result[0]["fwd_packet_count"] == 100


class TestFlowBuilder:
    def test_incremental_feed(self):
        builder = FlowBuilder()
        builder.feed({"key": "a:1-b:2-tcp", "proto": "tcp", "src": "a", "sport": 1,
                       "dst": "b", "dport": 2, "length": 10, "ts": 0.0,
                       "app_proto": None, "flags": "SYN"})
        builder.feed({"key": "a:1-b:2-tcp", "proto": "tcp", "src": "b", "sport": 2,
                       "dst": "a", "dport": 1, "length": 20, "ts": 1.0,
                       "app_proto": None, "flags": "ACK"})
        result = builder.build()
        assert len(result) == 1
        c = result[0]
        assert c["packet_count"] == 2
        assert c["fwd_packet_count"] == 1

    def test_high_cardinality_overflow_bucket(self):
        """After MAX_FLOWS unique keys, additional packets aggregate into a
        synthetic overflow flow so memory stays bounded."""
        builder = FlowBuilder()
        original_max = FlowBuilder.MAX_FLOWS
        try:
            FlowBuilder.MAX_FLOWS = 3
            for i in range(5):
                builder.feed({
                    "key": f"10.0.0.{i}:1-10.0.0.{i+1}:2-tcp",
                    "proto": "tcp",
                    "src": f"10.0.0.{i}", "sport": 1,
                    "dst": f"10.0.0.{i+1}", "dport": 2,
                    "length": 10, "ts": float(i),
                    "app_proto": None, "flags": "",
                })
            result = builder.build()
            assert len(result) == 4  # 3 real + 1 overflow
            overflow = next(c for c in result if c["key"] == "__overflow__")
            assert overflow["packet_count"] == 2
            assert overflow["byte_count"] == 20
        finally:
            FlowBuilder.MAX_FLOWS = original_max
