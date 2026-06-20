"""Tests for app/services/packet_fields.py — field extraction and enrichment."""

import tempfile
from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from app.services.packet_fields import (
    extract_layer_fields,
    read_packet_at,
    enrich_layers_with_fields,
)


# ---------------------------------------------------------------------------
# extract_layer_fields
# ---------------------------------------------------------------------------

class TestExtractLayerFields:
    def test_ethernet_fields(self):
        from scapy.layers.l2 import Ether

        layer = Ether(src="00:11:22:33:44:55", dst="66:77:88:99:aa:bb", type=0x0800)
        fields = extract_layer_fields(layer)
        names = {f["name"] for f in fields}
        assert "src" in names
        assert "dst" in names
        assert "type" in names
        src_field = next(f for f in fields if f["name"] == "src")
        assert "00:11:22:33:44:55" in src_field["value"]

    def test_ip_fields(self):
        from scapy.layers.inet import IP

        layer = IP(src="10.0.0.1", dst="10.0.0.2", ttl=64, id=1234, flags="DF")
        fields = extract_layer_fields(layer)
        names = {f["name"] for f in fields}
        for expected in ("version", "ihl", "tos", "len", "id", "flags", "frag",
                         "ttl", "proto", "chksum", "src", "dst"):
            assert expected in names, f"Missing field: {expected}"
        ttl_field = next(f for f in fields if f["name"] == "ttl")
        assert "64" in ttl_field["value"]

    def test_tcp_fields(self):
        from scapy.layers.inet import TCP

        layer = TCP(sport=80, dport=12345, seq=100, ack=200, flags="SA", window=8192)
        fields = extract_layer_fields(layer)
        names = {f["name"] for f in fields}
        for expected in ("sport", "dport", "seq", "ack", "dataofs", "flags",
                         "window", "chksum", "urgptr"):
            assert expected in names, f"Missing field: {expected}"

    def test_udp_fields(self):
        from scapy.layers.inet import UDP

        layer = UDP(sport=53, dport=1024)
        fields = extract_layer_fields(layer)
        names = {f["name"] for f in fields}
        for expected in ("sport", "dport", "len", "chksum"):
            assert expected in names, f"Missing field: {expected}"

    def test_unknown_layer_no_crash(self):
        from scapy.packet import Raw

        layer = Raw(b"\x00\x01")
        fields = extract_layer_fields(layer)
        assert isinstance(fields, list)

    def test_field_value_fallback(self):
        from unittest.mock import patch
        from scapy.layers.l2 import Ether

        layer = Ether(src="00:11:22:33:44:55", dst="66:77:88:99:aa:bb")
        fd = layer.fields_desc[0]
        with patch.object(type(fd), "i2repr", side_effect=RuntimeError("boom")):
            fields = extract_layer_fields(layer)
            assert len(fields) > 0
            assert fields[0]["value"] is not None


# ---------------------------------------------------------------------------
# read_packet_at
# ---------------------------------------------------------------------------

class TestReadPacketAt:
    def test_read_packet_at_valid(self):
        from scapy.layers.l2 import Ether
        from scapy.layers.inet import IP, TCP
        from scapy.utils import wrpcap

        pkts = [
            Ether() / IP(src="1.1.1.1", dst="2.2.2.2") / TCP(),
            Ether() / IP(src="3.3.3.3", dst="4.4.4.4") / TCP(),
            Ether() / IP(src="5.5.5.5", dst="6.6.6.6") / TCP(),
        ]
        with tempfile.NamedTemporaryFile(suffix=".pcap", delete=False) as f:
            wrpcap(f.name, pkts)
            pkt = read_packet_at(f.name, 1)
            assert pkt is not None
            assert pkt["IP"].src == "3.3.3.3"
            assert pkt["IP"].dst == "4.4.4.4"

    def test_read_packet_at_out_of_range(self):
        from scapy.layers.l2 import Ether
        from scapy.layers.inet import IP, TCP
        from scapy.utils import wrpcap

        pkts = [Ether() / IP() / TCP() for _ in range(3)]
        with tempfile.NamedTemporaryFile(suffix=".pcap", delete=False) as f:
            wrpcap(f.name, pkts)
            result = read_packet_at(f.name, 999)
            assert result is None

    def test_read_packet_at_missing_file(self):
        result = read_packet_at("/nonexistent/path.pcap", 0)
        assert result is None


# ---------------------------------------------------------------------------
# enrich_layers_with_fields
# ---------------------------------------------------------------------------

class TestEnrichLayersWithFields:
    def test_enrich_attaches_fields(self):
        from scapy.layers.l2 import Ether
        from scapy.layers.inet import IP, TCP

        pkt = Ether() / IP(src="10.0.0.1", dst="10.0.0.2") / TCP()

        record_layers = [
            {
                "name": "Ethernet",
                "summary": "Ethernet II",
                "offset": 0,
                "length": 14,
                "fields": [],
                "children": [
                    {
                        "name": "IP",
                        "summary": "IP",
                        "offset": 14,
                        "length": 20,
                        "fields": [],
                        "children": [
                            {
                                "name": "TCP",
                                "summary": "TCP",
                                "offset": 34,
                                "length": 20,
                                "fields": [],
                                "children": [],
                            }
                        ],
                    }
                ],
            }
        ]

        enrich_layers_with_fields(record_layers, pkt)

        # Flatten and check each has fields
        def _flatten(nodes):
            out = []
            for n in nodes:
                out.append(n)
                out.extend(_flatten(n.get("children", [])))
            return out

        flat = _flatten(record_layers)
        for node in flat:
            assert len(node["fields"]) > 0, f"{node['name']} has no fields"

    def test_enrich_mismatched_count(self):
        from scapy.layers.l2 import Ether
        from scapy.layers.inet import IP, TCP

        pkt = Ether() / IP() / TCP()

        record_layers = [
            {"name": "Ethernet", "summary": "", "offset": 0, "length": 14, "fields": [], "children": []},
            {"name": "IP", "summary": "", "offset": 14, "length": 20, "fields": [], "children": []},
        ]

        enrich_layers_with_fields(record_layers, pkt)
        assert len(record_layers[0]["fields"]) > 0
        assert len(record_layers[1]["fields"]) > 0

    def test_enrich_empty_record(self):
        from scapy.layers.l2 import Ether

        pkt = Ether()
        record_layers: list[dict] = []
        enrich_layers_with_fields(record_layers, pkt)
        assert record_layers == []
