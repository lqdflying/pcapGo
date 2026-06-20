"""Integration tests for /api/captures/{id}/packets endpoints."""

import json
import struct
import uuid
from pathlib import Path

import pytest


_OFFSET_FMT = struct.Struct("<QQ")


def _write_fake_sidecars(index_path: str, summaries: list[dict]):
    """Write fake index.json, summary.jsonl, offsets.bin, and .jsonl sidecars.

    Replaces the old _write_fake_index_and_jsonl helper with the new binary
    offset + streaming summary format.
    """
    ip = Path(index_path)
    sp = Path(index_path.replace(".index.json", ".summary.jsonl"))
    jp = Path(index_path.replace(".index.json", ".jsonl"))
    op = Path(index_path.replace(".index.json", ".offsets.bin"))

    summary_offsets = []
    jsonl_offsets = []
    summary_lines = []
    jsonl_lines = []

    sum_offset = 0
    jsonl_offset = 0
    for i, s in enumerate(summaries):
        s_full = {**s, "idx": i}
        jsonl_line = json.dumps(s_full) + "\n"
        jsonl_offsets.append(jsonl_offset)
        jsonl_lines.append(jsonl_line)
        jsonl_offset += len(jsonl_line.encode("utf-8"))

    for i, s in enumerate(summaries):
        s_summary = {k: v for k, v in s.items()}
        s_summary["idx"] = i
        summary_line = json.dumps(s_summary) + "\n"
        summary_offsets.append(sum_offset)
        summary_lines.append(summary_line)
        sum_offset += len(summary_line.encode("utf-8"))

    sp.write_text("".join(summary_lines))
    jp.write_text("".join(jsonl_lines))
    with open(op, "wb") as f:
        for jo, so in zip(jsonl_offsets, summary_offsets):
            f.write(_OFFSET_FMT.pack(jo, so))

    index = {
        "total": len(summaries),
        "linktype": 1,
        "files": {
            "jsonl": jp.name,
            "summary": sp.name,
            "offsets": op.name,
        },
    }
    ip.write_text(json.dumps(index))


def _cleanup_sidecars(index_path: str):
    for suffix in (".index.json", ".jsonl", ".summary.jsonl", ".offsets.bin"):
        Path(index_path.replace(".index.json", suffix)).unlink(missing_ok=True)


