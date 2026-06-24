import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { ConversationStats } from "../../api/client";
import { SortHeader, FilterBox, formatBytes, type SortDir } from "./shared";

type SortKey = "src" | "dst" | "proto" | "packets" | "bytes" | "duration";

interface Props {
  conversations: ConversationStats[];
  onViewSession?: (conv: ConversationStats) => void;
  onFollowConversation?: (conv: ConversationStats) => void;
}

interface IPPairGroup {
  groupKey: string;
  src_ip: string;
  dst_ip: string;
  flowCount: number;
  packet_count: number;
  byte_count: number;
  start_ts: number;
  end_ts: number;
  app_protocol: string | null;
  app_protocol_count: number;
  flags_summary: string | null;
  children: ConversationStats[];
}

type DisplayRow =
  | { type: "flat"; conv: ConversationStats }
  | { type: "group"; group: IPPairGroup }
  | { type: "child"; conv: ConversationStats; groupKey: string };

function dur(conv: { start_ts: number; end_ts: number }) {
  return conv.end_ts - conv.start_ts;
}

function formatDur(d: number) {
  if (d < 1) return `${(d * 1000).toFixed(0)} ms`;
  return `${d.toFixed(2)} s`;
}

function groupKeyFor(c: ConversationStats) {
  return JSON.stringify([c.src_ip, c.dst_ip]);
}

function buildGroups(convs: ConversationStats[]): Map<string, IPPairGroup> {
  const groups = new Map<string, IPPairGroup>();
  for (const c of convs) {
    const key = groupKeyFor(c);
    let g = groups.get(key);
    if (!g) {
      g = {
        groupKey: key,
        src_ip: c.src_ip,
        dst_ip: c.dst_ip,
        flowCount: 0,
        packet_count: 0,
        byte_count: 0,
        start_ts: c.start_ts,
        end_ts: c.end_ts,
        app_protocol: null,
        app_protocol_count: 0,
        flags_summary: null,
        children: [],
      };
      groups.set(key, g);
    }
    g.flowCount++;
    g.packet_count += c.packet_count;
    g.byte_count += c.byte_count;
    g.start_ts = Math.min(g.start_ts, c.start_ts);
    g.end_ts = Math.max(g.end_ts, c.end_ts);
    g.children.push(c);
  }

  for (const g of groups.values()) {
    const protoCounts = new Map<string, number>();
    const flagSet = new Set<string>();
    for (const c of g.children) {
      const p = c.app_protocol ?? c.proto;
      protoCounts.set(p, (protoCounts.get(p) ?? 0) + c.packet_count);
      if (c.flags_summary) {
        for (const f of c.flags_summary.split(",")) flagSet.add(f);
      }
    }
    g.app_protocol_count = protoCounts.size;
    if (protoCounts.size === 1) {
      g.app_protocol = protoCounts.keys().next().value!;
    } else {
      let best: string | null = null;
      let bestCount = 0;
      for (const [p, cnt] of protoCounts) {
        if (cnt > bestCount) { best = p; bestCount = cnt; }
      }
      g.app_protocol = best;
    }
    g.flags_summary = flagSet.size > 0 ? [...flagSet].sort().join(",") : null;
  }

  return groups;
}

