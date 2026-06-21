from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.config import settings
from app.core.security import get_current_user
from app.db.session import async_session
from app.models import User, CaptureStatus
from app.schemas.capture_command import CaptureCommandGenerateRequest
from app.services.llm import capture_command_generate_stream
from app.api.chat import _get_owned_capture, _build_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/capture-command", tags=["capture-command"])


@router.post("/generate")
async def generate_capture_command(
    body: CaptureCommandGenerateRequest,
    request: Request,
    user: User = Depends(get_current_user),
):
    """Generate a tcpdump or pktmon command from a natural language prompt, streamed via SSE."""
    if not settings.llm_api_key:
        raise HTTPException(status_code=400, detail="LLM is not configured on this server")

    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="Prompt must not be empty")

    capture_context: str | None = None
    if body.capture_id:
        async with async_session() as session:
            capture = await _get_owned_capture(session, body.capture_id, user)
            if capture.status != CaptureStatus.ready:
                raise HTTPException(status_code=400, detail="Capture not yet parsed")
            capture_context = await _build_context(session, capture)

    async def event_stream():
        try:
            async for delta in capture_command_generate_stream(
                prompt, body.platform, capture_context
            ):
                if await request.is_disconnected():
                    break
                yield f"data: {json.dumps({'delta': delta})}\n\n"
                await asyncio.sleep(0)
        except Exception:
            logger.exception("capture_command_generate_stream failed")
            yield f"data: {json.dumps({'error': 'Generation failed; see server logs.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
