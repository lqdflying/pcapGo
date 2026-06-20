"""Integration test for the real pcap parser (thread/event-loop boundary).

Uses scapy to craft a small pcap, runs parse_pcap against a temp directory,
and verifies the sidecar files + conversations are correct.
"""

import asyncio
import json
import struct
import uuid
from pathlib import Path

import pytest


def _make_pcap_with_tcp_handshake(path: str):
    """Write a minimal pcap containing a few TCP packets using scapy."""
    from scapy.all import wrpcap, IP, TCP, Ether

    pkts = [
        Ether(src="00:11:22:33:44:55", dst="66:77:88:99:aa:bb") /
        IP(src="10.0.0.1", dst="10.0.0.2") / TCP(sport=12345, dport=80, flags="S", seq=100),
        Ether(src="66:77:88:99:aa:bb", dst="00:11:22:33:44:55") /
        IP(src="10.0.0.2", dst="10.0.0.1") / TCP(sport=80, dport=12345, flags="SA", seq=200, ack=101),
        Ether(src="00:11:22:33:44:55", dst="66:77:88:99:aa:bb") /
        IP(src="10.0.0.1", dst="10.0.0.2") / TCP(sport=12345, dport=80, flags="A", seq=101, ack=201),
    ]
    wrpcap(path, pkts)


