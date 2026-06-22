from __future__ import annotations

import array
import asyncio
import json
import logging
import os
import re
import struct
import uuid
from collections import OrderedDict
from pathlib import Path

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.db.session import async_session
from app.models import User, Capture, CaptureStatus
from app.core.security import get_current_user, get_capture_for_user
from app.schemas.capture import (
    PacketSummary,
    PacketDetail,
    PacketListResponse,
    FollowStreamResponse,
    GeoInfo,
    SessionPacketsResponse,
)
from app.services.follow import follow_stream_sync
from app.services.packet_fields import read_packet_at, packet_from_raw_hex, enrich_layers_with_fields

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/captures", tags=["packets"])

# Two uint64 per packet (jsonl byte offset, summary byte offset) = 16 bytes.
_OFFSET_ENTRY_FMT = struct.Struct("<QQ")
_OFFSET_ENTRY_SIZE = _OFFSET_ENTRY_FMT.size  # 16


# ── Index cache (metadata only) ────────────────────────────────────────────
# Parsing writes index.json once per capture. The metadata is tiny so caching
# is cheap. Keyed by (path, mtime_ns, size) for automatic invalidation.
_INDEX_CACHE_MAX = 64
_INDEX_CACHE: OrderedDict[tuple[str, int, int], dict] = OrderedDict()

# ── Proto-filter cache ─────────────────────────────────────────────────────
# Scanning summary.jsonl to build a proto-filtered index list is O(total) so
# the result is cached per (offsets_path, mtime, size, proto). The cache is
# byte-budgeted (not just entry-count bounded): each matching index is stored
# as a 4-byte unsigned integer in an array.array, and the total retained bytes
# are capped so several-million-match filters cannot OOM the process. The scan
# itself is offloaded to a worker thread so the event loop is not blocked by a
# large sequential read.
_FILTER_CACHE_MAX_BYTES = 64 * 1024 * 1024  # 64 MB
# Keyed by (offsets_path, mtime_ns, size, proto, q).
_FILTER_CACHE: OrderedDict[tuple[str, int, int, str, str], array.array] = OrderedDict()
_FILTER_CACHE_BYTES = 0

# ── Session-filter cache ──────────────────────────────────────────────────
_SESSION_CACHE_MAX_BYTES = 32 * 1024 * 1024  # 32 MB
_SESSION_CACHE: OrderedDict[tuple, array.array] = OrderedDict()
_SESSION_CACHE_BYTES = 0

_PORT_RE = re.compile(r"^(\d+)\s*>\s*(\d+)")
_SESSION_PROTOCOLS = {"tcp", "udp"}


def _parse_ports_from_info(info: str) -> tuple[int, int]:
    m = _PORT_RE.match(info)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 0, 0


