import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import type { PacketSummary, PacketDetail as PacketDetailType, GeoInfo } from "../api/client";
import { getPacketDetail } from "../api/client";
import { PacketTree } from "./PacketTree";
import { HexViewer } from "./HexViewer";
import { FlagIcon } from "./stats/FlagIcon";
import { formatBytes } from "./stats/shared";

interface Props {
  captureId: string;
  packets: PacketSummary[];
  total: number;
  srcIp: string;
  dstIp: string;
  srcGeo: GeoInfo;
  dstGeo: GeoInfo;
  offset: number;
  limit: number;
  onPageChange?: (offset: number) => void;
}

function protoColor(proto: string) {
  const p = proto.toLowerCase();
  if (p === "tcp") return "text-blue-400";
  if (p === "udp") return "text-green-400";
  if (p === "icmp") return "text-yellow-400";
  if (p === "dns" || p === "tls" || p === "http") return "text-purple-400";
  return "text-panel-text";
}

export function SessionDataFlow({
  captureId,
  packets,
  total,
  srcIp,
  srcGeo,
  dstGeo,
  offset,
  limit,
  onPageChange,
}: Props) {
  const { t } = useTranslation();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hexHighlight, setHexHighlight] = useState<{ offset: number; length: number } | null>(null);

  const {
    data: detail,
    isLoading: detailLoading,
  } = useQuery<PacketDetailType>({
    queryKey: ["packet-detail", captureId, selectedIdx],
    queryFn: () => getPacketDetail(captureId, selectedIdx!),
    enabled: selectedIdx != null,
  });

  const handleSelectPacket = useCallback((idx: number) => {
    setSelectedIdx(idx);
    setHexHighlight(null);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const totalBytes = packets.reduce((s, p) => s + p.length, 0);

  const geoFor = (ip: string) => (ip === srcIp ? srcGeo : dstGeo);

  return (
    <div className="flex h-full flex-col">
      <PanelGroup direction="vertical">
        {/* Top: packet table */}
        <Panel defaultSize={55} minSize={25}>
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-panel-header text-[10px] text-panel-muted">
                  <tr>
                    <th className="px-2 py-1">{t("session.index")}</th>
                    <th className="px-2 py-1">{t("packetList.source")}</th>
                    <th className="px-2 py-1">{t("session.srcPort")}</th>
                    <th className="px-2 py-1">{t("packetList.destination")}</th>
                    <th className="px-2 py-1">{t("session.dstPort")}</th>
                    <th className="px-2 py-1">{t("packetList.time")}</th>
                    <th className="px-2 py-1">{t("packetList.proto")}</th>
                    <th className="px-2 py-1 text-right">{t("session.size")}</th>
                    <th className="px-2 py-1">{t("session.info")}</th>
                  </tr>
                </thead>
                <tbody className="text-panel-text">
                  {packets.map((pkt) => {
                    const ports = parsePortsFromInfo(pkt.info);
                    const selected = selectedIdx === pkt.idx;
                    const geo = geoFor(pkt.src);
                    const dGeo = geoFor(pkt.dst);
                    return (
                      <tr
                        key={pkt.idx}
                        onClick={() => handleSelectPacket(pkt.idx)}
                        className={`cursor-pointer border-t border-panel-border ${
                          selected
                            ? "bg-panel-accent/20"
                            : "hover:bg-panel-accent/5"
                        }`}
                      >
                        <td className="px-2 py-1 tabular-nums text-panel-muted">
                          {pkt.idx}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 font-mono">
                          <FlagIcon countryCode={geo.country_code} fallback={geo.country_flag} />
                          {pkt.src}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{ports.sport}</td>
                        <td className="whitespace-nowrap px-2 py-1 font-mono">
                          <FlagIcon countryCode={dGeo.country_code} fallback={dGeo.country_flag} />
                          {pkt.dst}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{ports.dport}</td>
                        <td className="px-2 py-1 tabular-nums text-panel-muted">
                          {pkt.ts.toFixed(6)}
                        </td>
                        <td className={`px-2 py-1 ${protoColor(pkt.proto)}`}>
                          {pkt.proto}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {formatBytes(pkt.length)}
                        </td>
                        <td className="max-w-xs truncate px-2 py-1 text-panel-muted">
                          {pkt.info}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {packets.length === 0 && (
                <p className="py-8 text-center text-sm text-panel-muted">
                  {t("session.noPackets")}
                </p>
              )}
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-panel-border bg-panel-header px-3 py-1 text-[10px] text-panel-muted">
                <button
                  onClick={() => onPageChange?.(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="rounded px-2 py-0.5 hover:bg-panel-accent/10 disabled:opacity-30"
                >
                  {t("capture.previousPage")}
                </button>
                <span>
                  {t("capture.pageOf", {
                    page: currentPage,
                    total: totalPages,
                  })}
                </span>
                <button
                  onClick={() => onPageChange?.(offset + limit)}
                  disabled={offset + limit >= total}
                  className="rounded px-2 py-0.5 hover:bg-panel-accent/10 disabled:opacity-30"
                >
                  {t("capture.nextPage")}
                </button>
              </div>
            )}
          </div>
        </Panel>

        <PanelResizeHandle className="h-1.5 bg-panel-border hover:bg-panel-accent/30" />

        {/* Bottom: detail panels */}
        <Panel defaultSize={45} minSize={15}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={50} minSize={20}>
              <PacketTree
                detail={detail ?? null}
                loading={detailLoading}
                onSelectLayer={setHexHighlight}
              />
            </Panel>
            <PanelResizeHandle className="w-1.5 bg-panel-border hover:bg-panel-accent/30" />
            <Panel defaultSize={50} minSize={20}>
              <HexViewer
                detail={detail ?? null}
                loading={detailLoading}
                highlight={hexHighlight}
              />
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>

      {/* Status bar */}
      <div className="border-t border-panel-border bg-panel-header px-4 py-1 text-[10px] text-panel-muted">
        {t("session.totalPackets")}: {total} · {t("session.totalBytes")}:{" "}
        {formatBytes(totalBytes)}
      </div>
    </div>
  );
}

function parsePortsFromInfo(info: string): { sport: number; dport: number } {
  const m = info.match(/^(\d+)\s*>\s*(\d+)/);
  if (m) return { sport: Number(m[1]), dport: Number(m[2]) };
  return { sport: 0, dport: 0 };
}
