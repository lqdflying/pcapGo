from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.config import settings
from app.db.session import async_session
from app.models import User, Capture, CaptureStatus, Conversation, Analysis
from app.core.security import get_current_user, get_capture_for_user
from app.schemas.analysis import AnalysisEvent, AnalysisIssue
from app.services.llm import analyze_conversation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/captures", tags=["analysis"])


@router.get("/{capture_id}/ai")
async def analyze_capture(
    capture_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
):
    if not settings.llm_api_key:
        raise HTTPException(status_code=400, detail="LLM is not configured on this server")

    async with async_session() as session:
        capture = await get_capture_for_user(session, capture_id, user)
        if capture.status != CaptureStatus.ready:
            raise HTTPException(status_code=400, detail="Capture not yet parsed")

        conv_result = await session.execute(
            select(Conversation).where(Conversation.capture_id == capture_id)
        )
        conversations = conv_result.scalars().all()

    async def event_stream():
        for conv in conversations:
            # If the client closed the tab, stop calling the LLM (saves
            # cost + DB writes for nobody).
            if await request.is_disconnected():
                logger.info(
                    "analysis stream: client disconnected, aborting "
                    "after %d/%d conversations",
                    conv.id,
                    len(conversations),
                )
                break

            # The LLM call happens OUTSIDE any DB session so we never hold a
            # transaction or connection during a remote network call.
            try:
                summary_md, issues, prompt_tokens, completion_tokens = (
                    await analyze_conversation(capture, conv)
                )
                failed = False
            except Exception:
                logger.exception(
                    "analyze_conversation failed for conversation %s", conv.id
                )
                summary_md = "Analysis failed; see server logs."
                issues = []
                prompt_tokens = 0
                completion_tokens = 0
                failed = True

            event = AnalysisEvent(
                conversation_id=str(conv.id),
                proto=conv.proto,
                src=f"{conv.src_ip}:{conv.src_port}",
                dst=f"{conv.dst_ip}:{conv.dst_port}",
                summary_markdown=summary_md,
                issues=[
                    AnalysisIssue(
                        type=i.get("type", "unknown"),
                        severity=i.get("severity", "low"),
                        explanation=i.get("explanation", ""),
                    )
                    for i in issues
                ],
            )

            # Persist successful analyses in a SHORT session so one DB
            # failure doesn't terminate the whole SSE stream. The AnalysisEvent
            # is already constructed and will be yielded regardless.
            if not failed:
                persist_error = False
                try:
                    async with async_session() as session:
                        analysis = Analysis(
                            conversation_id=conv.id,
                            model=settings.llm_model,
                            summary_markdown=summary_md,
                            issues_json=json.dumps(issues),
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                        )
                        session.add(analysis)
                        await session.commit()
                except Exception:
                    logger.exception(
                        "failed to persist analysis for conversation %s", conv.id
                    )
                    persist_error = True

                if persist_error:
                    event.summary_markdown = (
                        (summary_md + "\n\n_(Warning: could not persist this analysis.)_")
                        if summary_md else "Could not persist this analysis."
                    )

            yield f"data: {event.model_dump_json()}\n\n"
            # Yield control so the SSE bytes flush promptly through nginx.
            await asyncio.sleep(0)

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
