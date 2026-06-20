"""Tests for app/services/pcap_parser.py helper functions."""

from unittest.mock import MagicMock

from app.services.pcap_parser import (
    _canonical_key,
    _tcp_flags_str,
    _tcp_info,
    _udp_info,
    _layer_to_dict,
    _extract_meta,
    _detect_app_proto,
)


class TestCanonicalKey:
    def test_src_smaller(self):
        result = _canonical_key("10.0.0.1", 443, "10.0.0.2", 54321, "tcp")
        assert result == "10.0.0.1:443-10.0.0.2:54321-tcp"

    def test_src_larger(self):
        result = _canonical_key("10.0.0.100", 443, "10.0.0.1", 80, "tcp")
        assert result == "10.0.0.1:80-10.0.0.100:443-tcp"

    def test_equal_ips(self):
        result = _canonical_key("10.0.0.1", 80, "10.0.0.1", 443, "tcp")
        expected = "10.0.0.1:80-10.0.0.1:443-tcp"
        assert result == expected


class TestTCPFlagsStr:
    def test_all_flags(self):
        flags = 0x02 | 0x10 | 0x01 | 0x04 | 0x08 | 0x20  # SYN,ACK,FIN,RST,PSH,URG
        result = _tcp_flags_str(flags)
        assert "SYN" in result
        assert "ACK" in result
        assert "FIN" in result
        assert "RST" in result
        assert "PSH" in result
        assert "URG" in result
        assert result == "SYN,ACK,FIN,RST,PSH,URG"

    def test_syn_only(self):
        assert _tcp_flags_str(0x02) == "SYN"

    def test_syn_ack(self):
        assert _tcp_flags_str(0x12) == "SYN,ACK"

    def test_no_flags(self):
        assert _tcp_flags_str(0) == ""

    def test_unknown_bits_ignored(self):
        assert _tcp_flags_str(0xFF) == "SYN,ACK,FIN,RST,PSH,URG"


class TestTCPInfo:
    def test_with_ack(self):
        mock_tcp = MagicMock()
        mock_tcp.sport = 443
        mock_tcp.dport = 54321
        mock_tcp.flags = 0x12  # SYN,ACK
        mock_tcp.seq = 100
        mock_tcp.ack = 200
        info = _tcp_info(mock_tcp)
        assert "443" in info
        assert "54321" in info
        assert "SYN ACK" in info
        assert "Seq=100" in info
        assert "Ack=200" in info

    def test_without_ack(self):
        mock_tcp = MagicMock()
        mock_tcp.sport = 443
        mock_tcp.dport = 54321
        mock_tcp.flags = 0x02  # SYN only
        mock_tcp.seq = 100
        mock_tcp.ack = 0
        info = _tcp_info(mock_tcp)
        assert "SYN" in info
        assert "Seq=" not in info  # No ACK flag


class TestUDPInfo:
    def test_format(self):
        mock_udp = MagicMock()
        mock_udp.sport = 53
        mock_udp.dport = 12345
        mock_udp.len = 512
        info = _udp_info(mock_udp)
        assert info == "53 > 12345 Len=512"


class TestLayerToDict:
    def test_leaf_layer(self):
        layer = {"name": "Ethernet", "summary": "Ethernet II", "offset": 0, "length": 14, "children": []}
        result = _layer_to_dict(layer)
        assert result["name"] == "Ethernet"
        assert result["children"] == []

    def test_nested_children(self):
        leaf = {"name": "TCP", "summary": "TCP", "offset": 34, "length": 20, "children": []}
        ip = {"name": "IP", "summary": "IP", "offset": 14, "length": 20, "children": [leaf]}
        ether = {"name": "Ethernet", "summary": "Ethernet II", "offset": 0, "length": 14, "children": [ip]}
        result = _layer_to_dict(ether)
        assert result["name"] == "Ethernet"
        assert len(result["children"]) == 1
        assert result["children"][0]["name"] == "IP"
        assert len(result["children"][0]["children"]) == 1
        assert result["children"][0]["children"][0]["name"] == "TCP"


