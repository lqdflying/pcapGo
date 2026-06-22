"""Integration tests for /api/captures/{id}/session-packets."""
import json
import struct
import uuid
from pathlib import Path

import pytest


_OFFSET_FMT = struct.Struct("<QQ")


def _write_session_sidecars(index_path: str, packets: list[dict]):
    """Write minimal .summary.jsonl, .offsets.bin, .index.json for session-packets tests."""
    base = index_path.replace(".index.json", "")
    summary_path = Path(f"{base}.summary.jsonl")
    offsets_path = Path(f"{base}.offsets.bin")
    index_file = Path(index_path)

    summary_lines = []
    offsets_data = bytearray()
    jsonl_offset = 0  # dummy for jsonl (not used by session-packets)
    summary_offset = 0

    for i, pkt in enumerate(packets):
        pkt_with_idx = {**pkt, "idx": i}
        line = json.dumps(pkt_with_idx) + "\n"
        line_bytes = line.encode("utf-8")
        offsets_data += _OFFSET_FMT.pack(jsonl_offset, summary_offset)
        summary_lines.append(line_bytes)
        summary_offset += len(line_bytes)
        jsonl_offset += 100  # dummy

    summary_path.write_bytes(b"".join(summary_lines))
    offsets_path.write_bytes(bytes(offsets_data))
    index_file.write_text(json.dumps({"total": len(packets), "linktype": 1}))


def _cleanup_session_sidecars(index_path: str):
    for suffix in (".index.json", ".summary.jsonl", ".offsets.bin"):
        Path(index_path.replace(".index.json", suffix)).unlink(missing_ok=True)


def _append_malformed_summary_line(index_path: str):
    base = index_path.replace(".index.json", "")
    summary_path = Path(f"{base}.summary.jsonl")
    offsets_path = Path(f"{base}.offsets.bin")
    offset = summary_path.stat().st_size
    with summary_path.open("ab") as f:
        f.write(b"{malformed json\n")
    with offsets_path.open("ab") as f:
        f.write(_OFFSET_FMT.pack(0, offset))


def _make_tcp_packets():
    """Build 5 TCP packets matching the test_conversation fixture (10.0.0.1:443 <-> 10.0.0.2:54321)."""
    packets = []
    for i in range(5):
        if i % 2 == 0:
            # Forward direction
            packets.append({
                "ts": 1000.0 + i * 0.01,
                "src": "10.0.0.1", "dst": "10.0.0.2",
                "proto": "TCP", "length": 66,
                "info": f"443 > 54321 [{'SYN' if i == 0 else 'ACK'}] Seq={i}",
            })
        else:
            # Reverse direction
            packets.append({
                "ts": 1000.0 + i * 0.01,
                "src": "10.0.0.2", "dst": "10.0.0.1",
                "proto": "TCP", "length": 66,
                "info": f"54321 > 443 [{'SYN ACK' if i == 1 else 'ACK'}] Seq={i}",
            })
    return packets