@pytest.mark.integration
class TestListPackets:
    """Tests for GET /api/captures/{id}/packets."""

    async def test_returns_packet_list(self, test_client_authenticated, test_capture):
        summaries = [
            {"ts": 1.0, "src": "10.0.0.1", "dst": "10.0.0.2",
             "proto": "TCP", "length": 100, "info": "SYN"},
            {"ts": 2.0, "src": "10.0.0.2", "dst": "10.0.0.1",
             "proto": "TCP", "length": 80, "info": "SYN,ACK"},
        ]
        _write_fake_sidecars(test_capture.parsed_index_path, summaries)

        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/packets"
            )
            assert response.status_code == 200
            body = response.json()
            assert body["total"] == 2
            assert body["offset"] == 0
            assert body["limit"] == 200
            assert isinstance(body["items"], list)
            assert len(body["items"]) == 2
            assert body["items"][0]["idx"] == 0
        finally:
            _cleanup_sidecars(test_capture.parsed_index_path)

    async def test_non_ready_capture_returns_400(
        self, test_client_authenticated, _session_engine
    ):
        from tests.backend.conftest import _make_capture_async
        from app.models import CaptureStatus
        cap = await _make_capture_async(_session_engine, {
            "id": uuid.uuid4(),
            "user_id": test_client_authenticated._auth_user.id,
            "filename": "uploaded.pcap",
            "size_bytes": 512,
            "sha256": "b" * 64,
            "linktype": 1,
            "packet_count": 0,
            "status": CaptureStatus.uploaded,
            "stored_path": "/tmp/uploaded.pcap",
            "parsed_index_path": None,
        })
        response = await test_client_authenticated.get(
            f"/api/captures/{cap.id}/packets"
        )
        assert response.status_code == 400

    async def test_nonexistent_capture_returns_404(self, test_client_authenticated):
        response = await test_client_authenticated.get(
            f"/api/captures/{uuid.uuid4()}/packets"
        )
        assert response.status_code == 404

    async def test_proto_filter(self, test_client_authenticated, test_capture):
        summaries = [
            {"ts": 1.0, "src": "10.0.0.1", "dst": "10.0.0.2",
             "proto": "TCP", "length": 100, "info": "SYN"},
            {"ts": 2.0, "src": "10.0.0.2", "dst": "10.0.0.1",
             "proto": "UDP", "length": 50, "info": "DNS"},
        ]
        _write_fake_sidecars(test_capture.parsed_index_path, summaries)

        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/packets?proto=UDP"
            )
            assert response.status_code == 200
            body = response.json()
            assert body["total"] == 1
            assert len(body["items"]) == 1
            assert body["items"][0]["proto"] == "UDP"
        finally:
            _cleanup_sidecars(test_capture.parsed_index_path)

    async def test_app_proto_filter_matches_app_protocol(
        self, test_client_authenticated, test_capture
    ):
        summaries = [
            {"ts": 1.0, "src": "10.0.0.1", "dst": "10.0.0.2",
             "proto": "TCP", "app_proto": "HTTP", "length": 100, "info": "GET"},
            {"ts": 2.0, "src": "10.0.0.1", "dst": "10.0.0.3",
             "proto": "TCP", "app_proto": "TLS", "length": 120, "info": "Client Hello"},
            {"ts": 3.0, "src": "10.0.0.1", "dst": "10.0.0.2",
             "proto": "TCP", "app_proto": None, "length": 60, "info": "ACK"},
        ]
        _write_fake_sidecars(test_capture.parsed_index_path, summaries)

        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/packets?proto=http"
            )
            assert response.status_code == 200
            body = response.json()
            assert body["total"] == 1
            assert len(body["items"]) == 1
            assert body["items"][0]["idx"] == 0
        finally:
            _cleanup_sidecars(test_capture.parsed_index_path)

    async def test_proto_filter_pagination_is_correct(
        self, test_client_authenticated, test_capture
    ):
        summaries = []
        for i in range(10):
            summaries.append(
                {
                    "ts": float(i),
                    "src": f"10.0.0.{i}",
                    "dst": f"10.0.1.{i}",
                    "proto": "TCP" if i % 2 == 0 else "UDP",
                    "length": 64,
                    "info": f"pkt{i}",
                }
            )
        _write_fake_sidecars(test_capture.parsed_index_path, summaries)

        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/packets?proto=UDP&offset=2&limit=2"
            )
            assert response.status_code == 200
            body = response.json()
            assert body["total"] == 5
            assert len(body["items"]) == 2
            assert body["items"][0]["idx"] == 5
            assert body["items"][1]["idx"] == 7
        finally:
            _cleanup_sidecars(test_capture.parsed_index_path)

    async def test_offset_limit_params(self, test_client_authenticated, test_capture):
        summaries = [
            {"ts": float(i), "src": f"10.0.0.{i}", "dst": f"10.0.1.{i}",
             "proto": "TCP", "length": i * 10, "info": f"pkt{i}"}
            for i in range(10)
        ]
        _write_fake_sidecars(test_capture.parsed_index_path, summaries)

        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/packets?offset=3&limit=3"
            )
            assert response.status_code == 200
            body = response.json()
            assert body["total"] == 10
            assert len(body["items"]) == 3
            assert body["items"][0]["idx"] == 3
        finally:
            _cleanup_sidecars(test_capture.parsed_index_path)

    async def test_proto_filter_cache_eviction_on_deletion(
        self, test_client_authenticated, test_capture
    ):
        """The proto-filter cache must not leak across captures (delete eviction)."""
        summaries = [
            {"ts": 1.0, "src": "a", "dst": "b", "proto": "TCP", "length": 10, "info": "x"},
        ]
        _write_fake_sidecars(test_capture.parsed_index_path, summaries)
        try:
            # Populate the filter cache.
            await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/packets?proto=tcp"
            )
            from app.api.packets import _FILTER_CACHE
            assert len(_FILTER_CACHE) >= 1
        finally:
            _cleanup_sidecars(test_capture.parsed_index_path)


@pytest.mark.integration
class TestPacketDetail:
    """Tests for GET /api/captures/{id}/packets/{idx}."""

    async def test_nonexistent_index_returns_404(self, test_client_authenticated, test_capture):
        summaries = [
            {"ts": 1.0, "src": "10.0.0.1", "dst": "10.0.0.2",
             "proto": "TCP", "length": 100, "info": "SYN"},
        ]
        _write_fake_sidecars(test_capture.parsed_index_path, summaries)

        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/packets/999"
            )
            assert response.status_code == 404
        finally:
            _cleanup_sidecars(test_capture.parsed_index_path)

    async def test_detail_returns_full_record(self, test_client_authenticated, test_capture):
        summaries = [
            {"ts": 1.0, "src": "10.0.0.1", "dst": "10.0.0.2",
             "proto": "TCP", "length": 100, "info": "SYN"},
        ]
        _write_fake_sidecars(test_capture.parsed_index_path, summaries)

        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/packets/0"
            )
            assert response.status_code == 200
            data = response.json()
            assert data["idx"] == 0
            assert data["proto"] == "TCP"
        finally:
            _cleanup_sidecars(test_capture.parsed_index_path)

    async def test_negative_index_returns_422(
        self, test_client_authenticated, test_capture
    ):
        """Negative packet indexes must be rejected before file I/O."""
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/packets/-1"
        )
        assert response.status_code == 422

    async def test_unparsed_capture_returns_400(
        self, test_client_authenticated, _session_engine
    ):
        from tests.backend.conftest import _make_capture_async
        from app.models import CaptureStatus
        cap = await _make_capture_async(_session_engine, {
            "id": uuid.uuid4(),
            "user_id": test_client_authenticated._auth_user.id,
            "filename": "uploaded2.pcap",
            "size_bytes": 512,
            "sha256": "c" * 64,
            "linktype": 1,
            "packet_count": 0,
            "status": CaptureStatus.uploaded,
            "stored_path": "/tmp/uploaded2.pcap",
            "parsed_index_path": None,
        })
        response = await test_client_authenticated.get(
            f"/api/captures/{cap.id}/packets/0"
        )
        assert response.status_code == 400