class TestDetectAppProto:
    def test_tcp_http_both_directions(self):
        assert _detect_app_proto(80, 54321, tcp=True) == "HTTP"
        assert _detect_app_proto(54321, 80, tcp=True) == "HTTP"

    def test_tcp_http_alt_port_8080(self):
        assert _detect_app_proto(54321, 8080, tcp=True) == "HTTP"

    def test_tcp_tls_including_8443(self):
        assert _detect_app_proto(443, 50000, tcp=True) == "TLS"
        assert _detect_app_proto(50000, 8443, tcp=True) == "TLS"

    def test_tcp_db_protocols(self):
        assert _detect_app_proto(3306, 50000, tcp=True) == "MySQL"
        assert _detect_app_proto(50000, 5432, tcp=True) == "PostgreSQL"
        assert _detect_app_proto(6379, 50000, tcp=True) == "Redis"

    def test_tcp_other_services(self):
        assert _detect_app_proto(22, 50000, tcp=True) == "SSH"
        assert _detect_app_proto(50000, 25, tcp=True) == "SMTP"
        assert _detect_app_proto(50000, 587, tcp=True) == "SMTP"
        assert _detect_app_proto(21, 50000, tcp=True) == "FTP"

    def test_tcp_unknown_returns_none(self):
        assert _detect_app_proto(12345, 54321, tcp=True) is None

    def test_udp_dns(self):
        assert _detect_app_proto(53, 12345, tcp=False) == "DNS"
        assert _detect_app_proto(12345, 53, tcp=False) == "DNS"

    def test_udp_non_dns_returns_none(self):
        assert _detect_app_proto(12345, 54321, tcp=False) is None


class TestExtractMeta:
    def test_tcp_ipv4_with_app_detection(self):
        """Test extract_meta with a TCP packet to port 80 (HTTP detection)."""
        pkt = MagicMock()

        def mock_getlayer(layer_cls):
            if layer_cls.__name__ == "IP":
                ip_mock = MagicMock()
                ip_mock.src = "10.0.0.1"
                ip_mock.dst = "10.0.0.2"
                return ip_mock
            if layer_cls.__name__ == "TCP":
                tcp_mock = MagicMock()
                tcp_mock.sport = 12345
                tcp_mock.dport = 80
                tcp_mock.flags = 0x02  # SYN
                tcp_mock.seq = 0
                tcp_mock.ack = 0
                return tcp_mock
            return None

        pkt.getlayer = mock_getlayer
        pkt.summary.return_value = "TCP SYN"
        pkt.haslayer = lambda x: False

        meta = _extract_meta(pkt, [])
        assert meta["src"] == "10.0.0.1"
        assert meta["dst"] == "10.0.0.2"
        assert meta["proto"] == "TCP"
        assert meta["sport"] == 12345
        assert meta["dport"] == 80
        assert meta["app_proto"] == "HTTP"
        assert "SYN" in meta["flags_set"]
        assert meta["conv_key"] == "10.0.0.1:12345-10.0.0.2:80-tcp"

    def test_no_ip_fallback(self):
        pkt = MagicMock()
        pkt.getlayer.return_value = None
        pkt.summary.return_value = "Raw packet"
        pkt.haslayer = lambda x: False

        meta = _extract_meta(pkt, [])
        assert meta["src"] == "unknown"
        assert meta["dst"] == "unknown"
        assert meta["proto"] == "Unknown"

    def test_long_info_truncation(self):
        pkt = MagicMock()
        pkt.getlayer.return_value = None
        pkt.haslayer = lambda x: False
        long_summary = "x" * 300
        pkt.summary.return_value = long_summary

        meta = _extract_meta(pkt, [])
        assert len(meta["info"]) <= 200
        assert meta["info"].endswith("...")
