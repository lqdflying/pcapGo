import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wifi } from "lucide-react";
import type { IPStatsEntry } from "../../api/client";
import { FlagIcon } from "./FlagIcon";
import {
  SortHeader,
  FilterBox,
  formatBytes,
  formatTimestamp,
  type SortDir,
} from "./shared";

type SortKey =
  | "ip"
  | "total_sent_packets"
  | "total_recv_packets"
  | "total_sent_bytes"
  | "total_recv_bytes"
  | "tcp_session_count"
  | "udp_session_count";

export function IPStatsView({
  entries,
  onSelectIP,
}: {
  entries: IPStatsEntry[];
  onSelectIP?: (ip: string) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_sent_packets");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSort = (field: SortKey) => {
    if (field === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(field);
      setSortDir(field === "ip" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.ip.toLowerCase().includes(q) ||
            (e.country ?? "").toLowerCase().includes(q)
        )
      : entries;
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "ip") {
        const cmp = a.ip.localeCompare(b.ip);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [entries, filter, sortKey, sortDir]);

  if (entries.length === 0) {
    return <p className="text-xs text-panel-muted">{t("stats.noEndpoints")}</p>;
  }

  const totalSent = rows.reduce((s, e) => s + e.total_sent_packets, 0);
  const totalRecv = rows.reduce((s, e) => s + e.total_recv_packets, 0);
  const totalSentBytes = rows.reduce((s, e) => s + e.total_sent_bytes, 0);
  const totalRecvBytes = rows.reduce((s, e) => s + e.total_recv_bytes, 0);

  return (
    <div>
      <FilterBox
        value={filter}
        onChange={setFilter}
        placeholder={t("stats.filterIps")}
        count={t("stats.countOfTotal", { count: rows.length, total: entries.length })}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-panel-border text-[11px] text-panel-muted">
              <th className="py-1 text-left font-normal">
                <SortHeader label="IP" field="ip" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="py-1 text-left font-normal">{t("stats.ipLocation")}</th>
              <th className="py-1 text-left font-normal">{t("stats.firstSeen")}</th>
              <th className="py-1 text-left font-normal">{t("stats.lastSeen")}</th>
              <th className="py-1 text-left font-normal">{t("stats.ports")}</th>
              <th className="py-1 text-left font-normal">{t("stats.protocols")}</th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.sentPackets")} field="total_sent_packets" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.recvPackets")} field="total_recv_packets" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.sentBytes")} field="total_sent_bytes" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.recvBytes")} field="total_recv_bytes" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.tcpSessions")} field="tcp_session_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.udpSessions")} field="udp_session_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ep) => (
              <tr
                key={ep.ip}
                onClick={() => onSelectIP?.(ep.ip)}
                className={`border-b border-panel-border/30 hover:bg-panel-accent/5 ${
                  onSelectIP ? "cursor-pointer" : ""
                }`}
              >
                <td className="py-1.5 pr-2 text-panel-text">{ep.ip}</td>
                <td className="py-1.5 pr-2 text-panel-muted">
                  {ep.country_code === "LAN" ? (
                    <Wifi className="mr-1.5 inline h-3.5 w-3.5 text-panel-muted" />
                  ) : (
                    <FlagIcon countryCode={ep.country_code} fallback={ep.country_flag} />
                  )}
                  {ep.country ?? "-"}
                </td>
                <td className="py-1.5 pr-2 text-panel-muted">{formatTimestamp(ep.earliest_time)}</td>
                <td className="py-1.5 pr-2 text-panel-muted">{formatTimestamp(ep.latest_time)}</td>
                <td className="py-1.5 pr-2 text-panel-muted">
                  <span title={ep.ports.join(", ")}>
                    {ep.ports.slice(0, 3).join(", ")}
                    {ep.ports.length > 3 && ` +${ep.ports.length - 3}`}
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-panel-muted">
                  {ep.protocols.join(", ")}
                </td>
                <td className="py-1.5 text-right text-panel-muted">{ep.total_sent_packets}</td>
                <td className="py-1.5 text-right text-panel-muted">{ep.total_recv_packets}</td>
                <td className="py-1.5 text-right text-panel-muted">{formatBytes(ep.total_sent_bytes)}</td>
                <td className="py-1.5 text-right text-panel-muted">{formatBytes(ep.total_recv_bytes)}</td>
                <td className="py-1.5 text-right text-panel-muted">{ep.tcp_session_count}</td>
                <td className="py-1.5 text-right text-panel-muted">{ep.udp_session_count}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-panel-border text-[11px] font-medium text-panel-text">
              <td className="py-1">{t("stats.total")} ({rows.length})</td>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td className="py-1 text-right">{totalSent}</td>
              <td className="py-1 text-right">{totalRecv}</td>
              <td className="py-1 text-right">{formatBytes(totalSentBytes)}</td>
              <td className="py-1 text-right">{formatBytes(totalRecvBytes)}</td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
