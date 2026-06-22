"""Unit tests for session-packet helpers."""
import pytest
from app.api.packets import _parse_ports_from_info, _session_matches


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


class TestSessionMatches:
    # Test forward direction
    def test_matches_forward_direction(self):
        s = {"src": "10.0.0.1", "dst": "10.0.0.2", "proto": "TCP", "info": "443 > 54321 [SYN]"}
        assert _session_matches(s, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    # Test reverse direction
    def test_matches_reverse_direction(self):
        s = {"src": "10.0.0.2", "dst": "10.0.0.1", "proto": "TCP", "info": "54321 > 443 [ACK]"}
        assert _session_matches(s, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_rejects_wrong_ips(self):
        s = {"src": "10.0.0.3", "dst": "10.0.0.2", "proto": "TCP", "info": "443 > 54321 [SYN]"}
        assert not _session_matches(s, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_rejects_wrong_proto(self):
        s = {"src": "10.0.0.1", "dst": "10.0.0.2", "proto": "UDP", "info": "443 > 54321"}
        assert not _session_matches(s, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_rejects_wrong_ports(self):
        s = {"src": "10.0.0.1", "dst": "10.0.0.2", "proto": "TCP", "info": "80 > 54321 [SYN]"}
        assert not _session_matches(s, "10.0.0.1", 443, "10.0.0.2", 54321, "tcp")

    def test_icmp_matches_portless(self):
        s = {"src": "10.0.0.1", "dst": "10.0.0.2", "proto": "ICMP", "info": "ICMP echo request"}
        assert _session_matches(s, "10.0.0.1", 0, "10.0.0.2", 0, "icmp")
