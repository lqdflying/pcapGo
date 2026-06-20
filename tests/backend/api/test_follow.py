"""Integration tests for GET /api/captures/{id}/follow (Follow Stream)."""

import base64
from pathlib import Path

import pytest

from app.services.follow import follow_stream_sync


CLIENT_PAYLOAD = b"GET / HTTP/1.0\r\nHost: example\r\n\r\n"
SERVER_PAYLOAD = b"HTTP/1.0 200 OK\r\n\r\nhello world"


def _write_tcp_conversation(path: str) -> None:
    """Write a small two-way TCP conversation pcap to ``path``."""
    from scapy.layers.inet import IP, TCP
    from scapy.utils import wrpcap

    c = IP(src="10.0.0.1", dst="10.0.0.2") / TCP(sport=12345, dport=80, flags="PA") / CLIENT_PAYLOAD
    s = IP(src="10.0.0.2", dst="10.0.0.1") / TCP(sport=80, dport=12345, flags="PA") / SERVER_PAYLOAD
    wrpcap(path, [c, s])


@pytest.mark.integration
class TestFollowStream:
    async def test_reconstructs_both_directions(
        self, test_client_authenticated, test_capture
    ):
        _write_tcp_conversation(test_capture.stored_path)
        try:
            r = await test_client_authenticated.get(
                f"/api/captures/{test_capture.id}/follow",
                params={
                    "src_ip": "10.0.0.1",
                    "src_port": 12345,
                    "dst_ip": "10.0.0.2",
                    "dst_port": 80,
                    "proto": "tcp",
                },
            )
            assert r.status_code == 200
            body = r.json()
            assert body["proto"] == "tcp"
            assert len(body["segments"]) == 2
            assert body["segments"][0]["direction"] == "client"
            assert body["segments"][1]["direction"] == "server"
            assert base64.b64decode(body["segments"][0]["data_b64"]) == CLIENT_PAYLOAD
            assert base64.b64decode(body["segments"][1]["data_b64"]) == SERVER_PAYLOAD
            assert body["client_bytes"] == len(CLIENT_PAYLOAD)
            assert body["server_bytes"] == len(SERVER_PAYLOAD)
            assert body["truncated"] is False
        finally:
            Path(test_capture.stored_path).unlink(missing_ok=True)

    async def test_invalid_proto_returns_422(
        self, test_client_authenticated, test_capture
    ):
        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/follow",
            params={
                "src_ip": "10.0.0.1",
                "src_port": 1,
                "dst_ip": "10.0.0.2",
                "dst_port": 2,
                "proto": "icmp",
            },
        )
        assert r.status_code == 422

    async def test_missing_file_returns_404(
        self, test_client_authenticated, test_capture
    ):
        # test_capture.stored_path ("/tmp/test.pcap") does not exist here.
        Path(test_capture.stored_path).unlink(missing_ok=True)
        r = await test_client_authenticated.get(
            f"/api/captures/{test_capture.id}/follow",
            params={
                "src_ip": "10.0.0.1",
                "src_port": 12345,
                "dst_ip": "10.0.0.2",
                "dst_port": 80,
                "proto": "tcp",
            },
        )
        assert r.status_code == 404

    async def test_requires_auth(self, test_client, test_capture):
        r = await test_client.get(
            f"/api/captures/{test_capture.id}/follow",
            params={
                "src_ip": "10.0.0.1",
                "src_port": 1,
                "dst_ip": "10.0.0.2",
                "dst_port": 2,
                "proto": "tcp",
            },
        )
        assert r.status_code in (401, 403)


@pytest.mark.integration
class TestFollowStreamService:
    """Direct unit tests for the reconstruction service."""

    def test_byte_cap_truncates(self, tmp_path):
        path = str(tmp_path / "conv.pcap")
        _write_tcp_conversation(path)
        result = follow_stream_sync(
            path, "tcp", "10.0.0.1", 12345, "10.0.0.2", 80, max_bytes=5
        )
        assert result["truncated"] is True
        assert result["client_bytes"] == 5
        assert result["server_bytes"] == 5