def _coerce_port(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _ports_from_summary(s: dict) -> tuple[int, int]:
    sport = _coerce_port(s.get("sport") or s.get("src_port"))
    dport = _coerce_port(s.get("dport") or s.get("dst_port"))
    if sport is not None and dport is not None:
        return sport, dport
    return _parse_ports_from_info(s.get("info", ""))


def _session_matches(
    s: dict, src_ip: str, src_port: int, dst_ip: str, dst_port: int, proto: str
) -> bool:
    pkt_proto = (s.get("proto") or "").lower()
    if pkt_proto != proto:
        return False
    pkt_src = s.get("src", "")
    pkt_dst = s.get("dst", "")
    fwd = pkt_src == src_ip and pkt_dst == dst_ip
    rev = pkt_src == dst_ip and pkt_dst == src_ip
    if not fwd and not rev:
        return False
    sport, dport = _ports_from_summary(s)
    if fwd:
        return sport == src_port and dport == dst_port
    return sport == dst_port and dport == src_port


def _scan_session_indices_sync(
    offsets_path: str,
    summary_path: str,
    src_ip: str,
    src_port: int,
    dst_ip: str,
    dst_port: int,
    proto: str,
) -> array.array:
    try:
        stat = os.stat(offsets_path)
    except OSError:
        raise HTTPException(status_code=500, detail="Packet index file missing")

    cache_key = (offsets_path, stat.st_mtime_ns, stat.st_size, src_ip, src_port, dst_ip, dst_port, proto)
    cached = _SESSION_CACHE.get(cache_key)
    if cached is not None:
        _SESSION_CACHE.move_to_end(cache_key)
        return cached

    global _SESSION_CACHE_BYTES

    for k in [key for key in _SESSION_CACHE if key[0] == offsets_path]:
        arr = _SESSION_CACHE.pop(k)
        _SESSION_CACHE_BYTES -= max(0, len(arr) * 4 + 128)

    matching = array.array("I")
    try:
        with open(summary_path, encoding="utf-8") as f:
            idx = 0
            for line in f:
                try:
                    s = json.loads(line)
                except json.JSONDecodeError:
                    idx += 1
                    continue
                if _session_matches(s, src_ip, src_port, dst_ip, dst_port, proto):
                    matching.append(idx)
                idx += 1
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Packet index file missing")

    new_bytes = max(0, len(matching) * 4 + 128)
    while _SESSION_CACHE and _SESSION_CACHE_BYTES + new_bytes > _SESSION_CACHE_MAX_BYTES:
        _, old = _SESSION_CACHE.popitem(last=False)
        _SESSION_CACHE_BYTES -= max(0, len(old) * 4 + 128)

    _SESSION_CACHE[cache_key] = matching
    _SESSION_CACHE_BYTES += new_bytes
    return matching


def _evict_index(index_path: str) -> None:
    """Drop every cached entry for the given index path (any mtime/size).

    Called on capture deletion so a re-upload can never surface a stale index.
    """
    global _FILTER_CACHE_BYTES
    for k in [key for key in _INDEX_CACHE if key[0] == index_path]:
        _INDEX_CACHE.pop(k, None)
    # Also evict any proto-filter and session caches keyed on the matching offsets path.
    offsets_path = index_path.replace(".index.json", ".offsets.bin")
    for k in [key for key in _FILTER_CACHE if key[0] == offsets_path]:
        arr = _FILTER_CACHE.pop(k)
        _FILTER_CACHE_BYTES -= max(0, len(arr) * 4 + 128)
    global _SESSION_CACHE_BYTES
    for k in [key for key in _SESSION_CACHE if key[0] == offsets_path]:
        arr = _SESSION_CACHE.pop(k)
        _SESSION_CACHE_BYTES -= max(0, len(arr) * 4 + 128)


async def _get_capture(capture_id: uuid.UUID, user: User):
    async with async_session() as session:
        capture = await get_capture_for_user(session, capture_id, user)
    if capture.status != CaptureStatus.ready:
        raise HTTPException(status_code=400, detail="Capture not yet parsed")
    return capture


def _load_packet_index(capture: Capture) -> dict:
    """Load the packet metadata JSON (cached by path+mtime+size)."""
    index_path = capture.parsed_index_path
    if not index_path or not Path(index_path).exists():
        raise HTTPException(status_code=500, detail="Packet index file missing")

    try:
        stat = os.stat(index_path)
    except OSError:
        raise HTTPException(status_code=500, detail="Packet index file missing")

    key = (index_path, stat.st_mtime_ns, stat.st_size)
    cached = _INDEX_CACHE.get(key)
    if cached is not None:
        _INDEX_CACHE.move_to_end(key)
        return cached

    _evict_index(index_path)

    try:
        with open(index_path) as f:
            index = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Failed to load packet index %s: %s", index_path, e)
        raise HTTPException(status_code=500, detail="Packet index file corrupt")
    _INDEX_CACHE[key] = index
    while len(_INDEX_CACHE) > _INDEX_CACHE_MAX:
        _INDEX_CACHE.popitem(last=False)
    return index


def _jsonl_path_for(capture: Capture) -> str:
    """Derive the .jsonl sidecar path from the index path or stored_path."""
    if capture.parsed_index_path:
        return capture.parsed_index_path.replace(".index.json", ".jsonl")
    return f"{capture.stored_path}.jsonl"


def _summary_path_for(capture: Capture) -> str:
    """Derive the .summary.jsonl sidecar path from the index path."""
    if capture.parsed_index_path:
        return capture.parsed_index_path.replace(".index.json", ".summary.jsonl")
    return f"{capture.stored_path}.summary.jsonl"


def _offsets_path_for(capture: Capture) -> str:
    """Derive the .offsets.bin sidecar path from the index path."""
    if capture.parsed_index_path:
        return capture.parsed_index_path.replace(".index.json", ".offsets.bin")
    return f"{capture.stored_path}.offsets.bin"


def _read_packet_jsonl(jsonl_path: str, offset: int) -> dict | None:
    """Read a single packet record from the JSONL file at the given byte offset."""
    try:
        with open(jsonl_path, "rb") as f:
            f.seek(offset)
            line = f.readline().decode("utf-8", errors="replace")
    except FileNotFoundError:
        return None
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError as e:
        logger.warning("Malformed JSONL record at offset %d: %s", offset, e)
        return None


def _read_offsets(offsets_path: str, start_idx: int, count: int) -> list[tuple[int, int]]:
    """Read ``count`` offset entries starting at ``start_idx``.

    Each entry is a ``(jsonl_offset, summary_offset)`` tuple.
    """
    if count <= 0:
        return []
    try:
        with open(offsets_path, "rb") as f:
            f.seek(start_idx * _OFFSET_ENTRY_SIZE)
            raw = f.read(count * _OFFSET_ENTRY_SIZE)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Packet index file missing")
    n = len(raw) // _OFFSET_ENTRY_SIZE
    return [_OFFSET_ENTRY_FMT.unpack_from(raw, i * _OFFSET_ENTRY_SIZE) for i in range(n)]


def _read_single_offset(offsets_path: str, idx: int) -> tuple[int, int] | None:
    """Read a single offset entry at packet index ``idx``."""
    entries = _read_offsets(offsets_path, idx, 1)
    return entries[0] if entries else None


def _read_summary_at(summary_path: str, byte_offset: int) -> dict | None:
    """Read one summary line from summary.jsonl at the given byte offset."""
    try:
        with open(summary_path, "rb") as f:
            f.seek(byte_offset)
            line = f.readline().decode("utf-8", errors="replace")
    except FileNotFoundError:
        return None
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


@router.get("/{capture_id}/packets", response_model=PacketListResponse)
async def list_packets(
    capture_id: uuid.UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=10000),
    proto: str = Query("", description="Filter by protocol: tcp, udp, icmp, etc."),
    q: str = Query("", description="Case-insensitive substring match on src/dst/info/proto."),
    user: User = Depends(get_current_user),
):
    """Paginated packet list.

    Pagination applies to the **filtered** set: when ``proto`` and/or ``q`` are
    set, ``total`` reflects the count of matching packets (not the total in the
    capture), and ``offset``/``limit`` slice into that filtered set.

    The unfiltered path is O(limit): it reads ``limit`` binary offset entries
    then seeks+reads only those summary lines. The filtered path scans
    summary.jsonl once and caches the matching index list in a bounded LRU.
    """
    capture = await _get_capture(capture_id, user)
    index = _load_packet_index(capture)

    total_in_capture = index.get("total", 0)
    offsets_path = _offsets_path_for(capture)
    summary_path = _summary_path_for(capture)
    proto_filter = proto.strip().lower()
    q_filter = q.strip().lower()

    if proto_filter or q_filter:
        matching_indices = await _get_filtered_indices(
            offsets_path, summary_path, proto_filter, q_filter
        )
        filtered_total = len(matching_indices)
        page_indices = matching_indices[offset : offset + limit]
    else:
        filtered_total = total_in_capture
        page_indices = None

    if page_indices is not None:
        # Filtered path: read the specific summary lines by their offsets.
        items = []
        for i in page_indices:
            off = _read_single_offset(offsets_path, i)
            if off is None:
                continue
            _, summary_offset = off
            s = _read_summary_at(summary_path, summary_offset)
            if s:
                items.append(_summary_to_packet_summary(s))
    else:
        # Unfiltered path: O(limit) offset reads + O(limit) summary reads.
        entries = _read_offsets(offsets_path, offset, limit)
        items = []
        for jsonl_off, summary_off in entries:
            s = _read_summary_at(summary_path, summary_off)
            if s:
                items.append(_summary_to_packet_summary(s))

    return PacketListResponse(
        items=items,
        total=filtered_total,
        offset=offset,
        limit=limit,
    )


