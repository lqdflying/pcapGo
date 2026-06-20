"""On-demand per-field extraction for a single packet.

Re-reads the original pcap to get the scapy packet, then walks each layer's
``fields_desc`` to produce Wireshark-like field/value rows. Called from the
packet-detail endpoint; the result is transient (not persisted to JSONL).
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def read_packet_at(stored_path: str, idx: int):
    """Read and return the scapy packet at *idx* from *stored_path*.

    Returns ``None`` when the file is missing, unreadable, or the index is
    out of range. Designed to be called via ``asyncio.to_thread``.
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
    """
    def _flatten(nodes: list[dict]) -> list[dict]:
        out: list[dict] = []
        for n in nodes:
            out.append(n)
            out.extend(_flatten(n.get("children", [])))
        return out

    flat = _flatten(record_layers)

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