@pytest.mark.integration
class TestRealParser:
    """Exercise the full parse_pcap pipeline across the thread boundary."""

    async def test_parse_produces_sidecars_and_conversations(
        self, test_client_authenticated, _session_engine, monkeypatch, tmp_path
    ):
        from app.services.pcap_parser import parse_pcap
        from app.models import Capture, Conversation, CaptureStatus
        from tests.backend.conftest import _make_capture_async
        from sqlalchemy import select

        upload_dir = tmp_path / "uploads"
        upload_dir.mkdir()
        monkeypatch.setattr("app.services.pcap_parser.settings.upload_dir", upload_dir)

        user = test_client_authenticated._auth_user
        capture_id = uuid.uuid4()
        pcap_path = upload_dir / str(user.id) / f"{capture_id}.pcap"
        pcap_path.parent.mkdir(parents=True, exist_ok=True)
        _make_pcap_with_tcp_handshake(str(pcap_path))

        cap = await _make_capture_async(_session_engine, {
            "id": capture_id,
            "user_id": user.id,
            "filename": "handshake.pcap",
            "size_bytes": pcap_path.stat().st_size,
            "sha256": "a" * 64,
            "linktype": 1,
            "packet_count": 0,
            "status": CaptureStatus.uploaded,
            "stored_path": str(pcap_path),
            "parsed_index_path": None,
        })

        await parse_pcap(str(capture_id))

        # Verify sidecars exist.
        sidecar_dir = pcap_path.parent
        jsonl = sidecar_dir / f"{capture_id}.jsonl"
        summary = sidecar_dir / f"{capture_id}.summary.jsonl"
        offsets_bin = sidecar_dir / f"{capture_id}.offsets.bin"
        index_json = sidecar_dir / f"{capture_id}.index.json"
        assert jsonl.exists(), "jsonl sidecar missing"
        assert summary.exists(), "summary sidecar missing"
        assert offsets_bin.exists(), "offsets.bin sidecar missing"
        assert index_json.exists(), "index.json sidecar missing"

        # Verify index metadata.
        meta = json.loads(index_json.read_text())
        assert meta["total"] == 3
        assert "linktype" in meta

        # Verify offsets.bin has 3 entries (16 bytes each).
        assert offsets_bin.stat().st_size == 3 * 16

        # Verify DB rows.
        from app.db.session import async_session
        async with async_session() as session:
            result = await session.execute(
                select(Capture).where(Capture.id == capture_id)
            )
            cap_row = result.scalar_one()
            assert cap_row.status == CaptureStatus.ready
            assert cap_row.packet_count == 3

            conv_result = await session.execute(
                select(Conversation).where(Conversation.capture_id == capture_id)
            )
            conversations = conv_result.scalars().all()
            assert len(conversations) == 1  # all 3 packets are the same flow
            conv = conversations[0]
            assert conv.proto == "tcp"
            assert conv.packet_count == 3
            # Forward: client->server (10.0.0.1 is canonical forward since
            # (10.0.0.1, 12345) < (10.0.0.2, 80)... actually 12345 > 80.
            # Canonical key puts smaller (ip,port) first: 10.0.0.1 < 10.0.0.2
            # so forward = 10.0.0.1 regardless of port.
            assert conv.fwd_packet_count >= 1
            assert conv.evidence_json is not None

    async def test_atomic_sidecars_no_tmp_on_failure(
        self, test_client_authenticated, _session_engine, monkeypatch, tmp_path
    ):
        """On parse failure, .tmp files must be cleaned up and no final
        sidecars should exist."""
        from app.services.pcap_parser import parse_pcap
        from app.models import Capture, CaptureStatus
        from tests.backend.conftest import _make_capture_async

        upload_dir = tmp_path / "uploads"
        upload_dir.mkdir()
        monkeypatch.setattr("app.services.pcap_parser.settings.upload_dir", upload_dir)

        user = test_client_authenticated._auth_user
        capture_id = uuid.uuid4()
        pcap_path = upload_dir / str(user.id) / f"{capture_id}.pcap"
        pcap_path.parent.mkdir(parents=True, exist_ok=True)
        # Do NOT write the file — PcapReader will raise FileNotFoundError
        # inside the worker thread, exercising the failure path.

        cap = await _make_capture_async(_session_engine, {
            "id": capture_id,
            "user_id": user.id,
            "filename": "bad.pcap",
            "size_bytes": 100,
            "sha256": "b" * 64,
            "linktype": 1,
            "packet_count": 0,
            "status": CaptureStatus.uploaded,
            "stored_path": str(pcap_path),
            "parsed_index_path": None,
        })

        with pytest.raises(Exception):
            await parse_pcap(str(capture_id))

        # Capture should be marked failed.
        from app.db.session import async_session
        from sqlalchemy import select as sa_select
        async with async_session() as session:
            result = await session.execute(
                sa_select(Capture).where(Capture.id == capture_id)
            )
            cap_row = result.scalar_one()
            assert cap_row.status == CaptureStatus.failed

        # No final sidecars or .tmp files should remain.
        sidecar_dir = pcap_path.parent
        for suffix in (".jsonl", ".summary.jsonl", ".offsets.bin", ".index.json",
                       ".jsonl.tmp", ".summary.jsonl.tmp", ".offsets.bin.tmp"):
            assert not (sidecar_dir / f"{capture_id}{suffix}").exists()

    async def test_deletion_cleans_all_sidecars(
        self, test_client_authenticated, _session_engine, monkeypatch, tmp_path
    ):
        """DELETE /api/captures/{id} must remove every sidecar file."""
        from app.services.pcap_parser import parse_pcap
        from app.models import Capture, CaptureStatus
        from tests.backend.conftest import _make_capture_async

        upload_dir = tmp_path / "uploads"
        upload_dir.mkdir()
        monkeypatch.setattr("app.services.pcap_parser.settings.upload_dir", upload_dir)

        user = test_client_authenticated._auth_user
        capture_id = uuid.uuid4()
        pcap_path = upload_dir / str(user.id) / f"{capture_id}.pcap"
        pcap_path.parent.mkdir(parents=True, exist_ok=True)
        _make_pcap_with_tcp_handshake(str(pcap_path))

        await _make_capture_async(_session_engine, {
            "id": capture_id,
            "user_id": user.id,
            "filename": "del.pcap",
            "size_bytes": pcap_path.stat().st_size,
            "sha256": "c" * 64,
            "linktype": 1,
            "packet_count": 0,
            "status": CaptureStatus.uploaded,
            "stored_path": str(pcap_path),
            "parsed_index_path": None,
        })

        await parse_pcap(str(capture_id))

        sidecar_dir = pcap_path.parent
        for suffix in (".jsonl", ".summary.jsonl", ".offsets.bin", ".index.json"):
            assert (sidecar_dir / f"{capture_id}{suffix}").exists()

        # Delete via the API.
        response = await test_client_authenticated.delete(
            f"/api/captures/{capture_id}"
        )
        assert response.status_code == 200

        for suffix in (".jsonl", ".summary.jsonl", ".offsets.bin", ".index.json"):
            assert not (sidecar_dir / f"{capture_id}{suffix}").exists()

    async def test_delete_during_parse_cleans_promoted_sidecars(
        self, test_client_authenticated, _session_engine, monkeypatch, tmp_path
    ):
        """If the capture is deleted while parsing, promoted sidecars must be
        removed when Phase 3 discovers the capture is gone."""
        import os
        from app.services import pcap_parser as parser_mod
        from app.services.pcap_parser import parse_pcap
        from app.models import Capture, CaptureStatus
        from tests.backend.conftest import _make_capture_async
        from sqlalchemy import create_engine, text

        upload_dir = tmp_path / "uploads"
        upload_dir.mkdir()
        monkeypatch.setattr("app.services.pcap_parser.settings.upload_dir", upload_dir)

        user = test_client_authenticated._auth_user
        capture_id = uuid.uuid4()
        pcap_path = upload_dir / str(user.id) / f"{capture_id}.pcap"
        pcap_path.parent.mkdir(parents=True, exist_ok=True)
        _make_pcap_with_tcp_handshake(str(pcap_path))

        await _make_capture_async(_session_engine, {
            "id": capture_id,
            "user_id": user.id,
            "filename": "race.pcap",
            "size_bytes": pcap_path.stat().st_size,
            "sha256": "d" * 64,
            "linktype": 1,
            "packet_count": 0,
            "status": CaptureStatus.uploaded,
            "stored_path": str(pcap_path),
            "parsed_index_path": None,
        })

        real_parse_file_sync = parser_mod._parse_file_sync

        def _parse_and_delete(capture_id_inner, *args, **kwargs):
            # Run the real parse (writes and promotes sidecars in the worker).
            result = real_parse_file_sync(*args, **kwargs)
            # Synchronously delete the Capture row before Phase 3 runs.
            db_url = os.environ.get(
                "DATABASE_URL", "postgresql+asyncpg://pcap:pcap@localhost:5432/pcap_test"
            ).replace("+asyncpg", "")
            engine = create_engine(db_url)
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM captures WHERE id = :id"),
                    {"id": str(capture_id_inner)},
                )
            engine.dispose()
            return result

        monkeypatch.setattr(
            parser_mod,
            "_parse_file_sync",
            lambda *args, **kwargs: _parse_and_delete(capture_id, *args, **kwargs),
        )

        await parse_pcap(str(capture_id))

        sidecar_dir = pcap_path.parent
        for suffix in (".jsonl", ".summary.jsonl", ".offsets.bin", ".index.json"):
            assert not (sidecar_dir / f"{capture_id}{suffix}").exists()
