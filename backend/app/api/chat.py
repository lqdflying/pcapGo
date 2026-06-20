from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func

from app.config import settings
from app.db.session import async_session
from app.models import User, Capture, CaptureStatus, Conversation, ChatThread, ChatMessage
from app.core.security import get_current_user
from app.schemas.chat import (
    ChatThreadCreate,
    ChatThreadRead,
    ChatThreadDetail,
    ChatMessageCreate,
    ChatMessageRead,
)
from app.services.llm import chat_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/captures", tags=["chat"])

# How many conversations to include in the LLM context (largest by packets).
_CONTEXT_CONV_LIMIT = 40


async def _get_owned_capture(session, capture_id: uuid.UUID, user: User) -> Capture:
    result = await session.execute(
        select(Capture).where(Capture.id == capture_id, Capture.user_id == user.id)
    )
    capture = result.scalar_one_or_none()
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")
    return capture


async def _get_owned_thread(
    session, capture_id: uuid.UUID, thread_id: uuid.UUID, user: User
) -> ChatThread:
    await _get_owned_capture(session, capture_id, user)
    result = await session.execute(
        select(ChatThread).where(
            ChatThread.id == thread_id, ChatThread.capture_id == capture_id
        )
    )
    thread = result.scalar_one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


async def _build_context(session, capture: Capture) -> str:
    """Build a compact text summary of the capture for the LLM system prompt."""
    result = await session.execute(
        select(Conversation)
        .where(Conversation.capture_id == capture.id)
        .order_by(Conversation.packet_count.desc())
        .limit(_CONTEXT_CONV_LIMIT)
    )
    conversations = result.scalars().all()

    total_q = await session.execute(
        select(func.count()).select_from(Conversation).where(
            Conversation.capture_id == capture.id
        )
    )
    total_convs = int(total_q.scalar_one())

    lines = [
        f"File: {capture.filename}",
        f"Total packets: {capture.packet_count}",
        f"Conversations: {total_convs} (showing top {len(conversations)} by packets)",
        "",
        "Top conversations (proto src->dst | app | pkts | bytes | flags):",
    ]
    for c in conversations:
        app = c.app_protocol or "-"
        flags = c.flags_summary or "-"
        lines.append(
            f"- {c.proto} {c.src_ip}:{c.src_port}->{c.dst_ip}:{c.dst_port} "
            f"| {app} | {c.packet_count} pkts | {c.byte_count} B | {flags}"
        )
    return "\n".join(lines)


@router.get("/{capture_id}/threads", response_model=list[ChatThreadRead])
async def list_threads(
    capture_id: uuid.UUID, user: User = Depends(get_current_user)
):
    async with async_session() as session:
        await _get_owned_capture(session, capture_id, user)
        result = await session.execute(
            select(
                ChatThread,
                func.count(ChatMessage.id),
            )
            .outerjoin(ChatMessage, ChatMessage.thread_id == ChatThread.id)
            .where(ChatThread.capture_id == capture_id)
            .group_by(ChatThread.id)
            .order_by(ChatThread.created_at.desc())
        )
        rows = result.all()
    return [
        ChatThreadRead(
            id=t.id, title=t.title, created_at=t.created_at, message_count=count
        )
        for t, count in rows
    ]


@router.post("/{capture_id}/threads", response_model=ChatThreadRead)
async def create_thread(
    capture_id: uuid.UUID,
    body: ChatThreadCreate,
    user: User = Depends(get_current_user),
):
    async with async_session() as session:
        await _get_owned_capture(session, capture_id, user)
        thread = ChatThread(
            capture_id=capture_id,
            title=(body.title or "New chat").strip()[:255] or "New chat",
        )
        session.add(thread)
        await session.commit()
        await session.refresh(thread)
    return ChatThreadRead(
        id=thread.id, title=thread.title, created_at=thread.created_at, message_count=0
    )


@router.get("/{capture_id}/threads/{thread_id}", response_model=ChatThreadDetail)
async def get_thread(
    capture_id: uuid.UUID,
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
):
    async with async_session() as session:
        thread = await _get_owned_thread(session, capture_id, thread_id, user)
        result = await session.execute(
            select(ChatMessage)
            .where(ChatMessage.thread_id == thread_id)
            .order_by(ChatMessage.created_at)
        )
        messages = result.scalars().all()
    return ChatThreadDetail(
        id=thread.id,
        title=thread.title,
        created_at=thread.created_at,
        messages=[ChatMessageRead.model_validate(m) for m in messages],
    )


@router.delete("/{capture_id}/threads/{thread_id}")
async def delete_thread(
    capture_id: uuid.UUID,
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
):
    async with async_session() as session:
        thread = await _get_owned_thread(session, capture_id, thread_id, user)
        await session.delete(thread)
        await session.commit()
    return {"message": "deleted"}


@router.post("/{capture_id}/threads/{thread_id}/messages")
async def post_message(
    capture_id: uuid.UUID,
    thread_id: uuid.UUID,
    body: ChatMessageCreate,
    request: Request,
    user: User = Depends(get_current_user),
):
    """Persist the user's question, then stream the assistant reply via SSE.

    The client can stop generation by aborting the request; we detect the
    disconnect, stop calling the LLM, and persist whatever partial answer was
    produced so the thread history stays consistent.
    """
    if not settings.llm_api_key:
        raise HTTPException(status_code=400, detail="LLM is not configured on this server")

    question = (body.content or "").strip()
    if not question:
        raise HTTPException(status_code=422, detail="Message content is required")

    # Phase 1: validate, persist the user turn, snapshot history + context.
    async with async_session() as session:
        capture = await _get_owned_capture(session, capture_id, user)
        if capture.status != CaptureStatus.ready:
            raise HTTPException(status_code=400, detail="Capture not yet parsed")
        thread = await _get_owned_thread(session, capture_id, thread_id, user)

        hist_result = await session.execute(
            select(ChatMessage)
            .where(ChatMessage.thread_id == thread_id)
            .order_by(ChatMessage.created_at)
        )
        history = [
            {"role": m.role, "content": m.content}
            for m in hist_result.scalars().all()
        ]

        # Name the thread after the first question.
        if thread.title in ("New chat", "") and not history:
            thread.title = question[:60]

        session.add(ChatMessage(thread_id=thread_id, role="user", content=question))
        await session.commit()

        context = await _build_context(session, capture)

    async def event_stream():
        parts: list[str] = []
        try:
            async for delta in chat_stream(context, history, question):
                if await request.is_disconnected():
                    logger.info("chat stream: client disconnected, stopping")
                    break
                parts.append(delta)
                yield f"data: {json.dumps({'delta': delta})}\n\n"
                await asyncio.sleep(0)
        except Exception:
            logger.exception("chat_stream failed for thread %s", thread_id)
            yield f"data: {json.dumps({'error': 'Analysis failed; see server logs.'})}\n\n"
        finally:
            # Persist whatever was produced (even a partial/empty answer) so the
            # history is consistent on reload.
            answer = "".join(parts)
            try:
                async with async_session() as session:
                    session.add(
                        ChatMessage(
                            thread_id=thread_id, role="assistant", content=answer
                        )
                    )
                    await session.commit()
            except Exception:
                logger.exception(
                    "failed to persist assistant message for thread %s", thread_id
                )
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
