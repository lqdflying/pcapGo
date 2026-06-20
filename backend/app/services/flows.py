"""
Packet layer extraction and conversation grouping.

Uses scapy's packet introspection to build a protocol layer tree,
then groups raw packet metadata into TCP/UDP/ICMP conversations with
forward/reverse direction tracking for accurate Tx/Rx statistics.
"""

from __future__ import annotations


def layer_extraction(pkt) -> tuple[list[dict], str, bytes]:
    """
    Walk a scapy packet's layers and return:
    - layers: list of {name, summary, offset, length, children}
    - raw_hex: space-separated hex string
    - raw_bytes: full packet bytes
    """
    raw_bytes = bytes(pkt)
    raw_hex = " ".join(f"{b:02x}" for b in raw_bytes)

    layers = []
    offset = 0
    current = pkt

    while current:
        name = current.__class__.__name__
        payload = current.payload if hasattr(current, "payload") else None
        current_bytes = bytes(current)

        # Determine length of this layer's header (before payload)
        payload_bytes = bytes(payload) if payload else b""
        header_len = len(current_bytes) - len(payload_bytes)
        if header_len <= 0:
            header_len = len(current_bytes)

        # Build summary for this layer
        summary = _layer_summary(current)

        layer = {
            "name": name,
            "summary": summary,
            "offset": offset,
            "length": header_len,
            "children": [],
        }
        layers.append(layer)
        offset += header_len

        # Move to payload for next iteration
        if payload and isinstance(payload, type(pkt)):
            current = payload
        elif payload and hasattr(payload, "__class__"):
            # Still a scapy layer but might be a different type
            current = payload
        else:
            break

    # Nest child relationships (parent->child chain)
    if layers:
        for i in range(len(layers) - 1):
            layers[i]["children"].append(layers[i + 1])

    # Only return the root layer with children nested
    root = [layers[0]] if layers else []

    return root, raw_hex, raw_bytes


def _layer_summary(layer) -> str:
    """Generate a concise summary string for a scapy layer."""
    try:
        return layer.summary()
    except Exception:
        return layer.__class__.__name__


def _parse_key(key: str) -> tuple[str, str, int, str, int, str]:
    """Parse a canonical key ``src:sport-dst:dport-proto`` into endpoints.

    Returns ``(src_ip, src_port_str, src_port, dst_ip, dst_port_str, dst_port)``.
    The canonical key's first endpoint is always the lexicographically smaller
    ``(ip, port)`` pair (the "forward" endpoint).
    """
    parts = key.rsplit("-", 1)
    conv_proto = parts[1] if len(parts) > 1 else "other"
    addr_part = parts[0]
    left, right = addr_part.rsplit("-", 1) if "-" in addr_part else (addr_part, "")
    src_ep = left.rsplit(":", 1) if ":" in left else (left, "0")
    dst_ep = right.rsplit(":", 1) if ":" in right else (right, "0")
    src_ip = src_ep[0]
    src_port = int(src_ep[1]) if src_ep[1].isdigit() else 0
    dst_ip = dst_ep[0]
    dst_port = int(dst_ep[1]) if dst_ep[1].isdigit() else 0
    return src_ip, src_ep[1], src_port, dst_ip, dst_ep[1], dst_port


