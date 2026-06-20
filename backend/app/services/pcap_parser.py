"""
Streaming PCAP/PCAPNG parser using scapy.

Reads a capture file lazily via PcapReader in a worker thread (pure file
I/O, no DB access). The async entry point keeps all database operations on
the main event loop to avoid asyncpg cross-loop failures.

Sidecar files written per capture (all atomically via ``.tmp`` + ``os.replace``):
  - ``<id>.jsonl``         full per-packet records (layers, raw_hex)
  - ``<id>.summary.jsonl`` lean per-packet summaries (for the list view)
  - ``<id>.offsets.bin``   2 x uint64 LE per packet (jsonl offset, summary offset)
  - ``<id>.index.json``    metadata only ({total, linktype, files})
"""

from __future__ import annotations

import json
import logging
import os
import random
import struct
import tempfile
import uuid
from pathlib import Path

from app.config import settings
from app.models import CaptureStatus
from app.services.flows import FlowBuilder, layer_extraction

logger = logging.getLogger(__name__)

# Reservoir sample size per conversation for LLM evidence.
_EVIDENCE_SAMPLE_SIZE = 32

# Two uint64 (jsonl offset + summary offset) per packet = 16 bytes.
_OFFSET_ENTRY_FMT = struct.Struct("<QQ")
_OFFSET_ENTRY_SIZE = _OFFSET_ENTRY_FMT.size  # 16


async def parse_pcap(capture_id: str):
    """Background task: parse a pcap file and write cached sidecars + DB rows.

    All DB operations stay on the main event loop. The synchronous scapy
    parsing is offloaded to a worker thread via ``asyncio.to_thread``.
    """
    import asyncio

    try:
        await _parse_pcap_async(capture_id)
    except Exception:
        logger.exception("parse_pcap failed for capture %s", capture_id)
        raise


async def _parse_pcap_async(capture_id: str) -> None:
    """Async parse orchestration on the main event loop."""
    import asyncio
    from app.db.session import async_session
    from app.models import Capture, Conversation
    from sqlalchemy import delete, select

    capture_uuid = uuid.UUID(capture_id)
    capture_user_id = None

    # --- Phase 1: DB read + set status=parsing (main loop) ---
    async with async_session() as session:
        result = await session.execute(
            select(Capture).where(Capture.id == capture_uuid)
        )
        capture = result.scalar_one_or_none()
        if not capture:
            return
        capture.status = CaptureStatus.parsing
        await session.commit()
        stored_path = str(capture.stored_path)
        capture_user_id = capture.user_id

    user_dir = Path(settings.upload_dir) / str(capture_user_id)
    jsonl_path = user_dir / f"{capture_id}.jsonl"
    summary_path = user_dir / f"{capture_id}.summary.jsonl"
    offsets_path = user_dir / f"{capture_id}.offsets.bin"
    index_path = user_dir / f"{capture_id}.index.json"

    # --- Phase 2: pure file I/O in a worker thread (no DB) ---
    try:
        total, linktype, conversations, evidence_map = await asyncio.to_thread(
            _parse_file_sync,
            stored_path,
            str(jsonl_path),
            str(summary_path),
            str(offsets_path),
        )
    except Exception:
        await _mark_failed(capture_uuid)
        raise

    # --- Phase 3: DB write (main loop) ---
    # Phase 2 has already promoted the sidecar files. We must recheck that the
    # capture still exists (the user may have deleted it while parsing ran) and
    # clean the promoted files if it is gone or if the DB write fails.
    try:
        async with async_session() as session:
            await session.execute(
                delete(Conversation).where(Conversation.capture_id == capture_uuid)
            )

            result = await session.execute(
                select(Capture).where(Capture.id == capture_uuid)
            )
            cap = result.scalar_one_or_none()
            if not cap:
                # Capture was deleted mid-parse; remove the orphan sidecars we
                # just promoted and finish quietly.
                _clean_sidecars(
                    jsonl_path, summary_path, offsets_path, index_path
                )
                return

            cap.packet_count = total
            cap.parsed_index_path = str(index_path)
            cap.status = CaptureStatus.ready
            cap.linktype = linktype

            for conv in conversations:
                evidence = evidence_map.get(conv.get("key"))
                c = Conversation(
                    capture_id=cap.id,
                    proto=conv["proto"],
                    src_ip=conv["src_ip"],
                    src_port=conv.get("src_port", 0),
                    dst_ip=conv["dst_ip"],
                    dst_port=conv.get("dst_port", 0),
                    packet_count=conv["packet_count"],
                    byte_count=conv["byte_count"],
                    fwd_packet_count=conv.get("fwd_packet_count", 0),
                    fwd_byte_count=conv.get("fwd_byte_count", 0),
                    start_ts=conv["start_ts"],
                    end_ts=conv["end_ts"],
                    app_protocol=conv.get("app_proto"),
                    flags_summary=conv.get("flags_summary"),
                    evidence_json=json.dumps(evidence) if evidence else None,
                )
                session.add(c)
            await session.commit()
    except Exception:
        # DB failure after sidecars were promoted: mark failed and remove the
        # now-orphan files so a retry/re-upload starts clean.
        _clean_sidecars(jsonl_path, summary_path, offsets_path, index_path)
        await _mark_failed(capture_uuid)
        raise


