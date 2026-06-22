import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProtoStatsEntry } from "../../api/client";
import {
  SortHeader,
  FilterBox,
  PercentBar,
  formatBytes,
  formatTimestamp,
  type SortDir,
} from "./shared";

type SortKey =
  | "proto"
  | "total_packets"
  | "total_bytes"
  | "session_count"
  | "avg_packet_size"
  | "percentage_packets";

const PROTO_COLORS: Record<string, string> = {
  TCP: "text-panel-accent",
  UDP: "text-purple-400",
  ICMP: "text-red-400",
  HTTP: "text-green-400",
  TLS: "text-yellow-400",
  DNS: "text-orange-400",
  SSH: "text-cyan-400",
  HTTPS: "text-yellow-400",
};

export function ProtocolStatsView({
  entries,
  onSelectProtocol,
}: {
  entries: ProtoStatsEntry[];
  onSelectProtocol?: (proto: string) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_packets");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSort = (field: SortKey) => {
    if (field === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(field);
      setSortDir(field === "proto" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => e.proto.toLowerCase().includes(q))
      : entries;
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "proto") {
        const cmp = a.proto.localeCompare(b.proto);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [entries, filter, sortKey, sortDir]);

  if (entries.length === 0) {
    return <p className="text-xs text-panel-muted">{t("stats.noProtocols")}</p>;
  }

  const totalPkts = rows.reduce((s, e) => s + e.total_packets, 0);
  const totalBytes = rows.reduce((s, e) => s + e.total_bytes, 0);
  const totalSessions = rows.reduce((s, e) => s + e.session_count, 0);

  return (
    <div>
      <FilterBox
        value={filter}
        onChange={setFilter}
        placeholder={t("stats.filterProtocols")}
        count={t("stats.protoCount", { count: rows.length })}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-panel-border text-[11px] text-panel-muted">
              <th className="py-1 text-left font-normal">
                <SortHeader label={t("stats.protocol")} field="proto" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("common.packets")} field="total_packets" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("common.bytes")} field="total_bytes" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.sessionCount")} field="session_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.avgPacketSize")} field="avg_packet_size" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal" style={{ minWidth: 140 }}>
                <SortHeader label={t("stats.pctPackets")} field="percentage_packets" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">{t("stats.pctBytes")}</th>
              <th className="py-1 text-left font-normal">{t("stats.firstSeen")}</th>
              <th className="py-1 text-left font-normal">{t("stats.lastSeen")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.proto}
                onClick={() => onSelectProtocol?.(e.proto)}
                className={`border-b border-panel-border/30 hover:bg-panel-accent/5 ${
                  onSelectProtocol ? "cursor-pointer" : ""
                }`}
              >
                <td className="py-1.5 pr-2">
                  <span
                    className={`font-medium ${
                      PROTO_COLORS[e.proto.toUpperCase()] ?? "text-panel-text"
                    }`}
                  >
                    {e.proto.toUpperCase()}
                  </span>
                </td>
                <td className="py-1.5 text-right text-panel-muted">{e.total_packets}</td>
                <td className="py-1.5 text-right text-panel-muted">{formatBytes(e.total_bytes)}</td>
                <td className="py-1.5 text-right text-panel-muted">{e.session_count}</td>
                <td className="py-1.5 text-right text-panel-muted">{formatBytes(e.avg_packet_size)}</td>
                <td className="py-1.5 text-right text-panel-muted">
                  <span className="inline-flex items-center">
                    {e.percentage_packets.toFixed(1)}%
                    <PercentBar pct={e.percentage_packets} />
                  </span>
                </td>
                <td className="py-1.5 text-right text-panel-muted">{e.percentage_bytes.toFixed(1)}%</td>
                <td className="py-1.5 text-panel-muted">{formatTimestamp(e.first_seen)}</td>
                <td className="py-1.5 text-panel-muted">{formatTimestamp(e.last_seen)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-panel-border text-[11px] font-medium text-panel-text">
              <td className="py-1">{t("stats.total")} ({rows.length})</td>
              <td className="py-1 text-right">{totalPkts}</td>
              <td className="py-1 text-right">{formatBytes(totalBytes)}</td>
              <td className="py-1 text-right">{totalSessions}</td>
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
