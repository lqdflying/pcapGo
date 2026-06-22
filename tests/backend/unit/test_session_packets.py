"""Unit tests for session-packet helpers."""
from app.api.packets import _parse_ports_from_info, _ports_from_summary, _session_matches


class TestParsePortsFromInfo:
    def test_tcp_standard_format(self):
        assert _parse_ports_from_info("443 > 54321 [SYN ACK] Seq=0 Ack=1") == (443, 54321)

    def test_udp_format(self):
        assert _parse_ports_from_info("53 > 50164 Len=128") == (53, 50164)

    def test_no_ports_icmp(self):
        assert _parse_ports_from_info("ICMP echo request") == (0, 0)

    def test_empty_info(self):
        assert _parse_ports_from_info("") == (0, 0)

    def test_partial_info(self):
        assert _parse_ports_from_info("some random text") == (0, 0)

    def test_high_port_numbers(self):
        assert _parse_ports_from_info("65535 > 1 [ACK]") == (65535, 1)


class TestPortsFromSummary:
    def test_prefers_structured_ports(self):
        summary = {"sport": 443, "dport": 54321, "info": "unparseable display text"}
        assert _ports_from_summary(summary) == (443, 54321)

    def test_accepts_structured_port_strings(self):
        summary = {"src_port": "53", "dst_port": "50164", "info": "DNS response"}
        assert _ports_from_summary(summary) == (53, 50164)

    def test_falls_back_to_info_ports(self):
        summary = {"info": "443 > 54321 [ACK]"}
        assert _ports_from_summary(summary) == (443, 54321)

    def test_returns_zero_ports_for_malformed_summary(self):
        summary = {"src_port": "dns", "dst_port": 50164, "info": "DNS response"}
        assert _ports_from_summary(summary) == (0, 0)


class TestSessionMatches:
    def test_matches_forward_direction(self):
        summary = {"src": "10.0.0.1", "dst": "10.0.0.2", "proto": "TCP", "info": "443 > 54321 [SYN]"}
        assert _session_matches(summary, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_matches_reverse_direction(self):
        summary = {"src": "10.0.0.2", "dst": "10.0.0.1", "proto": "TCP", "info": "54321 > 443 [ACK]"}
        assert _session_matches(summary, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_matches_same_ip_opposite_ports(self):
        summary = {"src": "127.0.0.1", "dst": "127.0.0.1", "proto": "TCP", "sport": 9000, "dport": 9001}
        assert _session_matches(summary, "127.0.0.1", 9000, "127.0.0.1", 9001, "tcp")

    def test_rejects_same_ip_wrong_port_direction(self):
        summary = {"src": "127.0.0.1", "dst": "127.0.0.1", "proto": "TCP", "sport": 9001, "dport": 9000}
        assert not _session_matches(summary, "127.0.0.1", 9000, "127.0.0.1", 9001, "tcp")

    def test_rejects_wrong_ips(self):
        summary = {"src": "10.0.0.3", "dst": "10.0.0.2", "proto": "TCP", "info": "443 > 54321 [SYN]"}
        assert not _session_matches(summary, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_rejects_wrong_proto(self):
        summary = {"src": "10.0.0.1", "dst": "10.0.0.2", "proto": "UDP", "info": "443 > 54321"}
        assert not _session_matches(summary, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_rejects_wrong_ports(self):
        summary = {"src": "10.0.0.1", "dst": "10.0.0.2", "proto": "TCP", "info": "80 > 54321 [SYN]"}
        assert not _session_matches(summary, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_rejects_malformed_info_when_ports_are_required(self):
        summary = {"src": "10.0.0.1", "dst": "10.0.0.2", "proto": "TCP", "info": "display text without ports"}
        assert not _session_matches(summary, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")
