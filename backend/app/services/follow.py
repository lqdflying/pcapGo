"""Follow-stream reconstruction.

Re-reads the original capture file with scapy and extracts the transport-layer
payloads of a single TCP/UDP conversation (identified by its canonical 5-tuple),
split by direction. Runs as pure file I/O so callers offload it to a worker
thread. The total reconstructed payload is capped so a large flow cannot blow up
memory or the response size.
"""

from __future__ import annotations

from app.services.pcap_parser import _canonical_key, raw_payload_length

# Hard cap on reconstructed payload bytes per direction.
DEFAULT_MAX_BYTES = 1024 * 1024  # 1 MB each way


def follow_stream_sync(
    stored_path: str,
    proto: str,
    src_ip: str,
    src_port: int,
    dst_ip: str,
    dst_port: int,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> dict:
    """Reconstruct one conversation's payload from the capture on disk.

    Packets are emitted in capture (arrival) order. ``direction`` is "client"
    when a packet originates from the requested ``src_ip:src_port`` endpoint and
    "server" otherwise. Returns a dict matching FollowStreamResponse fields.
    """
    import base64

    from scapy.utils import PcapReader
    from scapy.layers.inet import IP, TCP, UDP
    from scapy.layers.inet6 import IPv6

    proto = proto.lower()
    transport = TCP if proto == "tcp" else UDP if proto == "udp" else None
    if transport is None:
        raise ValueError("proto must be 'tcp' or 'udp'")

    target_key = _canonical_key(src_ip, src_port, dst_ip, dst_port, proto)

    segments: list[dict] = []
    client_bytes = 0
    server_bytes = 0
    truncated = False

    with PcapReader(stored_path) as reader:
        for pkt in reader:
            ip_layer = pkt.getlayer(IP) or pkt.getlayer(IPv6)
            if ip_layer is None:
                continue
            tl = pkt.getlayer(transport)
            if tl is None:
                continue

            psrc = getattr(ip_layer, "src", "")
            pdst = getattr(ip_layer, "dst", "")
            sport = getattr(tl, "sport", 0)
            dport = getattr(tl, "dport", 0)

            if _canonical_key(psrc, sport, pdst, dport, proto) != target_key:
                continue

            payload = raw_payload_length(tl)
            if not payload:
                continue

            is_client = psrc == src_ip and sport == src_port
            direction = "client" if is_client else "server"

            used = client_bytes if is_client else server_bytes
            remaining = max_bytes - used
            if remaining <= 0:
                truncated = True
                continue
            chunk = payload[:remaining]
            if len(chunk) < len(payload):
                truncated = True

            if is_client:
                client_bytes += len(chunk)
            else:
                server_bytes += len(chunk)

            segments.append(
                {
                    "direction": direction,
                    "ts": float(pkt.time),
                    "data_b64": base64.b64encode(chunk).decode("ascii"),
                    "length": len(chunk),
                }
            )

    return {
        "proto": proto,
        "client": f"{src_ip}:{src_port}",
        "server": f"{dst_ip}:{dst_port}",
        "segments": segments,
        "client_bytes": client_bytes,
        "server_bytes": server_bytes,
        "truncated": truncated,
    }
