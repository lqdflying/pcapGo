import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConversationStats } from "../../api/client";
import { SortHeader, FilterBox, formatBytes, type SortDir } from "./shared";

type SortKey = "src" | "dst" | "proto" | "packets" | "bytes" | "duration";

interface Props {
  conversations: ConversationStats[];
  onViewSession?: (conv: ConversationStats) => void;
  onFollowConversation?: (conv: ConversationStats) => void;
}

function dur(conv: ConversationStats) {
  return conv.end_ts - conv.start_ts;
}

export function ConversationsView({
  conversations,
  onViewSession,
  onFollowConversation,
}: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("packets");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggle = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    let rows = conversations;
    if (q) {
      rows = rows.filter(
        (c) =>
          c.src_ip.includes(q) ||
          c.dst_ip.includes(q) ||
          c.proto.toLowerCase().includes(q) ||
          (c.app_protocol ?? "").toLowerCase().includes(q) ||
          String(c.src_port).includes(q) ||
          String(c.dst_port).includes(q)
      );
    }
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "src":
          cmp = `${a.src_ip}:${a.src_port}`.localeCompare(`${b.src_ip}:${b.src_port}`);
          break;
        case "dst":
          cmp = `${a.dst_ip}:${a.dst_port}`.localeCompare(`${b.dst_ip}:${b.dst_port}`);
          break;
        case "proto":
          cmp = (a.app_protocol ?? a.proto).localeCompare(b.app_protocol ?? b.proto);
          break;
        case "packets":
          cmp = a.packet_count - b.packet_count;
          break;
        case "bytes":
          cmp = a.byte_count - b.byte_count;
          break;
        case "duration":
          cmp = dur(a) - dur(b);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [conversations, filter, sortKey, sortDir]);

  if (conversations.length === 0) {
    return <p className="text-sm text-panel-muted">{t("stats.noConversations")}</p>;
  }

  return (
    <div>
      <FilterBox
        value={filter}
        onChange={setFilter}
        placeholder={t("stats.filterConversations")}
        count={t("stats.countOfTotal", {
          count: filtered.length,
          total: conversations.length,
        })}
      />
      <div className="overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-panel-header text-[11px] text-panel-muted">
            <tr>
              <th className="px-2 py-1.5">
                <SortHeader label={t("stats.source")} field="src" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              </th>
              <th className="px-2 py-1.5">
                <SortHeader label={t("stats.destination")} field="dst" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              </th>
              <th className="px-2 py-1.5">
                <SortHeader label={t("stats.app")} field="proto" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              </th>
              <th className="px-2 py-1.5">
                <SortHeader label={t("stats.pkts")} field="packets" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              </th>
              <th className="px-2 py-1.5">
                <SortHeader label={t("common.bytes")} field="bytes" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              </th>
              <th className="px-2 py-1.5">
                <SortHeader label={t("stats.dur")} field="duration" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              </th>
              <th className="px-2 py-1.5">{t("stats.flags")}</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="text-panel-text">
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-panel-border hover:bg-panel-accent/5">
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                  {c.src_ip}:{c.src_port}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                  {c.dst_ip}:{c.dst_port}
                </td>
                <td className="px-2 py-1.5">
                  {c.app_protocol ? (
                    <span className="rounded bg-panel-accent/15 px-1 py-0.5 text-[10px] text-panel-accent">
                      {c.app_protocol}
                    </span>
                  ) : (
                    <span className="text-panel-muted">{c.proto}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {c.packet_count.toLocaleString()}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatBytes(c.byte_count)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {dur(c) < 1
                    ? `${(dur(c) * 1000).toFixed(0)} ms`
                    : `${dur(c).toFixed(2)} s`}
                </td>
                <td className="px-2 py-1.5 text-[10px] text-panel-muted">
                  {c.flags_summary}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <div className="flex gap-1">
                    {onViewSession && (
                      <button
                        onClick={() => onViewSession(c)}
                        className="rounded border border-panel-border px-1.5 py-0.5 text-[10px] text-panel-muted hover:bg-panel-accent/10 hover:text-panel-text"
                      >
                        {t("session.viewSession")}
                      </button>
                    )}
                    {onFollowConversation && (c.proto === "tcp" || c.proto === "udp") && (
                      <button
                        onClick={() => onFollowConversation(c)}
                        className="rounded border border-panel-border px-1.5 py-0.5 text-[10px] text-panel-muted hover:bg-panel-accent/10 hover:text-panel-text"
                      >
                        {t("stats.follow")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
