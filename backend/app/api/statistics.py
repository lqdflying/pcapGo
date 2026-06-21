from __future__ import annotations

import logging
import math
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from app.db.session import async_session
from app.models import User, Capture, CaptureStatus, Conversation
from app.core.security import get_current_user, get_capture_for_user
from app.schemas.capture import (
    StatisticsResponse,
    ConversationStats,
    EndpointStats,
    ProtocolHierarchy,
    IOBucket,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/captures", tags=["statistics"])

# Bucket sizes the client is allowed to request (seconds). Mirrors the
# 1s / 10s / 30s / 1min options documented in wiki/Statistics-and-Viewing.md.
_ALLOWED_BUCKET_SECONDS = {1.0, 10.0, 30.0, 60.0}

# Maximum number of IO graph buckets. The effective bucket size is increased
# so the entire capture fits within this cap — no traffic is discarded.
_MAX_BUCKETS = 2000


@router.get("/{capture_id}/statistics", response_model=StatisticsResponse)
async def get_statistics(
    capture_id: uuid.UUID,
    bucket_seconds: float = Query(1.0, description="IO graph bucket size in seconds"),
    metric: str = Query("packets", description="IO graph metric: 'packets' or 'bytes'"),
    user: User = Depends(get_current_user),
):
    async with async_session() as session:
        capture = await get_capture_for_user(session, capture_id, user)
        if capture.status != CaptureStatus.ready:
            raise HTTPException(status_code=400, detail="Capture not yet parsed")

        conv_result = await session.execute(
            select(Conversation)
            .where(Conversation.capture_id == capture_id)
            .order_by(Conversation.packet_count.desc())
        )
        conversations = conv_result.scalars().all()

    # Validate IO graph params (be lenient: round/snap to a supported bucket).
    if bucket_seconds not in _ALLOWED_BUCKET_SECONDS:
        bucket_seconds = min(_ALLOWED_BUCKET_SECONDS, key=lambda b: abs(b - bucket_seconds))
    metric_norm = "bytes" if metric.lower() == "bytes" else "packets"

    # ── Protocol hierarchy ─────────────────────────────────────────────
    proto_map: dict[str, ProtocolHierarchy] = {}
    for c in conversations:
        node = proto_map.setdefault(
            c.proto, ProtocolHierarchy(name=c.proto, packet_count=0, byte_count=0)
        )
        node.packet_count += c.packet_count
        node.byte_count += c.byte_count
        if c.app_protocol:
            child = next(
                (ch for ch in node.children if ch.name == c.app_protocol),
                None,
            )
            if not child:
                child = ProtocolHierarchy(name=c.app_protocol, packet_count=0, byte_count=0)
                node.children.append(child)
            child.packet_count += c.packet_count
            child.byte_count += c.byte_count

    # ── Endpoints with directional Tx/Rx ───────────────────────────────
    # Forward traffic (canonical src -> dst) is attributed as src.tx and
    # dst.rx. Reverse traffic (dst -> src) is attributed as src.rx and
    # dst.tx. fwd_* counts are tracked per conversation during parsing;
    # reverse = total - forward.
    ep_map: dict[str, EndpointStats] = {}
    for c in conversations:
        fwd_pkts = c.fwd_packet_count
        rev_pkts = c.packet_count - fwd_pkts
        fwd_bytes = c.fwd_byte_count
        rev_bytes = c.byte_count - fwd_bytes

        src = ep_map.setdefault(
            c.src_ip,
            EndpointStats(address=c.src_ip, packet_count=0, byte_count=0),
        )
        src.tx_packets += fwd_pkts
        src.rx_packets += rev_pkts
        src.tx_bytes += fwd_bytes
        src.rx_bytes += rev_bytes

        dst = ep_map.setdefault(
            c.dst_ip,
            EndpointStats(address=c.dst_ip, packet_count=0, byte_count=0),
        )
        dst.tx_packets += rev_pkts
        dst.rx_packets += fwd_pkts
        dst.tx_bytes += rev_bytes
        dst.rx_bytes += fwd_bytes

    for ep in ep_map.values():
        ep.packet_count = ep.tx_packets + ep.rx_packets
        ep.byte_count = ep.tx_bytes + ep.rx_bytes

    # ── IO buckets ─────────────────────────────────────────────────────
    # Distribute each conversation's packets/bytes across the buckets it
    # overlaps proportional to the time overlap. The bucket size is scaled
    # up so the entire capture fits within _MAX_BUCKETS (no discarding).
    duration = 0.0
    io_buckets: list[IOBucket] = []
    if conversations:
        tmin = min(c.start_ts for c in conversations)
        tmax = max(c.end_ts for c in conversations)
        duration = max(0.0, tmax - tmin)

        # Adaptive bucket size: grow if needed so the whole span fits.
        effective_bucket = bucket_seconds
        if duration > 0:
            min_bucket_for_fit = math.ceil(duration / _MAX_BUCKETS)
            effective_bucket = max(bucket_seconds, float(min_bucket_for_fit))
        if effective_bucket <= 0:
            effective_bucket = 1.0
        bucket_count = max(1, min(_MAX_BUCKETS, int(duration / effective_bucket) + 1))

        bucket_packets = [0] * bucket_count
        bucket_bytes = [0] * bucket_count

        for c in conversations:
            # Instantaneous conversations (single packet or zero-duration
            # flow) get the full count in their containing bucket.
            if c.end_ts <= c.start_ts:
                mid_b = max(0, min(bucket_count - 1, int((c.start_ts - tmin) / effective_bucket)))
                bucket_packets[mid_b] += c.packet_count
                bucket_bytes[mid_b] += c.byte_count
                continue

            span = c.end_ts - c.start_ts
            start_b = max(0, min(bucket_count - 1, int((c.start_ts - tmin) / effective_bucket)))
            end_b = max(0, min(bucket_count - 1, int((c.end_ts - tmin) / effective_bucket)))
            # Distribute packets and bytes across buckets using a running
            # remainder so rounding never drops traffic (100 pkts over 1667
            # buckets must still sum to 100, not 0).
            pkt_accum = 0.0
            byte_accum = 0.0
            for b in range(start_b, end_b + 1):
                bs = tmin + b * effective_bucket
                be = bs + effective_bucket
                overlap = max(0.0, min(be, c.end_ts) - max(bs, c.start_ts))
                weight = overlap / span
                pkt_accum += c.packet_count * weight
                byte_accum += c.byte_count * weight
                # Flush the integer part into the bucket, keep the remainder.
                pkt_int = int(pkt_accum)
                byte_int = int(byte_accum)
                if pkt_int:
                    bucket_packets[b] += pkt_int
                    pkt_accum -= pkt_int
                if byte_int:
                    bucket_bytes[b] += byte_int
                    byte_accum -= byte_int
            # Any leftover (from rounding) goes to the last bucket.
            last = min(bucket_count - 1, end_b)
            if pkt_accum >= 0.5:
                bucket_packets[last] += int(round(pkt_accum))
            if byte_accum >= 0.5:
                bucket_bytes[last] += int(round(byte_accum))

        for b in range(bucket_count):
            bs = tmin + b * effective_bucket
            if metric_norm == "bytes":
                pkt, byt = 0, bucket_bytes[b]
            else:
                pkt, byt = bucket_packets[b], 0
            io_buckets.append(
                IOBucket(ts_start=bs, packet_count=pkt, byte_count=byt)
            )

    conv_stats = [
        ConversationStats(
            id=c.id,
            proto=c.proto,
            src_ip=c.src_ip,
            src_port=c.src_port,
            dst_ip=c.dst_ip,
            dst_port=c.dst_port,
            packet_count=c.packet_count,
            byte_count=c.byte_count,
            start_ts=c.start_ts,
            end_ts=c.end_ts,
            app_protocol=c.app_protocol,
            flags_summary=c.flags_summary,
        )
        for c in conversations
    ]

    return StatisticsResponse(
        capture_id=capture_id,
        packet_count=capture.packet_count,
        duration=duration,
        protocols=list(proto_map.values()),
        endpoints=sorted(ep_map.values(), key=lambda e: e.packet_count, reverse=True),
        conversations=conv_stats,
        io_buckets=io_buckets,
        bucket_seconds=effective_bucket if conversations else bucket_seconds,
        metric=metric_norm,
    )