@pytest.mark.integration
class TestSessionPackets:
    async def test_returns_200_with_matching_packets(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        packets = _make_tcp_packets()
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets",
                params={
                    "src_ip": "10.0.0.1", "src_port": 443,
                    "dst_ip": "10.0.0.2", "dst_port": 54321,
                    "proto": "tcp",
                },
            )
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 5
            assert len(data["items"]) == 5
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_packets_ordered_by_timestamp(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        packets = _make_tcp_packets()
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets",
                params={
                    "src_ip": "10.0.0.1", "src_port": 443,
                    "dst_ip": "10.0.0.2", "dst_port": 54321,
                    "proto": "tcp",
                },
            )
            data = response.json()
            timestamps = [p["ts"] for p in data["items"]]
            assert timestamps == sorted(timestamps)
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_geo_ip_enrichment(
        self, test_client_authenticated, test_capture, test_conversation, monkeypatch
    ):
        packets = _make_tcp_packets()
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        try:
            # The endpoint imports geoip lazily inside the handler so we
            # monkeypatch at the source module.
            import app.services.geoip as geoip_mod
            monkeypatch.setattr(
                geoip_mod, "lookup_country",
                lambda ip: ("JP", "Japan") if ip == "10.0.0.1" else ("US", "United States"),
            )

            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets",
                params={
                    "src_ip": "10.0.0.1", "src_port": 443,
                    "dst_ip": "10.0.0.2", "dst_port": 54321,
                    "proto": "tcp",
                },
            )
            data = response.json()
            assert data["src_geo"]["country_code"] == "JP"
            assert data["dst_geo"]["country_code"] == "US"
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_pagination_offset_limit(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        packets = _make_tcp_packets()
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets",
                params={
                    "src_ip": "10.0.0.1", "src_port": 443,
                    "dst_ip": "10.0.0.2", "dst_port": 54321,
                    "proto": "tcp",
                    "offset": 2, "limit": 2,
                },
            )
            data = response.json()
            assert data["total"] == 5
            assert len(data["items"]) == 2
            assert data["offset"] == 2
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_no_matching_packets_returns_empty(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        packets = _make_tcp_packets()
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets",
                params={
                    "src_ip": "9.9.9.9", "src_port": 80,
                    "dst_ip": "8.8.8.8", "dst_port": 53,
                    "proto": "tcp",
                },
            )
            data = response.json()
            assert data["total"] == 0
            assert data["items"] == []
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_invalid_proto_returns_422(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        packets = _make_tcp_packets()
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets",
                params={
                    "src_ip": "10.0.0.1", "src_port": 443,
                    "dst_ip": "10.0.0.2", "dst_port": 54321,
                    "proto": "icmp",
                },
            )
            assert response.status_code == 422
            assert response.json()["detail"] == "proto must be 'tcp' or 'udp'"
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_structured_ports_match_when_info_is_display_text(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        packets = [{
            "ts": 1000.0,
            "src": "10.0.0.1", "dst": "10.0.0.2",
            "proto": "TCP", "length": 66,
            "sport": 443, "dport": 54321,
            "info": "TLS Client Hello",
        }]
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets",
                params={
                    "src_ip": "10.0.0.1", "src_port": 443,
                    "dst_ip": "10.0.0.2", "dst_port": 54321,
                    "proto": "tcp",
                },
            )
            assert response.status_code == 200
            assert response.json()["total"] == 1
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_malformed_summary_lines_are_skipped(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        packets = _make_tcp_packets()
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        _append_malformed_summary_line(test_capture.parsed_index_path)
        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets",
                params={
                    "src_ip": "10.0.0.1", "src_port": 443,
                    "dst_ip": "10.0.0.2", "dst_port": 54321,
                    "proto": "tcp",
                },
            )
            assert response.status_code == 200
            assert response.json()["total"] == 5
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_repeated_requests_use_valid_session_cache(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        packets = _make_tcp_packets()
        _write_session_sidecars(test_capture.parsed_index_path, packets)
        try:
            params = {
                "src_ip": "10.0.0.1", "src_port": 443,
                "dst_ip": "10.0.0.2", "dst_port": 54321,
                "proto": "tcp",
            }
            first = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets", params=params
            )
            second = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/session-packets", params=params
            )
            assert first.status_code == 200
            assert second.status_code == 200
            assert second.json()["total"] == first.json()["total"] == 5
        finally:
            _cleanup_session_sidecars(test_capture.parsed_index_path)

    async def test_nonexistent_capture_returns_404(self, test_client_authenticated):
        response = await test_client_authenticated.get(
            f"/api/captures/{uuid.uuid4()}/session-packets",
            params={
                "src_ip": "10.0.0.1", "src_port": 443,
                "dst_ip": "10.0.0.2", "dst_port": 54321,
                "proto": "tcp",
            },
        )
        assert response.status_code == 404

    async def test_non_ready_capture_returns_400(
        self, test_client_authenticated, _session_engine
    ):
        from tests.backend.conftest import _make_capture_async
        from app.models import CaptureStatus
        cap = await _make_capture_async(_session_engine, {
            "id": uuid.uuid4(),
            "user_id": test_client_authenticated._auth_user.id,
            "filename": "not-ready.pcap",
            "size_bytes": 512,
            "sha256": "e" * 64,
            "linktype": 1,
            "packet_count": 0,
            "status": CaptureStatus.uploaded,
            "stored_path": "/tmp/not-ready.pcap",
            "parsed_index_path": None,
        })
        response = await test_client_authenticated.get(
            f"/api/captures/{cap.id}/session-packets",
            params={
                "src_ip": "10.0.0.1", "src_port": 443,
                "dst_ip": "10.0.0.2", "dst_port": 54321,
                "proto": "tcp",
            },
        )
        assert response.status_code == 400
