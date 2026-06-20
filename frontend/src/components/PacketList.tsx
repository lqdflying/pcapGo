import { useRef, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PacketSummary } from "../api/client";

interface Props {
  packets: PacketSummary[];
  selectedIdx: number | null;
  selectedSet: Set<number>;
  onSelect: (idx: number, mode: "single" | "toggle" | "range", pageIndices: number[]) => void;
  loading: boolean;
}

export function PacketList({ packets, selectedIdx, selectedSet, onSelect, loading }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: packets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 30,
  });

  const pageIndices = useMemo(() => packets.map((p) => p.idx), [packets]);

  useEffect(() => {
    if (selectedIdx === null) return;
    const arrayIdx = packets.findIndex((p) => p.idx === selectedIdx);
    if (arrayIdx < 0) return;
    const visible = virtualizer
      .getVirtualItems()
      .some((vi) => vi.index === arrayIdx);
    if (!visible) {
      virtualizer.scrollToIndex(arrayIdx, { align: "center" });
    }
  }, [selectedIdx, packets, virtualizer]);

  const protoClass = (proto: string) => {
    switch (proto.toLowerCase()) {
      case "tcp": return "tr-tcp";
      case "udp": return "tr-udp";
      case "icmp": return "tr-icmp";
      default: return "tr-other";
    }
  };

  const handleClick = (e: React.MouseEvent, idx: number) => {
    const mode = e.shiftKey
      ? "range"
      : e.metaKey || e.ctrlKey
        ? "toggle"
        : "single";
    onSelect(idx, mode, pageIndices);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
  };

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onSelect(idx, "single", pageIndices);
  };

  const formatTs = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toISOString().substring(11, 23);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-panel-border bg-panel-header px-2 py-1 text-[11px] font-medium text-panel-muted select-none">
        <span className="w-12">No.</span>
        <span className="w-28">Time</span>
        <span className="w-36">Source</span>
        <span className="w-36">Destination</span>
        <span className="w-12">Proto</span>
        <span className="w-12">Len</span>
        <span className="flex-1">Info</span>
      </div>

      <div ref={parentRef} className="flex-1 overflow-auto">
        {loading ? (
          <p className="p-4 text-xs text-panel-muted">Loading packets...</p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const pkt = packets[virtualRow.index];
              if (!pkt) return null;
              const isAnchor = selectedIdx === pkt.idx;
              const isSelected = selectedSet.has(pkt.idx);
              return (
                <div
                  key={pkt.idx}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  role="row"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`absolute left-0 top-0 flex w-full items-center text-[11px] cursor-pointer transition-colors hover:bg-panel-accent/5 ${
                    protoClass(pkt.proto)
                  } ${isSelected ? "tr-selected" : ""} ${
                    isAnchor ? "ring-1 ring-inset ring-panel-accent/40" : ""
                  }`}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={(e) => handleClick(e, pkt.idx)}
                  onMouseDown={handleMouseDown}
                  onKeyDown={(e) => handleKeyDown(e, pkt.idx)}
                >
                  <span className="w-12 pl-2 text-panel-muted">{pkt.idx}</span>
                  <span className="w-28 text-panel-muted">{formatTs(pkt.ts)}</span>
                  <span className="w-36 truncate">{pkt.src}</span>
                  <span className="w-36 truncate">{pkt.dst}</span>
                  <span className={`w-12 font-medium ${
                    pkt.proto === "TCP" ? "text-panel-accent" :
                    pkt.proto === "UDP" ? "text-purple-400" :
                    "text-panel-muted"
                  }`}>{pkt.proto}</span>
                  <span className="w-12 text-panel-muted">{pkt.length}</span>
                  <span className="flex-1 truncate text-panel-muted/70">
                    {pkt.info}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