function sortGroups(groups: IPPairGroup[], sortKey: SortKey, sortDir: SortDir): IPPairGroup[] {
  return [...groups].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "src":
        cmp = a.src_ip.localeCompare(b.src_ip);
        break;
      case "dst":
        cmp = a.dst_ip.localeCompare(b.dst_ip);
        break;
      case "proto":
        cmp = (a.app_protocol ?? "").localeCompare(b.app_protocol ?? "");
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
  const [grouped, setGrouped] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

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

  const displayRows = useMemo((): DisplayRow[] => {
    if (!grouped) {
      return filtered.map((conv) => ({ type: "flat" as const, conv }));
    }

    const groups = buildGroups(filtered);
    const sorted = sortGroups([...groups.values()], sortKey, sortDir);
    const rows: DisplayRow[] = [];

    for (const g of sorted) {
      if (g.flowCount === 1) {
        rows.push({ type: "flat", conv: g.children[0] });
      } else {
        rows.push({ type: "group", group: g });
        if (expandedGroups.has(g.groupKey)) {
          for (const c of g.children) {
            rows.push({ type: "child", conv: c, groupKey: g.groupKey });
          }
        }
      }
    }

    return rows;
  }, [filtered, grouped, expandedGroups, sortKey, sortDir]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  if (conversations.length === 0) {
    return <p className="text-sm text-panel-muted">{t("stats.noConversations")}</p>;
  }

  return (
    <div>
      <div className="mb-2 flex items-start gap-2">
        <div className="flex-1">
          <FilterBox
            value={filter}
            onChange={setFilter}
            placeholder={t("stats.filterConversations")}
            count={t("stats.countOfTotal", {
              count: filtered.length,
              total: conversations.length,
            })}
          />
        </div>
        <button
          type="button"
          aria-pressed={grouped}
          onClick={() => {
            setGrouped((g) => !g);
            setExpandedGroups(new Set());
          }}
          className={`mt-0.5 whitespace-nowrap rounded border px-2 py-1 text-[10px] transition ${
            grouped
              ? "border-panel-accent bg-panel-accent/15 text-panel-accent"
              : "border-panel-border text-panel-muted hover:bg-panel-accent/10 hover:text-panel-text"
          }`}
        >
          {t("stats.groupByIpPair")}
        </button>
      </div>
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
            {displayRows.map((row) => {
              if (row.type === "group") {
                const g = row.group;
                const expanded = expandedGroups.has(g.groupKey);
                return (
                  <tr
                    key={`group-${g.groupKey}`}
                    className="border-t border-panel-border bg-panel-header/30 hover:bg-panel-accent/5"
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} conversation group ${g.src_ip} to ${g.dst_ip}`}
                        onClick={() => toggleGroup(g.groupKey)}
                        className="inline-flex items-center rounded text-left hover:text-panel-accent focus:outline-none focus:ring-1 focus:ring-panel-accent"
                      >
                        <span className="mr-1 inline-flex items-center" aria-hidden="true">
                          {expanded
                            ? <ChevronDown className="h-3 w-3 text-panel-muted" />
                            : <ChevronRight className="h-3 w-3 text-panel-muted" />}
                        </span>
                        <span>{g.src_ip}</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                      {g.dst_ip}
                    </td>
                    <td className="px-2 py-1.5">
                      {g.app_protocol_count === 1 && g.app_protocol ? (
                        <span className="rounded bg-panel-accent/15 px-1 py-0.5 text-[10px] text-panel-accent">
                          {g.app_protocol}
                        </span>
                      ) : (
                        <span className="text-[10px] text-panel-muted">
                          {t("stats.mixed", { count: g.app_protocol_count })}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {g.packet_count.toLocaleString()}
                      <span className="ml-1 rounded bg-panel-accent/10 px-1 text-[9px] text-panel-accent">
                        {t("stats.flowCount", { count: g.flowCount })}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatBytes(g.byte_count)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatDur(dur(g))}
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-panel-muted">
                      {g.flags_summary}
                    </td>
                    <td className="px-2 py-1.5" />
                  </tr>
                );
              }

              const c = row.conv;
              const isChild = row.type === "child";
              return (
                <tr
                  key={isChild ? `child-${c.id}` : c.id}
                  className={`border-t border-panel-border hover:bg-panel-accent/5 ${isChild ? "bg-panel-bg/50" : ""}`}
                >
                  <td className={`whitespace-nowrap py-1.5 font-mono ${isChild ? "pl-7 pr-2" : "px-2"}`}>
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
                    {formatDur(dur(c))}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
