import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wifi } from "lucide-react";
import type { CountryStatsEntry } from "../../api/client";
import {
  SortHeader,
  FilterBox,
  formatBytes,
  countryCodeToFlag,
  type SortDir,
} from "./shared";

type SortKey =
  | "country"
  | "ip_count"
  | "total_packets"
  | "total_bytes"
  | "session_count";

export function CountryStatsView({
  entries,
}: {
  entries: CountryStatsEntry[];
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_packets");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSort = (field: SortKey) => {
    if (field === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(field);
      setSortDir(field === "country" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.country.toLowerCase().includes(q) ||
            e.country_code.toLowerCase().includes(q)
        )
      : entries;
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "country") {
        const cmp = a.country.localeCompare(b.country);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [entries, filter, sortKey, sortDir]);

  if (entries.length === 0) {
    return <p className="text-xs text-panel-muted">{t("stats.noCountries")}</p>;
  }

  const totalPkts = rows.reduce((s, e) => s + e.total_packets, 0);
  const totalBytes = rows.reduce((s, e) => s + e.total_bytes, 0);
  const totalIPs = rows.reduce((s, e) => s + e.ip_count, 0);
  const totalSessions = rows.reduce((s, e) => s + e.session_count, 0);

  return (
    <div>
      <p className="mb-2 text-[11px] text-panel-muted">{t("stats.countryStatsHint")}</p>
      <FilterBox
        value={filter}
        onChange={setFilter}
        placeholder={t("stats.filterCountries")}
        count={t("stats.countryCount", { count: rows.length })}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-panel-border text-[11px] text-panel-muted">
              <th className="py-1 text-left font-normal">
                <SortHeader label={t("stats.country")} field="country" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="py-1 text-right font-normal">
                <SortHeader label={t("stats.ipCount")} field="ip_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
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
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const flag = countryCodeToFlag(e.country_code);
              const isLan = e.country_code === "LAN";
              return (
                <tr
                  key={e.country_code}
                  className="border-b border-panel-border/30 hover:bg-panel-accent/5"
                >
                  <td className="py-1.5 pr-2 text-panel-text">
                    {isLan ? (
                      <Wifi className="mr-1.5 inline h-3.5 w-3.5 text-panel-muted" />
                    ) : flag ? (
                      <span className="mr-1.5">{flag}</span>
                    ) : null}
                    {e.country}
                  </td>
                  <td className="py-1.5 text-right text-panel-muted">{e.ip_count}</td>
                  <td className="py-1.5 text-right text-panel-muted">{e.total_packets}</td>
                  <td className="py-1.5 text-right text-panel-muted">{formatBytes(e.total_bytes)}</td>
                  <td className="py-1.5 text-right text-panel-muted">{e.session_count}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-panel-border text-[11px] font-medium text-panel-text">
              <td className="py-1">{t("stats.total")} ({rows.length})</td>
              <td className="py-1 text-right">{totalIPs}</td>
              <td className="py-1 text-right">{totalPkts}</td>
              <td className="py-1 text-right">{formatBytes(totalBytes)}</td>
              <td className="py-1 text-right">{totalSessions}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
