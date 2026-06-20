from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel


class UserRead(BaseModel):
    id: uuid.UUID
    login: str
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
