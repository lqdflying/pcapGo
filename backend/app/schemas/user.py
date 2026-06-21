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
    role: str = "user"
    created_at: datetime

    model_config = {"from_attributes": True}


class AllowedUserCreate(BaseModel):
    github_login: str
    role: str = "user"


class AllowedUserRead(BaseModel):
    id: uuid.UUID
    github_login: str
    role: str
    added_by: str | None = None
    created_at: datetime
    has_logged_in: bool = False

    model_config = {"from_attributes": True}


class AllowedUserList(BaseModel):
    users: list[AllowedUserRead]
    total: int
