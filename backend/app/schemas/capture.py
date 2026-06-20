from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel


class CaptureRead(BaseModel):
    id: uuid.UUID
    filename: str
    size_bytes: int
    sha256: str
    linktype: int
    packet_count: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CaptureList(BaseModel):
    captures: list[CaptureRead]
    total: int


class LayerNode(BaseModel):
    name: str
    summary: str
    offset: int  # byte offset within the packet (0-based)
    length: int  # byte length of this layer
    children: list["LayerNode"] = []


class PacketSummary(BaseModel):
    idx: int
    ts: float
    src: str
    dst: str
    proto: str
    length: int
    info: str


class PacketListResponse(BaseModel):
    """Paginated packet list envelope (Phase 2.2).

    `total` reflects the filtered total when a `proto` filter is applied, so
    clients can render correct pagination metadata.
    """
    items: list[PacketSummary]
    total: int
    offset: int
    limit: int


class PacketDetail(BaseModel):
    idx: int
    ts: float
    src: str
    dst: str
    proto: str
    length: int
    info: str
    layers: list[LayerNode]
    raw_hex: str
    raw_offset: int


class ConversationStats(BaseModel):
    id: uuid.UUID
    proto: str
    src_ip: str
    src_port: int
    dst_ip: str
    dst_port: int
    packet_count: int
    byte_count: int
    start_ts: float
    end_ts: float
    app_protocol: str | None
    flags_summary: str | None


class EndpointStats(BaseModel):
    address: str
    packet_count: int
    byte_count: int
    # Directional breakdown (Phase 5.3). tx_* = traffic sent from this
    # endpoint, rx_* = traffic received. Sum of tx across endpoints equals the
    # capture's total packet count (and same for rx).
    tx_packets: int = 0
    rx_packets: int = 0
    tx_bytes: int = 0
    rx_bytes: int = 0


class ProtocolHierarchy(BaseModel):
    name: str
    packet_count: int
    byte_count: int
    children: list["ProtocolHierarchy"] = []


class IOBucket(BaseModel):
    ts_start: float
    packet_count: int
    byte_count: int


class FollowStreamSegment(BaseModel):
    # "client" = packets from the requested src endpoint, "server" = the reverse.
    direction: str
    ts: float
    # Raw payload bytes, base64-encoded so the client can render hex or ASCII.
    data_b64: str
    length: int


class FollowStreamResponse(BaseModel):
    proto: str
    client: str  # "ip:port" of the requested source endpoint
    server: str  # "ip:port" of the requested destination endpoint
    segments: list[FollowStreamSegment]
    client_bytes: int
    server_bytes: int
    truncated: bool


class StatisticsResponse(BaseModel):
    capture_id: uuid.UUID
    packet_count: int
    duration: float
    protocols: list[ProtocolHierarchy]
    endpoints: list[EndpointStats]
    conversations: list[ConversationStats]
    io_buckets: list[IOBucket]
    # Echo of the IO graph query parameters so clients can render the right
    # axis labels without re-sending the request.
    bucket_seconds: float = 1.0
    metric: str = "packets"
