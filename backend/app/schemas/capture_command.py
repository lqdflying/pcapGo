from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel


class CaptureCommandGenerateRequest(BaseModel):
    prompt: str
    platform: Literal["tcpdump", "pktmon"] = "tcpdump"
    capture_id: uuid.UUID | None = None
