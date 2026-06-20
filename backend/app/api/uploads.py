from __future__ import annotations

import hashlib
import logging
import os
import re
import tempfile
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select, func

from app.config import settings
from app.db.session import async_session
from app.models import User, Capture, CaptureStatus
from app.core.security import get_current_user
from app.schemas.capture import CaptureRead, CaptureList
from app.services.pcap_parser import parse_pcap

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/captures", tags=["captures"])


# Recognized pcap magic bytes (first 4 bytes). Covers pcap little/big-endian
# (libpcap) and pcapng little/big-endian. Captures are verified on upload so
# that misnamed arbitrary binaries never reach disk.
_PCAP_MAGIC = {
    b"\xd4\xc3\xb2\xa1",  # pcap little-endian
    b"\xa1\xb2\xc3\xd4",  # pcap big-endian
    b"\x4d\x3c\xb2\xa1",  # pcap nanosecond little-endian
    b"\xa1\xb2\x3c\x4d",  # pcap nanosecond big-endian
    b"\x0a\x0d\x0d\x0a",  # pcapng (any endianness — section header block)
}

_CHUNK = 1024 * 1024  # 1 MB streaming chunks

# Accept .pcap/.pcapng/.cap plus tcpdump rotated suffixes (capture.pcap0,
# dump.pcap-01, x.cap2, y.pcapng1, ...). The extension is only a guardrail —
# the pcap magic-byte check below is the authoritative content validation, so
# any trailing digits/separators a rotation scheme appends are allowed.
_CAPTURE_NAME_RE = re.compile(r"\.(pcapng|pcap|cap)[-_.]?\d*$", re.IGNORECASE)


@router.post("", response_model=CaptureRead)
async def upload_capture(
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    if not file.filename or not _CAPTURE_NAME_RE.search(file.filename):
        raise HTTPException(
            status_code=400,
            detail="Only .pcap, .pcapng, .cap files (including rotated suffixes like .pcap0) accepted",
        )

    user_dir = Path(settings.upload_dir) / str(user.id)
    user_dir.mkdir(parents=True, exist_ok=True)

    capture_id = uuid.uuid4()
    final_path = user_dir / f"{capture_id}.pcap"

    # Stream the upload to a temp file in the destination directory so we can
    # atomically rename on success. Reading the whole file into RAM (the old
    # approach) blocked the event loop and could OOM on large concurrent
    # uploads. Hash is computed incrementally as bytes arrive.
    sha256 = hashlib.sha256()
    total = 0
    magic_seen = False

    tmp_fd, tmp_name = tempfile.mkstemp(prefix=".upload-", suffix=".tmp", dir=str(user_dir))
    os.close(tmp_fd)
    try:
        async with aiofiles.open(tmp_name, "wb") as out:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Max {settings.max_upload_mb}MB",
                    )
                if not magic_seen:
                    # Validate the pcap magic bytes on the first chunk.
                    if len(chunk) >= 4:
                        if chunk[:4] not in _PCAP_MAGIC:
                            raise HTTPException(
                                status_code=400,
                                detail="File does not have a valid pcap/pcapng magic header",
                            )
                        magic_seen = True
                sha256.update(chunk)
                await out.write(chunk)

        if total < 24:
            raise HTTPException(status_code=400, detail="File too small to be a valid pcap")
        if not magic_seen:
            raise HTTPException(
                status_code=400,
                detail="File does not have a valid pcap/pcapng magic header",
            )

        os.replace(tmp_name, final_path)
    except HTTPException:
        # Clean up the temp file on validation errors.
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        logger.exception("upload_capture failed")
        raise

    async with async_session() as session:
        capture = Capture(
            id=capture_id,
            user_id=user.id,
            filename=file.filename or "unnamed.pcap",
            size_bytes=total,
            sha256=sha256.hexdigest(),
            stored_path=str(final_path),
            status=CaptureStatus.uploaded,
        )
        session.add(capture)
        await session.commit()
        await session.refresh(capture)

    bg.add_task(parse_pcap, str(capture_id))

    return capture


@router.get("", response_model=CaptureList)
async def list_captures(
    offset: int = 0,
    limit: int = 100,
    user: User = Depends(get_current_user),
):
    """List the caller's captures, newest first (server-side paginated)."""
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    async with async_session() as session:
        total_q = await session.execute(
            select(func.count()).select_from(Capture).where(Capture.user_id == user.id)
        )
        total = int(total_q.scalar_one())
        result = await session.execute(
            select(Capture)
            .where(Capture.user_id == user.id)
            .order_by(Capture.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        captures = result.scalars().all()
    return CaptureList(captures=list(captures), total=total)


@router.get("/{capture_id}", response_model=CaptureRead)
async def get_capture(
    capture_id: uuid.UUID, user: User = Depends(get_current_user)
):
    async with async_session() as session:
        result = await session.execute(
            select(Capture).where(Capture.id == capture_id, Capture.user_id == user.id)
        )
        capture = result.scalar_one_or_none()
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")
    return capture


@router.delete("/{capture_id}")
async def delete_capture(
    capture_id: uuid.UUID, user: User = Depends(get_current_user)
):
    async with async_session() as session:
        result = await session.execute(
            select(Capture).where(Capture.id == capture_id, Capture.user_id == user.id)
        )
        capture = result.scalar_one_or_none()
        if not capture:
            raise HTTPException(status_code=404, detail="Capture not found")

        await session.delete(capture)
        await session.commit()

    # Best-effort filesystem cleanup after the DB transaction commits. Derive
    # all sidecar paths from stored_path / capture_id so we never leak orphan
    # .jsonl files even if parsing crashed before the index was written.
    stored = Path(capture.stored_path)
    if stored.exists():
        try:
            stored.unlink()
        except OSError:
            logger.warning("could not remove %s", stored)

    sidecar_dir = stored.parent
    for suffix in (".index.json", ".jsonl", ".summary.jsonl", ".offsets.bin"):
        sidecar = sidecar_dir / f"{capture.id}{suffix}"
        if sidecar.exists():
            try:
                sidecar.unlink()
            except OSError:
                logger.warning("could not remove %s", sidecar)

    # Drop any in-memory cached index for this capture so a future re-upload
    # (which may reuse the same path) never reads a stale parse.
    if capture.parsed_index_path:
        from app.api.packets import _evict_index

        _evict_index(capture.parsed_index_path)

    return {"message": "deleted"}
