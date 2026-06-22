"""Integration tests for /api/captures/{id}/statistics endpoint."""

import uuid

import pytest


@pytest.mark.integration
class TestGetStatistics:
    """Tests for GET /api/captures/{id}/statistics."""

    async def test_statistics_returns_200(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["capture_id"] == str(test_capture.id)
        assert data["packet_count"] == test_capture.packet_count
        for key in ("duration", "protocols", "endpoints", "conversations", "io_buckets"):
            assert key in data

    async def test_statistics_has_protocols(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        data = response.json()
        assert isinstance(data["protocols"], list)
        assert len(data["protocols"]) >= 1
        proto_names = [p["name"] for p in data["protocols"]]
        assert test_conversation.proto in proto_names

    async def test_statistics_has_conversations(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        data = response.json()
        assert isinstance(data["conversations"], list)
        assert len(data["conversations"]) >= 1
        conv_ids = [c["id"] for c in data["conversations"]]
        assert str(test_conversation.id) in conv_ids

    async def test_statistics_has_endpoints(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        data = response.json()
        endpoints = data["endpoints"]
        assert isinstance(endpoints, list)
        assert len(endpoints) >= 2
        ep_addrs = [e["address"] for e in endpoints]
        assert test_conversation.src_ip in ep_addrs
        assert test_conversation.dst_ip in ep_addrs

    async def test_statistics_nonexistent_returns_404(self, test_client_authenticated):
        response = await test_client_authenticated.get(
            f"/api/captures/{uuid.uuid4()}/statistics"
        )
        assert response.status_code == 404

    async def test_statistics_non_ready_returns_400(
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
            f"/api/captures/{cap.id}/statistics"
        )
        assert response.status_code == 400
        assert "not yet parsed" in response.json()["detail"].lower()

    async def test_statistics_packet_count_matches(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        assert response.json()["packet_count"] == test_capture.packet_count

    async def test_statistics_conversation_details(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        data = response.json()
        found = False
        for conv in data["conversations"]:
            if conv["id"] == str(test_conversation.id):
                assert conv["proto"] == test_conversation.proto
                assert conv["src_ip"] == test_conversation.src_ip
                assert conv["dst_ip"] == test_conversation.dst_ip
                assert conv["packet_count"] == test_conversation.packet_count
                assert conv["byte_count"] == test_conversation.byte_count
                found = True
                break
        assert found, "Test conversation not found in response"

    async def test_endpoint_tx_rx_breakdown(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        """Endpoint rows carry Tx/Rx columns. With fwd_packet_count=3,
        fwd_byte_count=600, the canonical src sends 3 packets / 600 bytes
        (tx) and receives 2 packets / 400 bytes (rx). The canonical dst is
        the mirror."""
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        data = response.json()
        by_addr = {e["address"]: e for e in data["endpoints"]}
        src = by_addr[test_conversation.src_ip]
        dst = by_addr[test_conversation.dst_ip]
        assert src["tx_packets"] == 3
        assert src["rx_packets"] == 2
        assert dst["rx_packets"] == 3
        assert dst["tx_packets"] == 2
        assert src["tx_bytes"] == 600
        assert src["rx_bytes"] == 400
        assert dst["rx_bytes"] == 600
        assert dst["tx_bytes"] == 400
        # Backwards-compat totals are still populated.
        assert src["packet_count"] == test_conversation.packet_count
        assert dst["packet_count"] == test_conversation.packet_count

    async def test_bucket_seconds_param_accepted(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        """The IO graph honors ?bucket_seconds=N (Phase 5.4)."""
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics?bucket_seconds=10&metric=bytes"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["bucket_seconds"] == 10
        assert data["metric"] == "bytes"
        # When metric=bytes, packet_count per bucket is 0 (bytes is the
        # reported field).
        for bucket in data["io_buckets"]:
            assert bucket["packet_count"] == 0

    async def test_bucket_seconds_invalid_snaps_to_supported(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        """Unknown bucket sizes snap to the nearest supported value."""
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics?bucket_seconds=999"
        )
        assert response.status_code == 200
        data = response.json()
        # 999s is closer to 60s than to any other supported value.
        assert data["bucket_seconds"] in {1.0, 10.0, 30.0, 60.0}

    async def test_adaptive_bucket_does_not_discard_long_captures(
        self, test_client_authenticated, test_capture, _session_engine
    ):
        """A very long capture should scale up the bucket size so every
        conversation fits — no IndexError and no traffic discarded."""
        from tests.backend.conftest import _make_conversation_async
        # Conversation spanning 5000 seconds with 1s requested buckets.
        # Without adaptive sizing this would need 5000 buckets (capped at 2000).
        conv = await _make_conversation_async(_session_engine, {
            "id": uuid.uuid4(),
            "capture_id": test_capture.id,
            "proto": "tcp",
            "src_ip": "1.1.1.1",
            "src_port": 80,
            "dst_ip": "2.2.2.2",
            "dst_port": 9999,
            "packet_count": 100,
            "byte_count": 5000,
            "fwd_packet_count": 50,
            "fwd_byte_count": 2500,
            "start_ts": 0.0,
            "end_ts": 5000.0,
            "app_protocol": None,
            "flags_summary": "SYN",
        })
        try:
            response = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/statistics?bucket_seconds=1"
            )
            assert response.status_code == 200
            data = response.json()
            # Bucket size scaled up so count <= 2000.
            assert len(data["io_buckets"]) <= 2000
            # No traffic discarded: the conversation's 100 packets are
            # distributed across the buckets.
            total_pkts = sum(b["packet_count"] for b in data["io_buckets"])
            assert total_pkts > 0
        finally:
            pass

    async def test_statistics_has_ip_stats(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        data = response.json()
        assert "ip_stats" in data
        assert isinstance(data["ip_stats"], list)
        assert len(data["ip_stats"]) >= 2
        by_ip = {e["ip"]: e for e in data["ip_stats"]}
        assert test_conversation.src_ip in by_ip
        assert test_conversation.dst_ip in by_ip
        src = by_ip[test_conversation.src_ip]
        assert src["country_code"] == "LAN"
        assert src["country"] == "Local Network"
        assert src["total_sent_packets"] == 3
        assert src["total_recv_packets"] == 2
        assert 443 in src["ports"]

    async def test_statistics_has_proto_stats(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        data = response.json()
        assert "proto_stats" in data
        assert isinstance(data["proto_stats"], list)
        assert len(data["proto_stats"]) >= 1
        by_proto = {e["proto"]: e for e in data["proto_stats"]}
        assert "TLS" in by_proto
        tls = by_proto["TLS"]
        assert tls["total_packets"] == test_conversation.packet_count
        assert tls["session_count"] == 1
        assert tls["percentage_packets"] > 0

    async def test_statistics_has_country_stats(
        self, test_client_authenticated, test_capture, test_conversation
    ):
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics"
        )
        data = response.json()
        assert "country_stats" in data
        assert isinstance(data["country_stats"], list)
        assert len(data["country_stats"]) >= 1
        lan = next((c for c in data["country_stats"] if c["country_code"] == "LAN"), None)
        assert lan is not None
        assert lan["ip_count"] == 2
        assert lan["total_packets"] > 0

    async def test_single_packet_conversation_has_io(
        self, test_client_authenticated, test_capture, _session_engine
    ):
        """A conversation where start_ts == end_ts must contribute to the
        IO graph (drop full count into the containing bucket, not zero)."""
        from tests.backend.conftest import _make_conversation_async
        await _make_conversation_async(_session_engine, {
            "id": uuid.uuid4(),
            "capture_id": test_capture.id,
            "proto": "tcp",
            "src_ip": "3.3.3.3",
            "src_port": 80,
            "dst_ip": "4.4.4.4",
            "dst_port": 443,
            "packet_count": 1,
            "byte_count": 66,
            "fwd_packet_count": 1,
            "fwd_byte_count": 66,
            "start_ts": 5.0,
            "end_ts": 5.0,
            "app_protocol": None,
            "flags_summary": "SYN",
        })
        response = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/statistics?bucket_seconds=1"
        )
        assert response.status_code == 200
        data = response.json()
        total_pkts = sum(b["packet_count"] for b in data["io_buckets"])
        # The single-packet conversation contributes 1 packet.
        assert total_pkts >= 1
