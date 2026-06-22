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
    IPStatsEntry,
    ProtoStatsEntry,
    CountryStatsEntry,
)
from app.services.geoip import lookup_country

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

    # ── IP stats ───────────────────────────────────────────────────
    ip_agg: dict[str, dict] = {}
    for c in conversations:
        fwd_pkts = c.fwd_packet_count
        rev_pkts = c.packet_count - fwd_pkts
        fwd_bytes = c.fwd_byte_count
        rev_bytes = c.byte_count - fwd_bytes
        proto_label = c.app_protocol or c.proto

        for ip, is_src in [(c.src_ip, True), (c.dst_ip, False)]:
            if ip not in ip_agg:
                geo = lookup_country(ip)
                ip_agg[ip] = {
                    "ip": ip,
                    "country": geo[1] if geo else None,
                    "country_code": geo[0] if geo else None,
                    "earliest_time": c.start_ts,
                    "latest_time": c.end_ts,
                    "ports": set(),
                    "protocols": set(),
                    "sent_pkts": 0, "recv_pkts": 0,
                    "sent_bytes": 0, "recv_bytes": 0,
                    "tcp": 0, "udp": 0,
                }
            a = ip_agg[ip]
            a["earliest_time"] = min(a["earliest_time"], c.start_ts)
            a["latest_time"] = max(a["latest_time"], c.end_ts)
            a["protocols"].add(proto_label)
            if is_src:
                a["ports"].add(c.src_port)
                a["sent_pkts"] += fwd_pkts
                a["recv_pkts"] += rev_pkts
                a["sent_bytes"] += fwd_bytes
                a["recv_bytes"] += rev_bytes
            else:
                a["ports"].add(c.dst_port)
                a["sent_pkts"] += rev_pkts
                a["recv_pkts"] += fwd_pkts
                a["sent_bytes"] += rev_bytes
                a["recv_bytes"] += fwd_bytes
            if c.proto.upper() == "TCP":
                a["tcp"] += 1 if is_src else 0
            elif c.proto.upper() == "UDP":
                a["udp"] += 1 if is_src else 0

    ip_stats = sorted(
        [
            IPStatsEntry(
                ip=a["ip"],
                country=a["country"],
                country_code=a["country_code"],
                earliest_time=a["earliest_time"],
                latest_time=a["latest_time"],
                ports=sorted(a["ports"])[:20],
                protocols=sorted(a["protocols"]),
                total_sent_packets=a["sent_pkts"],
                total_recv_packets=a["recv_pkts"],
                total_sent_bytes=a["sent_bytes"],
                total_recv_bytes=a["recv_bytes"],
                tcp_session_count=a["tcp"],
                udp_session_count=a["udp"],
            )
            for a in ip_agg.values()
        ],
        key=lambda e: e.total_sent_packets + e.total_recv_packets,
        reverse=True,
    )

    # ── Protocol stats ────────────────────────────────────────────
    total_pkts = capture.packet_count or 1
    total_bytes_all = sum(c.byte_count for c in conversations) or 1
    proto_agg: dict[str, dict] = {}
    for c in conversations:
        label = c.app_protocol or c.proto
        if label not in proto_agg:
            proto_agg[label] = {
                "pkts": 0, "bytes": 0, "sessions": 0,
                "first": c.start_ts, "last": c.end_ts,
            }
        p = proto_agg[label]
        p["pkts"] += c.packet_count
        p["bytes"] += c.byte_count
        p["sessions"] += 1
        p["first"] = min(p["first"], c.start_ts)
        p["last"] = max(p["last"], c.end_ts)

    proto_stats = sorted(
        [
            ProtoStatsEntry(
                proto=name,
                total_packets=p["pkts"],
                total_bytes=p["bytes"],
                session_count=p["sessions"],
                avg_packet_size=p["bytes"] / p["pkts"] if p["pkts"] else 0,
                percentage_packets=round(p["pkts"] / total_pkts * 100, 2),
                percentage_bytes=round(p["bytes"] / total_bytes_all * 100, 2),
                first_seen=p["first"],
                last_seen=p["last"],
            )
            for name, p in proto_agg.items()
        ],
        key=lambda e: e.total_packets,
        reverse=True,
    )

    # ── Country stats ─────────────────────────────────────────────
    country_agg: dict[str, dict] = {}
    for a in ip_agg.values():
        cc = a["country_code"]
        cn = a["country"]
        if not cc:
            continue
        if cc not in country_agg:
            country_agg[cc] = {
                "country": cn, "code": cc,
                "ips": 0, "pkts": 0, "bytes": 0, "sessions": 0,
            }
        ca = country_agg[cc]
        ca["ips"] += 1
        ca["pkts"] += a["sent_pkts"] + a["recv_pkts"]
        ca["bytes"] += a["sent_bytes"] + a["recv_bytes"]
        ca["sessions"] += a["tcp"] + a["udp"]

    country_stats = sorted(
        [
            CountryStatsEntry(
                country=ca["country"],
                country_code=ca["code"],
                ip_count=ca["ips"],
                total_packets=ca["pkts"],
                total_bytes=ca["bytes"],
                session_count=ca["sessions"],
            )
            for ca in country_agg.values()
        ],
        key=lambda e: e.total_packets,
        reverse=True,
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
        ip_stats=ip_stats,
        proto_stats=proto_stats,
        country_stats=country_stats,
        bucket_seconds=effective_bucket if conversations else bucket_seconds,
        metric=metric_norm,
    )
