from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatThreadCreate(BaseModel):
    title: str | None = None


class ChatMessageCreate(BaseModel):
    content: str


class ChatMessageRead(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatThreadRead(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ChatThreadDetail(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    messages: list[ChatMessageRead] = []

    model_config = {"from_attributes": True}
