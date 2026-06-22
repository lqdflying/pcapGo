import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PacketSummary, GeoInfo } from "../api/client";
import { formatBytes } from "./stats/shared";
import { FlagIcon } from "./stats/FlagIcon";

interface Props {
  packets: PacketSummary[];
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  srcGeo: GeoInfo;
  dstGeo: GeoInfo;
  proto: string;
  appProtocol: string | null;
  onSelectPacket?: (idx: number) => void;
}

export function SessionSequenceDiagram({
  packets,
  srcIp,
  srcPort,
  dstIp,
  dstPort,
  srcGeo,
  dstGeo,
  proto,
  appProtocol,
  onSelectPacket,
}: Props) {
  const { t } = useTranslation();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const baseTs = packets[0]?.ts ?? 0;

  const rowVirtualizer = useVirtualizer({
    count: packets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  const isForward = useCallback(
    (pkt: PacketSummary) => pkt.src === srcIp,
    [srcIp]
  );

  const duration = useMemo(() => {
    if (packets.length < 2) return 0;
    return packets[packets.length - 1].ts - packets[0].ts;
  }, [packets]);

  const totalBytes = useMemo(
    () => packets.reduce((s, p) => s + p.length, 0),
    [packets]
  );

  const handleClick = (pkt: PacketSummary) => {
    setSelectedIdx(pkt.idx);
    onSelectPacket?.(pkt.idx);
  };

  if (packets.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-panel-muted">
        {t("session.noPackets")}
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-panel-border bg-panel-header/50 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 font-mono text-xs text-panel-accent">
            <FlagIcon countryCode={srcGeo.country_code} />
            {srcIp}:{srcPort}
          </span>
          <span className="rounded bg-panel-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-panel-accent">
            {appProtocol ?? proto.toUpperCase()}
          </span>
          <span className="flex items-center gap-1 font-mono text-xs text-panel-success">
            <FlagIcon countryCode={dstGeo.country_code} />
            {dstIp}:{dstPort}
          </span>
        </div>
        <div className="flex gap-4 text-[11px] text-panel-muted">
          <span>
            {t("session.duration")}: {duration < 1 ? `${(duration * 1000).toFixed(0)} ms` : `${duration.toFixed(3)} s`}
          </span>
          <span>
            {t("session.totalPackets")}: {packets.length}
          </span>
          <span>
            {t("session.totalBytes")}: {formatBytes(totalBytes)}
          </span>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center border-b border-panel-border bg-panel-header/30 px-4 py-1 text-[10px] font-medium text-panel-muted">
        <span className="w-16">#</span>
        <span className="w-24">{t("session.relativeTime")}</span>
        <span className="flex-1 text-center">{t("session.direction")}</span>
        <span className="w-16 text-right">{t("session.size")}</span>
        <span className="ml-3 flex-1">{t("session.info")}</span>
      </div>

      {/* Virtual list */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const pkt = packets[virtualRow.index];
            const fwd = isForward(pkt);
            const rel = pkt.ts - baseTs;
            const selected = selectedIdx === pkt.idx;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => handleClick(pkt)}
                className={`flex cursor-pointer items-center px-4 py-0.5 text-xs ${
                  selected
                    ? "bg-panel-accent/20"
                    : "hover:bg-panel-accent/5"
                }`}
              >
                <span className="w-16 tabular-nums text-panel-muted">
                  #{pkt.idx}
                </span>
                <span className="w-24 tabular-nums text-panel-muted">
                  +{rel.toFixed(3)}s
                </span>
                <span className="flex flex-1 items-center justify-center">
                  {fwd ? (
                    <span className="flex items-center text-panel-accent">
                      <span className="inline-block h-px w-16 bg-panel-accent" />
                      <span className="ml-0.5 border-y-[4px] border-l-[6px] border-y-transparent border-l-panel-accent" />
                    </span>
                  ) : (
                    <span className="flex items-center text-panel-success">
                      <span className="mr-0.5 border-y-[4px] border-r-[6px] border-y-transparent border-r-panel-success" />
                      <span className="inline-block h-px w-16 bg-panel-success" />
                    </span>
                  )}
                </span>
                <span className="w-16 text-right tabular-nums text-panel-muted">
                  {formatBytes(pkt.length)}
                </span>
                <span
                  className={`ml-3 flex-1 truncate ${
                    fwd ? "text-panel-accent" : "text-panel-success"
                  }`}
                >
                  {pkt.info}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer legend */}
      <div className="border-t border-panel-border bg-panel-header px-4 py-1 text-[10px] text-panel-muted">
        <span className="text-panel-accent">■</span> {t("session.forward")} ({srcIp}) ·{" "}
        <span className="text-panel-success">■</span> {t("session.reverse")} ({dstIp})
      </div>
    </div>
  );
}
