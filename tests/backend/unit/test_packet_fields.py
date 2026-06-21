"""Tests for app/services/packet_fields.py — field extraction and enrichment."""

import tempfile
from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from app.services.packet_fields import (
    extract_layer_fields,
    read_packet_at,
    packet_from_raw_hex,
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

    def test_raw_load_displays_as_hex(self):
        """Raw layer's load field should display as space-separated hex,
        not Python bytes repr."""
        from scapy.packet import Raw

        layer = Raw(b"\x88\xeb\x01\x10\x00\x01\x00\x00\x00\x00")
        fields = extract_layer_fields(layer)
        load_field = next(f for f in fields if f["name"] == "load")
        assert load_field["value"] == "88 eb 01 10 00 01 00 00 00 00"
        assert not load_field["value"].startswith("b'")

    def test_raw_load_long_payload_truncated(self):
        """Raw load fields longer than 256 bytes should be truncated with a
        byte count suffix."""
        from scapy.packet import Raw

        payload = bytes(range(256)) * 2  # 512 bytes
        layer = Raw(payload)
        fields = extract_layer_fields(layer)
        load_field = next(f for f in fields if f["name"] == "load")
        assert load_field["value"].endswith("(512 bytes)")
        assert "..." in load_field["value"]
        assert not load_field["value"].startswith("b'")

    def test_raw_load_exactly_256_bytes_not_truncated(self):
        """Payloads of exactly 256 bytes should not be truncated."""
        from scapy.packet import Raw

        payload = bytes(range(256))
        layer = Raw(payload)
        fields = extract_layer_fields(layer)
        load_field = next(f for f in fields if f["name"] == "load")
        assert "..." not in load_field["value"]
        assert "bytes" not in load_field["value"]

    def test_mac_address_still_colon_separated(self):
        """The existing 6-byte MAC address formatting should still work."""
        from scapy.layers.l2 import Ether

        layer = Ether(dst="ff:ff:ff:ff:ff:ff", src="00:15:5d:64:14:93")
        fields = extract_layer_fields(layer)
        dst_field = next(f for f in fields if f["name"] == "dst")
        assert dst_field["value"] == "ff:ff:ff:ff:ff:ff"
        src_field = next(f for f in fields if f["name"] == "src")
        assert src_field["value"] == "00:15:5d:64:14:93"

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
# packet_from_raw_hex (O(1) reconstruction)
# ---------------------------------------------------------------------------

class TestPacketFromRawHex:
    def _ether_ip_tcp_raw_hex(self) -> str:
        from scapy.layers.l2 import Ether
        from scapy.layers.inet import IP, TCP
        pkt = Ether(src="00:11:22:33:44:55", dst="66:77:88:99:aa:bb") / \
            IP(src="10.0.0.1", dst="10.0.0.2") / TCP(sport=12345, dport=80)
        return " ".join(f"{b:02x}" for b in bytes(pkt))

    def test_reconstructs_ethernet_packet(self):
        raw_hex = self._ether_ip_tcp_raw_hex()
        pkt = packet_from_raw_hex(raw_hex, linktype=1)
        assert pkt is not None
        assert pkt["IP"].src == "10.0.0.1"
        assert pkt["IP"].dst == "10.0.0.2"
        assert pkt["TCP"].dport == 80

    def test_returns_none_for_empty_hex(self):
        assert packet_from_raw_hex("", linktype=1) is None
        assert packet_from_raw_hex("   ", linktype=1) is None

    def test_returns_none_for_invalid_hex(self):
        assert packet_from_raw_hex("not hex at all", linktype=1) is None
        assert packet_from_raw_hex("zz", linktype=1) is None

    def test_unknown_linktype_falls_back_to_raw(self):
        # An unknown linktype should not raise; scapy falls back to Raw.
        raw_hex = self._ether_ip_tcp_raw_hex()
        pkt = packet_from_raw_hex(raw_hex, linktype=99999)
        assert pkt is not None

    def test_known_linktype_succeeds_with_layer_import(self):
        raw_hex = self._ether_ip_tcp_raw_hex()
        pkt = packet_from_raw_hex(raw_hex, linktype=1)
        assert pkt is not None
        assert pkt["IP"].src == "10.0.0.1"

    def test_high_index_is_o1_no_pcap_scan(self, tmp_path):
        """The motivating case: enriching a deep packet must not scan from 0.

        We build a 5-packet pcap, then reconstruct packet #4 purely from its
        raw_hex WITHOUT having read_packet_at iterate the file. We assert the
        reconstructed packet matches the original high-index packet's fields.
        """
        from scapy.layers.l2 import Ether
        from scapy.layers.inet import IP, TCP
        from scapy.utils import wrpcap

        pkts = [
            Ether() / IP(src=f"10.0.0.{i}", dst="10.0.0.99") / TCP(sport=1000 + i, dport=80)
            for i in range(5)
        ]
        pcap_path = tmp_path / "many.pcap"
        wrpcap(str(pcap_path), pkts)

        # The last packet's raw_hex, derived the same way the parser stores it.
        last = pkts[-1]
        raw_hex = " ".join(f"{b:02x}" for b in bytes(last))

        # Reconstruct O(1) — this never opens the pcap.
        reconstructed = packet_from_raw_hex(raw_hex, linktype=1)
        assert reconstructed is not None
        assert reconstructed["IP"].src == "10.0.0.4"
        assert reconstructed["TCP"].sport == 1004

        # Cross-check against the slow path (which scans from 0).
        slow = read_packet_at(str(pcap_path), 4)
        assert slow is not None
        assert slow["IP"].src == reconstructed["IP"].src
        assert slow["TCP"].sport == reconstructed["TCP"].sport


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
