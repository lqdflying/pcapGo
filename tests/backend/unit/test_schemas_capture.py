"""Tests for Pydantic schemas."""

import uuid
from datetime import datetime

import pytest
from pydantic import ValidationError

from app.schemas.user import UserRead


class TestUserReadSchema:
    """Test UserRead schema."""

    def test_valid_user(self):
        u = UserRead(
            id=uuid.uuid4(),
            login="testuser",
            email="test@example.com",
            name="Test User",
            avatar_url="https://avatar.example.com/test.png",
            created_at=datetime.now(),
        )
        assert u.login == "testuser"
        assert u.email == "test@example.com"

    def test_optional_fields_none(self):
        u = UserRead(
            id=uuid.uuid4(),
            login="testuser",
            created_at=datetime.now(),
        )
        assert u.email is None
        assert u.name is None
        assert u.avatar_url is None

    def test_missing_required_field(self):
        with pytest.raises(ValidationError):
            UserRead(login="testuser", created_at=datetime.now())

        with pytest.raises(ValidationError):
            UserRead(id=uuid.uuid4(), created_at=datetime.now())

        with pytest.raises(ValidationError):
            UserRead(id=uuid.uuid4(), login="testuser")

    def test_from_attributes(self):
        assert UserRead.model_config.get("from_attributes") is True


from app.schemas.capture import (
    CaptureRead,
    CaptureList,
    LayerNode,
    PacketSummary,
    PacketDetail,
    ConversationStats,
    EndpointStats,
    ProtocolHierarchy,
    IOBucket,
    StatisticsResponse,
)


class TestCaptureReadSchema:
    def test_valid_capture(self):
        c = CaptureRead(
            id=uuid.uuid4(),
            filename="test.pcap",
            size_bytes=1024,
            sha256="a" * 64,
            linktype=1,
            packet_count=10,
            status="ready",
            created_at=datetime.now(),
        )
        assert c.filename == "test.pcap"
        assert c.packet_count == 10
        assert c.status == "ready"

    def test_capture_list(self):
        captures = [
            CaptureRead(
                id=uuid.uuid4(),
                filename=f"test_{i}.pcap",
                size_bytes=1024,
                sha256="a" * 64,
                linktype=1,
                packet_count=i,
                status="ready",
                created_at=datetime.now(),
            )
            for i in range(3)
        ]
        cl = CaptureList(captures=captures, total=3)
        assert cl.total == 3
        assert len(cl.captures) == 3
        assert cl.captures[0].filename == "test_0.pcap"


class TestLayerNodeSchema:
    def test_valid_layer(self):
        ln = LayerNode(name="Ethernet", summary="Ethernet II", offset=0, length=14)
        assert ln.name == "Ethernet"
        assert ln.children == []

    def test_nested_children(self):
        child = LayerNode(name="IP", summary="IP", offset=14, length=20)
        parent = LayerNode(
            name="Ethernet",
            summary="Ethernet II",
            offset=0,
            length=14,
            children=[child],
        )
        assert len(parent.children) == 1
        assert parent.children[0].name == "IP"

    def test_large_offset(self):
        ln = LayerNode(name="Big", summary="Big", offset=999999, length=10)
        assert ln.offset == 999999


class TestPacketSummarySchema:
    def test_valid_summary(self):
        ps = PacketSummary(
            idx=0, ts=1.0, src="10.0.0.1", dst="10.0.0.2",
            proto="TCP", length=100, info="SYN",
        )
        assert ps.idx == 0
        assert ps.proto == "TCP"

    def test_idx_boundary(self):
        ps = PacketSummary(
            idx=999999, ts=0, src="a", dst="b", proto="TCP", length=0, info="",
        )
        assert ps.idx == 999999


class TestPacketDetailSchema:
    def test_valid_detail(self):
        layer = LayerNode(name="Ethernet", summary="", offset=0, length=14)
        pd = PacketDetail(
            idx=0, ts=1.0, src="10.0.0.1", dst="10.0.0.2",
            proto="TCP", length=100, info="SYN",
            layers=[layer], raw_hex="00 01", raw_offset=0,
        )
        assert len(pd.layers) == 1
        assert pd.raw_hex == "00 01"


class TestConversationStatsSchema:
    def test_valid_with_optional_none(self):
        cs = ConversationStats(
            id=uuid.uuid4(),
            proto="tcp",
            src_ip="10.0.0.1", src_port=443,
            dst_ip="10.0.0.2", dst_port=54321,
            packet_count=10, byte_count=1000,
            start_ts=0.0, end_ts=1.0,
            app_protocol=None, flags_summary=None,
        )
        assert cs.app_protocol is None
        assert cs.flags_summary is None


class TestEndpointStatsSchema:
    def test_valid_endpoint(self):
        es = EndpointStats(address="10.0.0.1", packet_count=5, byte_count=500)
        assert es.address == "10.0.0.1"


class TestProtocolHierarchySchema:
    def test_nested_children(self):
        child = ProtocolHierarchy(name="HTTP", packet_count=3, byte_count=300)
        parent = ProtocolHierarchy(
            name="TCP", packet_count=10, byte_count=1000, children=[child],
        )
        assert len(parent.children) == 1
        assert parent.children[0].name == "HTTP"
        assert parent.packet_count == 10


class TestIOBucketSchema:
    def test_valid_bucket(self):
        b = IOBucket(ts_start=0.0, packet_count=5, byte_count=100)
        assert b.ts_start == 0.0


class TestStatisticsResponseSchema:
    def test_valid_empty(self):
        sr = StatisticsResponse(
            capture_id=uuid.uuid4(),
            packet_count=0,
            duration=0.0,
            protocols=[],
            endpoints=[],
            conversations=[],
            io_buckets=[],
        )
        assert sr.packet_count == 0
        assert len(sr.protocols) == 0

    def test_valid_populated(self):
        sr = StatisticsResponse(
            capture_id=uuid.uuid4(),
            packet_count=10,
            duration=2.5,
            protocols=[
                ProtocolHierarchy(name="TCP", packet_count=10, byte_count=1000),
            ],
            endpoints=[
                EndpointStats(address="10.0.0.1", packet_count=10, byte_count=1000),
            ],
            conversations=[
                ConversationStats(
                    id=uuid.uuid4(),
                    proto="tcp",
                    src_ip="10.0.0.1", src_port=443,
                    dst_ip="10.0.0.2", dst_port=54321,
                    packet_count=10, byte_count=1000,
                    start_ts=0.0, end_ts=2.5,
                    app_protocol="TLS",
                    flags_summary="SYN,ACK",
                ),
            ],
            io_buckets=[
                IOBucket(ts_start=0.0, packet_count=1, byte_count=100),
            ],
        )
        assert sr.duration == 2.5
        assert sr.conversations[0].app_protocol == "TLS"
