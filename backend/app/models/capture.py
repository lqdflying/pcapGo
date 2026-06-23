from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text, func, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

import enum


class CaptureStatus(str, enum.Enum):
    uploaded = "uploaded"
    parsing = "parsing"
    ready = "ready"
    failed = "failed"


class Capture(Base):
    __tablename__ = "captures"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(512))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    linktype: Mapped[int] = mapped_column(Integer, default=1)
    packet_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[CaptureStatus] = mapped_column(
        SAEnum(CaptureStatus, name="capturestatus"), default=CaptureStatus.uploaded
    )
    stored_path: Mapped[str] = mapped_column(String(1024))
    parsed_index_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user = relationship("User", back_populates="captures")
    conversations = relationship(
        "Conversation", back_populates="capture", cascade="all, delete-orphan"
    )
    chat_threads = relationship(
        "ChatThread", back_populates="capture", cascade="all, delete-orphan"
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    capture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("captures.id", ondelete="CASCADE"), index=True
    )
    proto: Mapped[str] = mapped_column(String(8))
    src_ip: Mapped[str] = mapped_column(String(45))
    src_port: Mapped[int] = mapped_column(Integer)
    dst_ip: Mapped[str] = mapped_column(String(45))
    dst_port: Mapped[int] = mapped_column(Integer)
    packet_count: Mapped[int] = mapped_column(Integer, default=0)
    byte_count: Mapped[int] = mapped_column(Integer, default=0)
    # Forward direction (canonical src -> canonical dst). Reverse = total - fwd.
    fwd_packet_count: Mapped[int] = mapped_column(Integer, default=0)
    fwd_byte_count: Mapped[int] = mapped_column(Integer, default=0)
    start_ts: Mapped[float] = mapped_column(default=0.0)
    end_ts: Mapped[float] = mapped_column(default=0.0)
    app_protocol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    flags_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Bounded reservoir sample of structured per-packet evidence (JSON text)
    # collected during parsing, used by the LLM analysis prompt.
    evidence_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    capture = relationship("Capture", back_populates="conversations")
    analyses = relationship(
        "Analysis", back_populates="conversation", cascade="all, delete-orphan"
    )


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        index=True,
    )
    model: Mapped[str] = mapped_column(String(128))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    summary_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    issues_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    conversation = relationship("Conversation", back_populates="analyses")


class ChatThread(Base):
    """A persisted AI chat conversation scoped to a single capture."""

    __tablename__ = "chat_threads"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    capture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("captures.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="New chat")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    capture = relationship("Capture", back_populates="chat_threads")
    user = relationship("User")
    messages = relationship(
        "ChatMessage",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )


class ChatMessage(Base):
    """A single user/assistant turn within a ChatThread."""

    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    thread_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_threads.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    thread = relationship("ChatThread", back_populates="messages")