def _summary_matches(s: dict, proto_filter: str, q_filter: str) -> bool:
    """Whether a summary record matches the proto and/or text filters.

    ``proto_filter`` matches the packet proto or detected app proto exactly.
    ``q_filter`` is a case-insensitive substring tested against src, dst, info,
    proto and app_proto. Empty filters are treated as "match anything".
    """
    pkt_proto = (s.get("proto") or "").lower()
    app_proto = (s.get("app_proto") or "").lower()
    if proto_filter and not (pkt_proto == proto_filter or app_proto == proto_filter):
        return False
    if q_filter:
        haystack = " ".join(
            str(s.get(k, "")) for k in ("src", "dst", "info", "proto", "app_proto")
        ).lower()
        if q_filter not in haystack:
            return False
    return True


def _scan_filtered_indices_sync(
    offsets_path: str, summary_path: str, proto_filter: str, q_filter: str
) -> array.array:
    """Synchronous scan of summary.jsonl; returns matching packet indices."""
    try:
        stat = os.stat(offsets_path)
    except OSError:
        raise HTTPException(status_code=500, detail="Packet index file missing")

    cache_key = (offsets_path, stat.st_mtime_ns, stat.st_size, proto_filter, q_filter)
    cached = _FILTER_CACHE.get(cache_key)
    if cached is not None:
        _FILTER_CACHE.move_to_end(cache_key)
        return cached

    global _FILTER_CACHE_BYTES

    # Evict stale entries for the same offsets path.
    for k in [key for key in _FILTER_CACHE if key[0] == offsets_path]:
        arr = _FILTER_CACHE.pop(k)
        _FILTER_CACHE_BYTES -= max(0, len(arr) * 4 + 128)

    matching = array.array("I")
    try:
        with open(summary_path, encoding="utf-8") as f:
            idx = 0
            for line in f:
                try:
                    s = json.loads(line)
                except json.JSONDecodeError:
                    idx += 1
                    continue
                if _summary_matches(s, proto_filter, q_filter):
                    matching.append(idx)
                idx += 1
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Packet index file missing")

    new_bytes = max(0, len(matching) * 4 + 128)
    # Make room under the byte budget before inserting the new entry.
    while _FILTER_CACHE and _FILTER_CACHE_BYTES + new_bytes > _FILTER_CACHE_MAX_BYTES:
        _, old = _FILTER_CACHE.popitem(last=False)
        _FILTER_CACHE_BYTES -= max(0, len(old) * 4 + 128)

    _FILTER_CACHE[cache_key] = matching
    _FILTER_CACHE_BYTES += new_bytes
    return matching