async def _mark_failed(capture_uuid: uuid.UUID) -> None:
    from app.db.session import async_session
    from app.models import Capture
    from sqlalchemy import select

    async with async_session() as session:
        result = await session.execute(
            select(Capture).where(Capture.id == capture_uuid)
        )
        cap = result.scalar_one_or_none()
        if cap:
            cap.status = CaptureStatus.failed
            await session.commit()


def _clean_sidecars(
    jsonl_path: str,
    summary_path: str,
    offsets_path: str,
    index_path: str,
) -> None:
    """Best-effort removal of promoted sidecar files after a failed/moot parse."""
    for path in (jsonl_path, summary_path, offsets_path, index_path):
        try:
            os.unlink(path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Pure file I/O (runs in a worker thread — no DB access, no async)
# ---------------------------------------------------------------------------

def _parse_file_sync(
    stored_path: str,
    jsonl_path: str,
    summary_path: str,
    offsets_path: str,
) -> tuple[int, int, list[dict], dict[str, list[dict]]]:
    """Parse the pcap file and write all sidecars atomically.

    Returns ``(total, linktype, conversations, evidence_map)``.
    On failure, all ``.tmp`` files are removed.
    """
    from scapy.utils import PcapReader

    tmp_jsonl = jsonl_path + ".tmp"
    tmp_summary = summary_path + ".tmp"
    tmp_offsets = offsets_path + ".tmp"

    builder = FlowBuilder()
    evidence_sampler = _EvidenceSampler(_EVIDENCE_SAMPLE_SIZE)
    total = 0
    linktype = 1

    try:
        with PcapReader(stored_path) as reader:
            linktype = getattr(reader, "linktype", 1)

            with open(tmp_jsonl, "w", encoding="utf-8") as f_jsonl, \
                 open(tmp_summary, "w", encoding="utf-8") as f_summary, \
                 open(tmp_offsets, "wb") as f_offsets:

                for idx, pkt in enumerate(reader):
                    ts = float(pkt.time)
                    layers, raw_hex, raw_bytes = layer_extraction(pkt)
                    meta = _extract_meta(pkt, layers)

                    record = {
                        "idx": idx,
                        "ts": ts,
                        "src": meta["src"],
                        "dst": meta["dst"],
                        "proto": meta["proto"],
                        "length": len(raw_bytes),
                        "info": meta["info"],
                        "layers": [_layer_to_dict(l) for l in layers],
                        "raw_hex": raw_hex,
                        "raw_offset": 0,
                    }
                    json_line = json.dumps(record, ensure_ascii=False) + "\n"

                    summary_record = {
                        "idx": idx,
                        "ts": ts,
                        "src": meta["src"],
                        "dst": meta["dst"],
                        "proto": meta["proto"],
                        "length": len(raw_bytes),
                        "info": meta["info"],
                        "app_proto": meta["app_proto"],
                    }
                    summary_line = json.dumps(summary_record, ensure_ascii=False) + "\n"

                    jsonl_offset = f_jsonl.tell()
                    summary_offset = f_summary.tell()
                    f_jsonl.write(json_line)
                    f_summary.write(summary_line)
                    f_offsets.write(_OFFSET_ENTRY_FMT.pack(jsonl_offset, summary_offset))

                    # Feed the flow builder with the packet's ORIGINAL direction.
                    builder.feed({
                        "key": meta["conv_key"],
                        "proto": meta["proto"].lower(),
                        "src": meta["src"],
                        "sport": meta["sport"],
                        "dst": meta["dst"],
                        "dport": meta["dport"],
                        "length": len(raw_bytes),
                        "ts": ts,
                        "app_proto": meta["app_proto"],
                        "flags": meta["flags_set"],
                    })

                    # Feed the evidence sampler.
                    evidence_sampler.observe(meta["conv_key"], {
                        "ts": ts,
                        "src": meta["src"],
                        "sport": meta["sport"],
                        "dst": meta["dst"],
                        "dport": meta["dport"],
                        "flags": meta["flags_set"],
                        "seq": meta["seq"],
                        "ack": meta["ack"],
                        "payload_len": meta["payload_len"],
                        "dns_qname": meta["dns_qname"],
                        "dns_answer": meta["dns_answer"],
                    })

                    total = idx + 1

        conversations = builder.build()
        evidence_map = evidence_sampler.finalize()

        # All files written successfully — atomically promote .tmp to final.
        for tmp, final in (
            (tmp_jsonl, jsonl_path),
            (tmp_summary, summary_path),
            (tmp_offsets, offsets_path),
        ):
            os.replace(tmp, final)

        # Write the metadata index last.
        meta_index = {
            "total": total,
            "linktype": linktype,
            "files": {
                "jsonl": os.path.basename(jsonl_path),
                "summary": os.path.basename(summary_path),
                "offsets": os.path.basename(offsets_path),
            },
        }
        _atomic_write_json(jsonl_path.replace(".jsonl", ".index.json"), meta_index)

        return total, linktype, conversations, evidence_map

    except Exception:
        for tmp in (tmp_jsonl, tmp_summary, tmp_offsets):
            try:
                os.unlink(tmp)
            except OSError:
                pass
        raise


def _atomic_write_json(path: str, data: dict) -> None:
    """Write a JSON file atomically via a temp file + os.replace."""
    tmp_fd, tmp_name = tempfile.mkstemp(
        dir=os.path.dirname(path), suffix=".tmp", prefix=".meta-"
    )
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


class _EvidenceSampler:
    """Reservoir-samples structured packet records per conversation key.

    The first and last packet of each flow are always preserved so handshake
    evidence (SYN, SYN-ACK, final FIN/RST) survives. Anomalous packets (RST,
    FIN, initial SYN) are also retained. The remaining budget is filled with
    uniform reservoir samples from the middle of the flow.

    To avoid OOM on high-cardinality captures, the total number of tracked
    flow keys is bounded.
    """

    # Bound the number of unique flow keys that carry evidence. Beyond this,
    # new flows are ignored rather than creating unbounded dict entries.
    _MAX_FLOW_KEYS = 100_000

    def __init__(self, max_samples: int) -> None:
        self.max_samples = max_samples
        self._first: dict[str, dict] = {}
        self._last: dict[str, dict] = {}
        self._anomalies: dict[str, list[dict]] = {}
        self._reservoir: dict[str, list[dict]] = {}
        self._counts: dict[str, int] = {}
        self._middle_counts: dict[str, int] = {}

    @staticmethod
    def _is_anomalous(record: dict) -> bool:
        flags = record.get("flags", "")
        flag_set = set(flags.split(",")) if flags else set()
        if "RST" in flag_set:
            return True
        if "FIN" in flag_set:
            return True
        if "SYN" in flag_set and "ACK" not in flag_set:
            return True
        return False

    def observe(self, key: str, record: dict) -> None:
        if not key or key == "other":
            return
        if len(self._first) >= self._MAX_FLOW_KEYS and key not in self._first:
            return

        count = self._counts.get(key, 0)
        self._counts[key] = count + 1

        if count == 0:
            self._first[key] = record
            return

        # Always keep the most recent packet as the last sample.
        self._last[key] = record

        if self._is_anomalous(record):
            anomalies = self._anomalies.setdefault(key, [])
            if len(anomalies) < self.max_samples:
                anomalies.append(record)
            return

        # Normal middle packet: reservoir sample into the budget left after
        # reserving one slot for first and one for last.
        reservoir = self._reservoir.setdefault(key, [])
        middle_count = self._middle_counts.get(key, 0) + 1
        self._middle_counts[key] = middle_count
        reservoir_cap = max(0, self.max_samples - 2)

        if len(reservoir) < reservoir_cap:
            reservoir.append(record)
        elif reservoir_cap > 0:
            j = random.randint(0, middle_count - 1)
            if j < reservoir_cap:
                reservoir[j] = record

    def finalize(self) -> dict[str, list[dict]]:
        result: dict[str, list[dict]] = {}
        for key in self._first:
            samples: list[dict] = []
            first = self._first.get(key)
            last = self._last.get(key)
            if first is not None:
                samples.append(first)
            if last is not None and last is not first:
                samples.append(last)
            samples.extend(self._anomalies.get(key, []))
            samples.extend(self._reservoir.get(key, []))
            # Hard cap while preserving first/last/anomaly priority (they are
            # inserted before the middle reservoir samples).
            if len(samples) > self.max_samples:
                samples = samples[: self.max_samples]
            result[key] = samples
        return result


# ---------------------------------------------------------------------------
# Metadata extraction helpers
# ---------------------------------------------------------------------------

# Application-protocol detection by TCP/UDP port. Mirrors the table in
# wiki/Uploading-and-Analyzing.md. Used for both the per-packet summary and
# the packet-list app-protocol filter (the frontend dropdown offers these
# lowercase names).
_TCP_PORT_PROTOCOLS = {
    80: "HTTP",
    8080: "HTTP",
    443: "TLS",
    8443: "TLS",
    6379: "Redis",
    3306: "MySQL",
    5432: "PostgreSQL",
    22: "SSH",
    25: "SMTP",
    587: "SMTP",
    21: "FTP",
}
_UDP_PORT_PROTOCOLS = {
    53: "DNS",
}


def _detect_app_proto(sport: int, dport: int, tcp: bool) -> str | None:
    return _TCP_PORT_PROTOCOLS.get(sport) or _TCP_PORT_PROTOCOLS.get(dport) if tcp \
        else _UDP_PORT_PROTOCOLS.get(sport) or _UDP_PORT_PROTOCOLS.get(dport)


def _extract_dns_fields(pkt) -> tuple[str | None, str | None]:
    """Extract DNS query name and a compact answer string if present."""
    qname = None
    answer = None
    try:
        if pkt.haslayer("DNS"):
            from scapy.layers.dns import DNS
            dns = pkt.getlayer(DNS)
            if dns.qd:
                qname = str(dns.qd.qname).rstrip(".")
            answers = []
            if dns.an:
                rr = dns.an
                count = 0
                while rr and count < 4:
                    if hasattr(rr, "rdata"):
                        answers.append(str(rr.rdata))
                    rr = rr.payload if hasattr(rr, "payload") else None
                    count += 1
            if answers:
                answer = ",".join(answers)
    except Exception:
        pass
    return qname, answer


def _extract_meta(pkt, layers: list) -> dict:
    """Extract structured metadata from a scapy packet.

    Returns a dict with: src, dst, proto, info, conv_key, app_proto,
    flags_set, sport, dport, seq, ack, payload_len, dns_qname, dns_answer.
    """
    src = "unknown"
    dst = "unknown"
    proto = "Unknown"
    info = ""
    app_proto = None
    sport = 0
    dport = 0
    seq = 0
    ack = 0
    payload_len = 0
    dns_qname = None
    dns_answer = None

    try:
        from scapy.layers.inet import IP, TCP, UDP
        from scapy.layers.inet6 import IPv6
    except Exception:
        IP = IPv6 = TCP = UDP = None  # type: ignore

    ip_layer = None
    if IP:
        ip_layer = pkt.getlayer(IP)
    if ip_layer is None and IPv6:
        ip_layer = pkt.getlayer(IPv6)

    if ip_layer:
        src = getattr(ip_layer, "src", "unknown")
        dst = getattr(ip_layer, "dst", "unknown")
        proto = "IP"

    tcp_layer = pkt.getlayer(TCP) if TCP else None
    udp_layer = pkt.getlayer(UDP) if UDP else None

    conv_key = "other"
    flags_set = ""

    if tcp_layer:
        proto = "TCP"
        sport = getattr(tcp_layer, "sport", 0)
        dport = getattr(tcp_layer, "dport", 0)
        flags = getattr(tcp_layer, "flags", 0)
        seq = getattr(tcp_layer, "seq", 0)
        ack = getattr(tcp_layer, "ack", 0)
        info = _tcp_info(tcp_layer)
        conv_key = _canonical_key(src, sport, dst, dport, "tcp")
        flags_set = _tcp_flags_str(flags)
        app_proto = _detect_app_proto(sport, dport, tcp=True)
        payload_len = max(0, len(raw_payload_length(tcp_layer)))

    elif udp_layer:
        proto = "UDP"
        sport = getattr(udp_layer, "sport", 0)
        dport = getattr(udp_layer, "dport", 0)
        info = _udp_info(udp_layer)
        conv_key = _canonical_key(src, sport, dst, dport, "udp")
        app_proto = _detect_app_proto(sport, dport, tcp=False)
        payload_len = max(0, len(raw_payload_length(udp_layer)))
        if app_proto == "DNS":
            dns_qname, dns_answer = _extract_dns_fields(pkt)

    elif IP and pkt.haslayer("ICMP"):
        proto = "ICMP"
        conv_key = _canonical_key(src, 0, dst, 0, "icmp")

    if not info:
        try:
            info = pkt.summary()
        except Exception:
            info = f"Packet length: {len(bytes(pkt))}"

    if len(info) > 200:
        info = info[:197] + "..."

    return {
        "src": src,
        "dst": dst,
        "proto": proto,
        "info": info,
        "conv_key": conv_key,
        "app_proto": app_proto,
        "flags_set": flags_set,
        "sport": sport,
        "dport": dport,
        "seq": seq,
        "ack": ack,
        "payload_len": payload_len,
        "dns_qname": dns_qname,
        "dns_answer": dns_answer,
    }


def raw_payload_length(layer) -> bytes:
    """Return the payload bytes of a transport layer (for payload_len)."""
    payload = getattr(layer, "payload", None)
    if payload is None:
        return b""
    try:
        return bytes(payload)
    except Exception:
        return b""


def _canonical_key(src: str, sport: int, dst: str, dport: int, proto: str) -> str:
    """Canonical 5-tuple so bidirectional flows collapse."""
    if (src, sport) < (dst, dport):
        return f"{src}:{sport}-{dst}:{dport}-{proto}"
    else:
        return f"{dst}:{dport}-{src}:{sport}-{proto}"


def _tcp_flags_str(flags: int) -> str:
    """Convert TCP flags integer to a human-readable string."""
    parts = []
    if flags & 0x02:
        parts.append("SYN")
    if flags & 0x10:
        parts.append("ACK")
    if flags & 0x01:
        parts.append("FIN")
    if flags & 0x04:
        parts.append("RST")
    if flags & 0x08:
        parts.append("PSH")
    if flags & 0x20:
        parts.append("URG")
    return ",".join(parts) if parts else ""


def _tcp_info(tcp) -> str:
    flags = getattr(tcp, "flags", 0)
    flag_str = ""
    if flags & 0x02:
        flag_str += "SYN "
    if flags & 0x10:
        flag_str += "ACK "
    if flags & 0x01:
        flag_str += "FIN "
    if flags & 0x04:
        flag_str += "RST "
    if flags & 0x08:
        flag_str += "PSH "
    sport = getattr(tcp, "sport", 0)
    dport = getattr(tcp, "dport", 0)
    seq = getattr(tcp, "seq", 0)
    ack = getattr(tcp, "ack", 0)
    info = f"{sport} > {dport} [{flag_str.strip()}]"
    if flags & 0x10:
        info += f" Seq={seq} Ack={ack}"
    return info


def _udp_info(udp) -> str:
    sport = getattr(udp, "sport", 0)
    dport = getattr(udp, "dport", 0)
    length = getattr(udp, "len", 0)
    return f"{sport} > {dport} Len={length}"


def _layer_to_dict(layer: dict) -> dict:
    """Recursively convert a parsed layer dict (including children) for JSON."""
    return {
        "name": layer["name"],
        "summary": layer.get("summary", ""),
        "offset": layer.get("offset", 0),
        "length": layer.get("length", 0),
        "children": [_layer_to_dict(c) for c in layer.get("children", [])],
    }
