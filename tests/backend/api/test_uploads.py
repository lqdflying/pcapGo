"""Integration tests for /api/captures upload, list, get, and delete endpoints."""

import hashlib
import struct
import uuid

import pytest


def make_minimal_pcap_bytes() -> bytes:
    """Create a minimal valid pcap file (24-byte global header + 16-byte packet header + 20-byte data)."""
    magic = struct.pack("<I", 0xA1B2C3D4)
    version_major = struct.pack("<H", 2)
    version_minor = struct.pack("<H", 4)
    thiszone = struct.pack("<i", 0)
    sigfigs = struct.pack("<I", 0)
    snaplen = struct.pack("<I", 65535)
    network = struct.pack("<I", 1)

    ts_sec = struct.pack("<I", 1000000)
    ts_usec = struct.pack("<I", 0)
    incl_len = struct.pack("<I", 60)
    orig_len = struct.pack("<I", 60)
    packet_data = b"\x00" * 60

    return (
        magic
        + version_major
        + version_minor
        + thiszone
        + sigfigs
        + snaplen
        + network
        + ts_sec
        + ts_usec
        + incl_len
        + orig_len
        + packet_data
    )


MINIMAL_PCAP = make_minimal_pcap_bytes()


async def _upload(test_client_authenticated, filename="test.pcap", content=None):
    """Helper: upload a file and return the response."""
    if content is None:
        content = MINIMAL_PCAP
    return await test_client_authenticated.post(
        "/api/captures",
        files={"file": (filename, content, "application/octet-stream")},
    )


@pytest.mark.integration
class TestUploadPcap:
    """Tests for POST /api/captures (upload)."""

    async def test_valid_pcap_returns_200(self, test_client_authenticated):
        response = await _upload(test_client_authenticated)
        assert response.status_code == 200

    async def test_pcapng_extension_accepted(self, test_client_authenticated):
        response = await _upload(test_client_authenticated, filename="test.pcapng")
        assert response.status_code == 200

    async def test_cap_extension_accepted(self, test_client_authenticated):
        response = await _upload(test_client_authenticated, filename="test.cap")
        assert response.status_code == 200

    async def test_txt_rejected(self, test_client_authenticated):
        response = await _upload(test_client_authenticated, filename="notes.txt")
        assert response.status_code == 400

    async def test_no_extension_rejected(self, test_client_authenticated):
        response = await _upload(test_client_authenticated, filename="nofile")
        assert response.status_code == 400

    async def test_file_too_large_rejected(self, test_client_authenticated, monkeypatch):
        import app.config
        monkeypatch.setattr(app.config.settings, "max_upload_mb", 0)
        response = await _upload(test_client_authenticated)
        assert response.status_code == 400

    async def test_file_too_small_rejected(self, test_client_authenticated):
        response = await _upload(test_client_authenticated, content=b"\x00" * 20)
        assert response.status_code == 400

    async def test_without_auth_returns_401(self, test_client):
        response = await test_client.post(
            "/api/captures",
            files={"file": ("test.pcap", MINIMAL_PCAP, "application/octet-stream")},
        )
        assert response.status_code == 401 or response.status_code == 403

    async def test_sha256_is_correct(self, test_client_authenticated):
        expected = hashlib.sha256(MINIMAL_PCAP).hexdigest()
        response = await _upload(test_client_authenticated)
        assert response.status_code == 200
        assert response.json()["sha256"] == expected

    async def test_response_has_expected_fields(self, test_client_authenticated):
        response = await _upload(test_client_authenticated)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "filename" in data
        assert "size_bytes" in data
        assert "sha256" in data
        assert "status" in data
        assert "created_at" in data

    async def test_size_bytes_matches_upload(self, test_client_authenticated):
        response = await _upload(test_client_authenticated)
        assert response.status_code == 200
        data = response.json()
        assert data["size_bytes"] == len(MINIMAL_PCAP)


@pytest.mark.integration
class TestListCaptures:
    """Tests for GET /api/captures (list)."""

    async def test_list_returns_200_with_captures_and_total(self, test_client_authenticated):
        response = await test_client_authenticated.get("/api/captures")
        assert response.status_code == 200
        data = response.json()
        assert "captures" in data
        assert "total" in data
        assert isinstance(data["captures"], list)
        assert data["total"] == len(data["captures"])

    async def test_list_includes_uploaded_capture(self, test_client_authenticated):
        upload_resp = await _upload(test_client_authenticated)
        assert upload_resp.status_code == 200
        uploaded_id = upload_resp.json()["id"]

        list_resp = await test_client_authenticated.get("/api/captures")
        assert list_resp.status_code == 200
        ids = [c["id"] for c in list_resp.json()["captures"]]
        assert uploaded_id in ids


@pytest.mark.integration
class TestGetCapture:
    """Tests for GET /api/captures/{id}."""

    async def test_get_valid_capture_returns_200(self, test_client_authenticated):
        upload_resp = await _upload(test_client_authenticated)
        capture_id = upload_resp.json()["id"]

        response = await test_client_authenticated.get(f"/api/captures/{capture_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == capture_id

    async def test_get_nonexistent_capture_returns_404(self, test_client_authenticated):
        fake_id = uuid.uuid4()
        response = await test_client_authenticated.get(f"/api/captures/{fake_id}")
        assert response.status_code == 404

    async def test_get_malformed_id_returns_422(self, test_client_authenticated):
        response = await test_client_authenticated.get("/api/captures/not-a-uuid")
        assert response.status_code == 422


@pytest.mark.integration
class TestDeleteCapture:
    """Tests for DELETE /api/captures/{id}."""

    async def test_delete_successfully_returns_200(self, test_client_authenticated):
        upload_resp = await _upload(test_client_authenticated)
        capture_id = upload_resp.json()["id"]

        response = await test_client_authenticated.delete(f"/api/captures/{capture_id}")
        assert response.status_code == 200
        assert response.json() == {"message": "deleted"}

        get_resp = await test_client_authenticated.get(f"/api/captures/{capture_id}")
        assert get_resp.status_code == 404

    async def test_delete_nonexistent_capture_returns_404(self, test_client_authenticated):
        fake_id = uuid.uuid4()
        response = await test_client_authenticated.delete(f"/api/captures/{fake_id}")
        assert response.status_code == 404