async def _get_filtered_indices(
    offsets_path: str, summary_path: str, proto_filter: str, q_filter: str
) -> array.array:
    """Scan summary.jsonl once for packets matching the proto and/or text filter.

    Results are cached in a byte-bounded LRU keyed by (offsets_path, mtime,
    size, proto, q). The scan itself runs in a worker thread so large sequential
    reads do not block the event loop.
    """
    return await asyncio.to_thread(
        _scan_filtered_indices_sync, offsets_path, summary_path, proto_filter, q_filter
    )


def _summary_to_packet_summary(s: dict) -> PacketSummary:
    return PacketSummary(
        idx=s.get("idx", 0),
        ts=s.get("ts", 0),
        src=s.get("src", ""),
        dst=s.get("dst", ""),
        proto=s.get("proto", ""),
        length=s.get("length", 0),
        info=s.get("info", ""),
    )


@router.get("/{capture_id}/packets/{packet_idx}", response_model=PacketDetail)
async def get_packet_detail(
    capture_id: uuid.UUID,
    packet_idx: int,
    user: User = Depends(get_current_user),
):
    if packet_idx < 0:
        raise HTTPException(status_code=422, detail="packet_idx must be >= 0")

    capture = await _get_capture(capture_id, user)
    index = _load_packet_index(capture)
    jsonl_path = _jsonl_path_for(capture)
    offsets_path = _offsets_path_for(capture)

    off = _read_single_offset(offsets_path, packet_idx)
    if off is None:
        raise HTTPException(status_code=404, detail=f"Packet index {packet_idx} not found")
    jsonl_offset = off[0]

    record = _read_packet_jsonl(jsonl_path, jsonl_offset)
    if not record:
        raise HTTPException(status_code=404, detail="Packet record not found")

    layers = record.get("layers", [])
    raw_hex = record.get("raw_hex", "")
    index_linktype = index.get("linktype")
    if capture.linktype is not None:
        linktype = capture.linktype
    elif index_linktype is not None:
        linktype = index_linktype
    else:
        linktype = 1
    if raw_hex or (capture.stored_path and Path(capture.stored_path).exists()):
        try:
            # O(1) preferred path: reconstruct the packet from its stored hex
            # dump + the capture link type, avoiding a full pcap re-scan.
            pkt = None
            if raw_hex:
                pkt = await asyncio.to_thread(packet_from_raw_hex, raw_hex, linktype)
            # Fallback (O(idx)): re-read the original pcap when raw_hex was
            # missing or could not be dissected.
            if pkt is None and capture.stored_path and Path(capture.stored_path).exists():
                pkt = await asyncio.to_thread(read_packet_at, capture.stored_path, packet_idx)
            if pkt is not None:
                enrich_layers_with_fields(layers, pkt)
        except Exception:
            logger.debug("Field enrichment failed for %s@%d", capture_id, packet_idx, exc_info=True)

    return PacketDetail(
        idx=packet_idx,
        ts=record.get("ts", 0),
        src=record.get("src", ""),
        dst=record.get("dst", ""),
        proto=record.get("proto", ""),
        length=record.get("length", 0),
        info=record.get("info", ""),
        layers=layers,
        raw_hex=record.get("raw_hex", ""),
        raw_offset=record.get("raw_offset", 0),
    )


