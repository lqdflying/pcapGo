"""On-demand per-field extraction for a single packet.

Re-reads the original pcap to get the scapy packet, then walks each layer's
``fields_desc`` to produce Wireshark-like field/value rows. Called from the
packet-detail endpoint; the result is transient (not persisted to JSONL).
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_LINKTYPES_EXPECTING_DISSECTION = frozenset({
    0,    # DLT_NULL / loopback
    1,    # DLT_EN10MB / Ethernet
    101,  # DLT_RAW
    113,  # DLT_LINUX_SLL
    228,  # DLT_IPV4
    229,  # DLT_IPV6
    276,  # DLT_LINUX_SLL2
})


def read_packet_at(stored_path: str, idx: int):
    """Read and return the scapy packet at *idx* from *stored_path*.

    Returns ``None`` when the file is missing, unreadable, or the index is
    out of range. Designed to be called via ``asyncio.to_thread``.

    This is O(idx): it re-opens the pcap with ``PcapReader`` and iterates from
    packet 0. It is kept as a fallback for captures whose JSONL records lack a
    usable ``raw_hex``; the preferred, O(1) path is
    :func:`packet_from_raw_hex`.
    """
    path = Path(stored_path)
    if not path.exists():
        return None
    try:
        from scapy.utils import PcapReader
        with PcapReader(str(path)) as reader:
            for i, pkt in enumerate(reader):
                if i == idx:
                    return pkt
    except Exception:
        logger.debug("read_packet_at failed for %s@%d", stored_path, idx, exc_info=True)
    return None


def packet_from_raw_hex(raw_hex: str, linktype: int = 1):
    """Reconstruct a single scapy packet from its stored hex dump.

    O(1): parses only this packet's bytes instead of re-reading the whole pcap
    up to the packet index (which is what :func:`read_packet_at` does). The
    JSONL record already carries ``raw_hex`` and the capture carries
    ``linktype``, so field enrichment no longer needs to touch the original
    pcap for the common case.

    Returns the scapy packet, or ``None`` when ``raw_hex`` is missing/invalid
    or dissection fails. Callers should fall back to ``read_packet_at`` when
    this returns ``None`` and the original pcap is still on disk.
    """
    if not raw_hex:
        return None
    try:
        raw = bytes.fromhex(raw_hex.replace(" ", ""))
    except (ValueError, TypeError):
        logger.debug("packet_from_raw_hex: invalid hex (len=%d)", len(raw_hex or ""))
        return None
    if not raw:
        return None
    try:
        linktype_id = int(linktype)
    except (TypeError, ValueError):
        logger.debug("packet_from_raw_hex: invalid linktype %r", linktype)
        return None

    def _raw_layer(conf):
        if conf.raw_layer is None:
            import scapy.packet  # noqa: F401  ensures conf.raw_layer is set
        return conf.raw_layer

    try:
        from scapy.config import conf
        expects_dissection = linktype_id in _LINKTYPES_EXPECTING_DISSECTION
        # Mirror PcapReader when Scapy's registry is populated. In cold
        # processes the registry may not contain common DLTs yet; for known
        # linktypes, returning Raw would look successful but lose the layers
        # the endpoint is trying to enrich, so signal failure and let callers
        # fall back to read_packet_at().
        try:
            ll_cls = conf.l2types.num2layer[linktype_id]
        except KeyError:
            if expects_dissection:
                return None
            ll_cls = _raw_layer(conf)

        try:
            pkt = ll_cls(raw)
        except Exception:
            if expects_dissection:
                return None
            pkt = _raw_layer(conf)(raw)

        raw_cls = _raw_layer(conf)
        if expects_dissection and raw_cls is not None and isinstance(pkt, raw_cls):
            return None
        return pkt
    except Exception:
        logger.debug("packet_from_raw_hex failed (linktype=%d)", linktype_id, exc_info=True)
        return None


def extract_layer_fields(layer) -> list[dict]:
    """Extract individual field name/value pairs from a single scapy layer.

    Returns a list of ``{"name", "value", "offset", "length"}`` dicts.
    Per-field byte offsets are best-effort (``None`` when scapy doesn't
    expose them cleanly, e.g. bitfields sharing a byte).
    """
    fields: list[dict] = []
    if not hasattr(layer, "fields_desc"):
        return fields
    for fd in layer.fields_desc:
        name = fd.name
        try:
            raw_val = layer.getfieldval(name)
        except Exception:
            continue
        try:
            disp = fd.i2repr(layer, raw_val)
        except Exception:
            disp = str(raw_val)
        fields.append({
            "name": name,
            "value": disp,
            "offset": None,
            "length": None,
        })
    return fields


def enrich_layers_with_fields(record_layers: list[dict], pkt) -> None:
    """Walk the scapy layer chain in parallel with *record_layers* and
    attach a ``fields`` list to each node (in place).

    *record_layers* is the nested tree from the stored JSONL: each dict has
    ``name``, ``summary``, ``offset``, ``length``, ``children``.  We flatten
    both trees into ordered lists and match by position.

    A count mismatch between the JSONL layer tree and the scapy packet is
    logged at debug level (it usually means the same bytes were dissected
    differently, e.g. a trailing padding/payload layer); enrichment still
    proceeds attaching the available scapy layers to the first matching
    record nodes so the common case keeps working.
    """
    def _flatten(nodes: list[dict]) -> list[dict]:
        out: list[dict] = []
        for n in nodes:
            out.append(n)
            out.extend(_flatten(n.get("children", [])))
        return out

    def _scapy_layer_count(p) -> int:
        n = 0
        cur = p
        while cur is not None:
            n += 1
            payload = getattr(cur, "payload", None)
            if payload is None or payload.__class__.__name__ in ("NoneType", "NoPayload"):
                break
            if len(bytes(payload)) == 0:
                break
            cur = payload
        return n

    flat = _flatten(record_layers)
    if flat:
        scapy_count = _scapy_layer_count(pkt)
        if scapy_count != len(flat):
            logger.debug(
                "enrich_layers_with_fields: layer count mismatch "
                "(record=%d, scapy=%d); attaching by position",
                len(flat), scapy_count,
            )

    current = pkt
    idx = 0
    while current and idx < len(flat):
        flat[idx]["fields"] = extract_layer_fields(current)
        idx += 1
        payload = getattr(current, "payload", None)
        if payload is None or payload.__class__.__name__ in ("NoneType", "NoPayload"):
            break
        if len(bytes(payload)) == 0:
            break
        current = payload
