"""Tests for models: User, Capture, Conversation, Analysis."""

import uuid

import pytest
from sqlalchemy import select

from app.models import User, Capture, CaptureStatus, Conversation, Analysis


@pytest.mark.asyncio
class TestUserModel:
    async def test_create_user(self, db_session):
        user = User(
            github_id=123456,
            login="testuser",
            email="test@example.com",
            name="Test User",
            avatar_url="https://avatar.example.com/test.png",
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        assert user.id is not None
        assert isinstance(user.id, uuid.UUID)
        assert user.github_id == 123456
        assert user.login == "testuser"
        assert user.created_at is not None

    async def test_github_id_uniqueness(self, db_session):
        user1 = User(github_id=99999, login="user1")
        db_session.add(user1)
        await db_session.commit()

        user2 = User(github_id=99999, login="user2")
        db_session.add(user2)
        with pytest.raises(Exception):
            await db_session.commit()
        await db_session.rollback()

    async def test_user_find_by_id(self, db_session):
        user = User(github_id=11111, login="findme")
        db_session.add(user)
        await db_session.commit()

        result = await db_session.execute(select(User).where(User.id == user.id))
        found = result.scalar_one()
        assert found.login == "findme"

    async def test_cascade_delete_captures(self, db_session):
        user = User(github_id=22222, login="cascade_test")
        db_session.add(user)
        await db_session.commit()

        capture = Capture(
            user_id=user.id,
            filename="test.pcap",
            size_bytes=100,
            sha256="a" * 64,
            stored_path="/tmp/test.pcap",
        )
        db_session.add(capture)
        await db_session.commit()

        # Delete user should cascade to capture
        await db_session.delete(user)
        await db_session.commit()

        result = await db_session.execute(select(Capture).where(Capture.id == capture.id))
        assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
class TestCaptureModel:
    async def test_create_capture(self, db_session):
        user = User(github_id=33333, login="cap_user")
        db_session.add(user)
        await db_session.commit()

        capture = Capture(
            user_id=user.id,
            filename="test.pcap",
            size_bytes=1024,
            sha256="b" * 64,
            stored_path="/tmp/test.pcap",
        )
        db_session.add(capture)
        await db_session.commit()

        assert capture.id is not None
        assert capture.status == CaptureStatus.uploaded
        assert capture.packet_count == 0
        assert capture.linktype == 1

    async def test_capture_status_enum(self, db_session):
        user = User(github_id=44444, login="enum_user")
        db_session.add(user)
        await db_session.commit()

        capture = Capture(
            user_id=user.id,
            filename="test.pcap",
            size_bytes=100,
            sha256="c" * 64,
            stored_path="/tmp/test.pcap",
            status=CaptureStatus.ready,
        )
        db_session.add(capture)
        await db_session.commit()

        assert capture.status == CaptureStatus.ready
        assert capture.status.value == "ready"

    async def test_cascade_delete_conversations(self, db_session):
        user = User(github_id=55555, login="cascade_cap")
        db_session.add(user)
        await db_session.commit()

        capture = Capture(
            user_id=user.id,
            filename="test.pcap",
            size_bytes=100,
            sha256="d" * 64,
            stored_path="/tmp/test.pcap",
        )
        db_session.add(capture)
        await db_session.commit()

        conv = Conversation(
            capture_id=capture.id,
            proto="tcp",
            src_ip="10.0.0.1",
            src_port=443,
            dst_ip="10.0.0.2",
            dst_port=54321,
            packet_count=5,
            byte_count=500,
            start_ts=0.0,
            end_ts=1.0,
        )
        db_session.add(conv)
        await db_session.commit()

        conv_id = conv.id
        await db_session.delete(capture)
        await db_session.commit()

        result = await db_session.execute(select(Conversation).where(Conversation.id == conv_id))
        assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
class TestConversationModel:
    async def test_create_conversation(self, db_session, test_capture):
        conv = Conversation(
            capture_id=test_capture.id,
            proto="tcp",
            src_ip="10.0.0.1",
            src_port=443,
            dst_ip="10.0.0.2",
            dst_port=54321,
            packet_count=10,
            byte_count=1000,
            start_ts=0.0,
            end_ts=1.5,
            app_protocol="TLS",
            flags_summary="SYN,ACK",
        )
        db_session.add(conv)
        await db_session.commit()

        assert conv.id is not None
        assert conv.proto == "tcp"
        assert conv.app_protocol == "TLS"
        assert conv.flags_summary == "SYN,ACK"

    async def test_conversation_optional_fields(self, db_session, test_capture):
        conv = Conversation(
            capture_id=test_capture.id,
            proto="udp",
            src_ip="10.0.0.1",
            src_port=53,
            dst_ip="10.0.0.2",
            dst_port=12345,
        )
        db_session.add(conv)
        await db_session.commit()

        assert conv.app_protocol is None
        assert conv.flags_summary is None

    async def test_fwd_and_evidence_columns(self, db_session, test_capture):
        """Verify the new fwd_packet_count, fwd_byte_count, evidence_json columns."""
        conv = Conversation(
            capture_id=test_capture.id,
            proto="tcp",
            src_ip="10.0.0.1",
            src_port=443,
            dst_ip="10.0.0.2",
            dst_port=54321,
            packet_count=10,
            byte_count=1000,
            fwd_packet_count=6,
            fwd_byte_count=600,
            start_ts=0.0,
            end_ts=1.5,
            evidence_json='[{"ts":0.1}]',
        )
        db_session.add(conv)
        await db_session.commit()
        await db_session.refresh(conv)

        assert conv.fwd_packet_count == 6
        assert conv.fwd_byte_count == 600
        assert conv.evidence_json == '[{"ts":0.1}]'


@pytest.mark.asyncio
class TestAnalysisModel:
    async def test_create_analysis(self, db_session, test_conversation):
        analysis = Analysis(
            conversation_id=test_conversation.id,
            model="gpt-4o-mini",
            prompt_tokens=100,
            completion_tokens=200,
            summary_markdown="TLS handshake completed.",
            issues_json='[{"type":"high_latency","severity":"medium","explanation":"RTT is 500ms."}]',
        )
        db_session.add(analysis)
        await db_session.commit()

        assert analysis.id is not None
        assert analysis.model == "gpt-4o-mini"
        assert analysis.prompt_tokens == 100
        assert analysis.completion_tokens == 200