@router.get("/{capture_id}/session-packets", response_model=SessionPacketsResponse)
async def session_packets(
    capture_id: uuid.UUID,
    src_ip: str = Query(...),
    src_port: int = Query(..., ge=0, le=65535),
    dst_ip: str = Query(...),
    dst_port: int = Query(..., ge=0, le=65535),
    proto: str = Query(...),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=10000),
    user: User = Depends(get_current_user),
):
    capture = await _get_capture(capture_id, user)
    _load_packet_index(capture)
    offsets_path = _offsets_path_for(capture)
    summary_path = _summary_path_for(capture)
    proto_l = proto.strip().lower()
    if proto_l not in _SESSION_PROTOCOLS:
        raise HTTPException(status_code=422, detail="proto must be 'tcp' or 'udp'")

    matching = await asyncio.to_thread(
        _scan_session_indices_sync,
        offsets_path,
        summary_path,
        src_ip,
        src_port,
        dst_ip,
        dst_port,
        proto_l,
    )
    total = len(matching)
    page_indices = matching[offset : offset + limit]

    items: list[PacketSummary] = []
    for i in page_indices:
        off = _read_single_offset(offsets_path, i)
        if off is None:
            continue
        _, summary_offset = off
        s = _read_summary_at(summary_path, summary_offset)
        if s:
            items.append(_summary_to_packet_summary(s))

    from app.services.geoip import lookup_country, country_code_to_flag

    def _make_geo(ip: str) -> GeoInfo:
        result = lookup_country(ip)
        if result is None:
            return GeoInfo()
        code, name = result
        return GeoInfo(country=name, country_code=code, country_flag=country_code_to_flag(code))

    return SessionPacketsResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        src_geo=_make_geo(src_ip),
        dst_geo=_make_geo(dst_ip),
    )