class FlowBuilder:
    """Incremental conversation builder with forward/reverse tracking.

    Call ``feed(pkt_dict)`` per packet, then ``build()`` to get the final
    list of conversation dicts. Each packet dict must include:

    - ``key``: the canonical 5-tuple key
    - ``src``, ``sport``, ``dst``, ``dport``: the packet's ORIGINAL direction
    - ``length``, ``ts``, ``app_proto``, ``flags``

    A packet is classified "forward" when its original ``(src, sport)`` matches
    the canonical flow's forward endpoint (the lexicographically smaller pair).

    To avoid unbounded memory on high-cardinality captures (e.g. one flow per
    packet), the number of tracked flows is capped. Additional packets are
    aggregated into a synthetic overflow flow so parsing remains O(1) in memory
    per packet rather than O(unique flows).
    """

    MAX_FLOWS = 100_000
    _OVERFLOW_KEY = "__overflow__"

    def __init__(self) -> None:
        self.flows: dict[str, dict] = {}

    def feed(self, pkt: dict) -> None:
        key = pkt.get("key", "")
        if not key:
            return

        if key not in self.flows:
            # Cap total unique flows to prevent OOM on high-cardinality captures.
            if len(self.flows) >= self.MAX_FLOWS:
                key = self._OVERFLOW_KEY
                if key not in self.flows:
                    self.flows[key] = {
                        "key": key,
                        "proto": "other",
                        "src_ip": "other",
                        "src_port": 0,
                        "dst_ip": "other",
                        "dst_port": 0,
                        "packet_count": 0,
                        "byte_count": 0,
                        "fwd_packet_count": 0,
                        "fwd_byte_count": 0,
                        "start_ts": float("inf"),
                        "end_ts": 0,
                        "app_proto": None,
                        "flags_set": set(),
                    }
            else:
                src_ip, _, src_port, dst_ip, _, dst_port = _parse_key(key)
                self.flows[key] = {
                    "key": key,
                    "proto": pkt.get("proto", ""),
                    "src_ip": src_ip,
                    "src_port": src_port,
                    "dst_ip": dst_ip,
                    "dst_port": dst_port,
                    "packet_count": 0,
                    "byte_count": 0,
                    "fwd_packet_count": 0,
                    "fwd_byte_count": 0,
                    "start_ts": float("inf"),
                    "end_ts": 0,
                    "app_proto": pkt.get("app_proto"),
                    "flags_set": set(),
                }

        f = self.flows[key]
        f["packet_count"] += 1
        f["byte_count"] += pkt.get("length", 0)
        f["start_ts"] = min(f["start_ts"], pkt.get("ts", 0))
        f["end_ts"] = max(f["end_ts"], pkt.get("ts", 0))

        # The synthetic overflow flow just aggregates totals; it does not
        # represent a real endpoint pair, so directional tracking is meaningless.
        if key != self._OVERFLOW_KEY:
            # Classify forward vs reverse using the packet's original direction.
            # When the packet's source is unknown (default ""), treat it as
            # forward so flows without direction metadata still aggregate.
            fwd_src = f["src_ip"]
            fwd_port = f["src_port"]
            pkt_src = pkt.get("src", "")
            pkt_sport = pkt.get("sport", 0)
            if pkt_src == fwd_src and pkt_sport == fwd_port:
                f["fwd_packet_count"] += 1
                f["fwd_byte_count"] += pkt.get("length", 0)
            elif not pkt_src:
                f["fwd_packet_count"] += 1
                f["fwd_byte_count"] += pkt.get("length", 0)

        pkt_flags = pkt.get("flags", "")
        if pkt_flags:
            for flag in pkt_flags.split(","):
                f["flags_set"].add(flag)

    def build(self) -> list[dict]:
        result = []
        for key, f in self.flows.items():
            flags_summary = ",".join(sorted(f["flags_set"])) if f["flags_set"] else None
            result.append({
                "key": f["key"],
                "proto": f["proto"],
                "src_ip": f["src_ip"],
                "src_port": f["src_port"],
                "dst_ip": f["dst_ip"],
                "dst_port": f["dst_port"],
                "packet_count": f["packet_count"],
                "byte_count": f["byte_count"],
                "fwd_packet_count": f["fwd_packet_count"],
                "fwd_byte_count": f["fwd_byte_count"],
                "start_ts": f["start_ts"],
                "end_ts": f["end_ts"],
                "app_proto": f["app_proto"],
                "flags_summary": flags_summary,
            })
        return result


def build_conversations(raw_packets: list[dict]) -> list[dict]:
    """
    Group raw packet summaries into conversations by canonical 5-tuple.

    Each packet dict should include ``src``/``sport``/``dst``/``dport`` (the
    original direction) for forward/reverse classification. If they are
    absent, all packets are assumed to be in the forward direction.

    Returns list of dicts suitable for Conversation DB rows.
    """
    builder = FlowBuilder()
    for pkt in raw_packets:
        builder.feed(pkt)
    return builder.build()
