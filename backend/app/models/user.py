from __future__ import annotations

import enum
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    user = "user"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    github_id: Mapped[int] = mapped_column(unique=True, index=True)
    login: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    role: Mapped[str] = mapped_column(String(32), default=UserRole.user, server_default="user")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    captures = relationship("Capture", back_populates="user", cascade="all, delete-orphan")