@router.get("/{capture_id}/follow", response_model=FollowStreamResponse)
async def follow_stream(
    capture_id: uuid.UUID,
    src_ip: str = Query(...),
    src_port: int = Query(..., ge=0, le=65535),
    dst_ip: str = Query(...),
    dst_port: int = Query(..., ge=0, le=65535),
    proto: str = Query(..., description="tcp or udp"),
    user: User = Depends(get_current_user),
):
    """Reconstruct a single TCP/UDP conversation's payload (Follow Stream).

    Re-reads the original capture on disk (in a worker thread) and returns the
    transport payloads of the requested 5-tuple, split into client/server
    directions in capture order. Payload is capped per direction to bound the
    response size.
    """
    proto_l = proto.strip().lower()
    if proto_l not in ("tcp", "udp"):
        raise HTTPException(status_code=422, detail="proto must be 'tcp' or 'udp'")

    capture = await _get_capture(capture_id, user)
    if not capture.stored_path or not Path(capture.stored_path).exists():
        raise HTTPException(status_code=404, detail="Capture file is no longer available")

    try:
        result = await asyncio.to_thread(
            follow_stream_sync,
            capture.stored_path,
            proto_l,
            src_ip,
            src_port,
            dst_ip,
            dst_port,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("follow_stream failed for capture %s", capture_id)
        raise HTTPException(status_code=500, detail="Failed to reconstruct stream")

    return FollowStreamResponse(**result)


_MAX_EXPLAIN_PACKETS = 50


def serialize_packets_for_llm(
    summary_path: str, offsets_path: str, indices: list[int]
) -> str:
    """Read selected packet summaries from JSONL and format them for LLM context."""
    indices = indices[:_MAX_EXPLAIN_PACKETS]
    lines: list[str] = []
    for i in indices:
        off = _read_single_offset(offsets_path, i)
        if off is None:
            continue
        s = _read_summary_at(summary_path, off[1])
        if not s:
            continue
        src = s.get("src", "?")
        dst = s.get("dst", "?")
        proto = s.get("proto", "?")
        length = s.get("length", 0)
        info = s.get("info", "")
        ts = s.get("ts", 0)
        lines.append(f"#{i} t={ts:.6f} {proto} {src}->{dst} len={length} {info}")
    return "\n".join(lines)


_EXPORT_COLUMNS = ["idx", "ts", "src", "dst", "proto", "length", "info"]


@router.get("/{capture_id}/export")
async def export_packets(
    capture_id: uuid.UUID,
    format: str = Query("csv", description="csv or json"),
    proto: str = Query(""),
    q: str = Query(""),
    user: User = Depends(get_current_user),
):
    """Stream the (optionally filtered) packet list as CSV or JSON.

    Honors the same ``proto``/``q`` filters as the list endpoint so the export
    matches what the user currently sees. The response is streamed so large
    captures never get fully buffered in memory; the sync generator is run in a
    threadpool by Starlette, keeping the event loop free.
    """
    fmt = format.strip().lower()
    if fmt not in ("csv", "json"):
        raise HTTPException(status_code=422, detail="format must be 'csv' or 'json'")

    capture = await _get_capture(capture_id, user)
    _load_packet_index(capture)  # validates the index exists
    offsets_path = _offsets_path_for(capture)
    summary_path = _summary_path_for(capture)
    proto_filter = proto.strip().lower()
    q_filter = q.strip().lower()

    if proto_filter or q_filter:
        indices: list[int] | None = list(
            await _get_filtered_indices(offsets_path, summary_path, proto_filter, q_filter)
        )
    else:
        indices = None

    def iter_records():
        if indices is None:
            try:
                with open(summary_path, encoding="utf-8") as f:
                    for line in f:
                        try:
                            yield json.loads(line)
                        except json.JSONDecodeError:
                            continue
            except FileNotFoundError:
                return
        else:
            for i in indices:
                off = _read_single_offset(offsets_path, i)
                if off is None:
                    continue
                s = _read_summary_at(summary_path, off[1])
                if s:
                    yield s

    if fmt == "csv":
        def gen_csv():
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(_EXPORT_COLUMNS)
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)
            for s in iter_records():
                writer.writerow([s.get(c, "") for c in _EXPORT_COLUMNS])
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate(0)

        media_type = "text/csv"
        body = gen_csv()
        filename = f"packets-{capture_id}.csv"
    else:
        def gen_json():
            yield "["
            first = True
            for s in iter_records():
                rec = {c: s.get(c) for c in _EXPORT_COLUMNS}
                yield ("" if first else ",") + json.dumps(rec, ensure_ascii=False)
                first = False
            yield "]"

        media_type = "application/json"
        body = gen_json()
        filename = f"packets-{capture_id}.json"

    return StreamingResponse(
        body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
