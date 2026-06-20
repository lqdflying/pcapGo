import { useMemo, useState } from "react";
import { Loader2, ArrowUp, ArrowDown, Search } from "lucide-react";
import type {
  StatisticsResponse,
  ProtocolHierarchy,
  EndpointStats,
  ConversationStats,
  IOBucket,
} from "../api/client";

interface Props {
  stats: StatisticsResponse | null;
  loading: boolean;
  onSelectEndpoint?: (ip: string) => void;
  onSelectConversation?: (conv: ConversationStats) => void;
  onBucketChange?: (bucketSeconds: number, metric: "packets" | "bytes") => void;
}

type Tab = "protocols" | "endpoints" | "conversations" | "io";

export function StatsTabs({
  stats,
  loading,
  onSelectEndpoint,
  onSelectConversation,
  onBucketChange,
}: Props) {
  const [tab, setTab] = useState<Tab>("protocols");

  const tabs: { id: Tab; label: string }[] = [
    { id: "protocols", label: "Protocol Hierarchy" },
    { id: "endpoints", label: "Endpoints" },
    { id: "conversations", label: "Conversations" },
    { id: "io", label: "IO Graph" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-panel-border px-4 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded px-3 py-1 text-xs transition ${
              tab === t.id
                ? "bg-panel-accent/20 text-panel-accent"
                : "text-panel-muted hover:text-panel-text"
            }`}
          >
            {t.label}
          </button>
        ))}
        {stats && (
          <span className="ml-auto text-xs text-panel-muted">
            {stats.packet_count} packets · {(stats.duration * 1000).toFixed(1)} ms
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-panel-muted" />
          </div>
        ) : !stats ? (
          <p className="text-sm text-panel-muted">No statistics available</p>
        ) : tab === "protocols" ? (
          <ProtocolTree
            protocols={stats.protocols}
            totalPackets={stats.packet_count}
          />
        ) : tab === "endpoints" ? (
          <EndpointsTable endpoints={stats.endpoints} onSelect={onSelectEndpoint} />
        ) : tab === "conversations" ? (
          <ConversationsTable
            conversations={stats.conversations}
            onSelect={onSelectConversation}
          />
        ) : (
          <IOGraph
            buckets={stats.io_buckets}
            duration={stats.duration}
            bucketSeconds={stats.bucket_seconds}
            metric={stats.metric as "packets" | "bytes"}
            onChange={onBucketChange}
          />
        )}
      </div>
    </div>
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function SortHeader<K extends string>({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  field: K;
  sortKey: K;
  sortDir: SortDir;
  onSort: (field: K) => void;
  className?: string;
}) {
  const active = sortKey === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-0.5 hover:text-panel-text ${
        active ? "text-panel-text" : ""
      } ${className ?? ""}`}
    >
      <span>{label}</span>
      {active &&
        (sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        ))}
    </button>
  );
}

function FilterBox({
  value,
  onChange,
  placeholder,
  count,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  count: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1.5 h-3 w-3 text-panel-muted" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-56 rounded border border-panel-border bg-panel-bg py-1 pl-7 pr-2 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
        />
      </div>
      <span className="text-[11px] text-panel-muted">{count}</span>
    </div>
  );
}

function PercentBar({ pct }: { pct: number }) {
  return (
    <span className="ml-2 inline-flex w-16 items-center align-middle">
      <span className="h-1.5 w-full overflow-hidden rounded bg-panel-border">
        <span
          className="block h-full rounded bg-panel-accent/60"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </span>
    </span>
  );
}

// ── Protocol hierarchy ──────────────────────────────────────────────────────

function ProtocolTree({
  protocols,
  totalPackets,
}: {
  protocols: ProtocolHierarchy[];
  totalPackets: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (protocols.length === 0) {
    return <p className="text-xs text-panel-muted">No protocols detected</p>;
  }

  const totalBytes = protocols.reduce((s, p) => s + p.byte_count, 0);
  const pktBase = totalPackets || protocols.reduce((s, p) => s + p.packet_count, 0) || 1;

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const renderNode = (node: ProtocolHierarchy, depth: number) => {
    const pktPct = (node.packet_count / pktBase) * 100;
    return (
      <div key={`${node.name}-${depth}`}>
        <div
          className="flex items-center rounded px-2 py-1 text-xs hover:bg-panel-accent/5"
          style={{ paddingLeft: 8 + depth * 20, cursor: node.children.length > 0 ? "pointer" : "default" }}
          onClick={() => node.children.length > 0 && toggle(node.name)}
        >
          <span className="flex-1 font-medium text-panel-text">{node.name}</span>
          <span className="mr-6 flex w-44 items-center justify-end text-panel-muted">
            {node.packet_count} pkts
            <PercentBar pct={pktPct} />
            <span className="ml-1 w-10 text-right">{pktPct.toFixed(1)}%</span>
          </span>
          <span className="w-24 text-right text-panel-muted">
            {formatBytes(node.byte_count)}
          </span>
        </div>
        {expanded.has(node.name) &&
          node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-2 flex items-center border-b border-panel-border pb-1 text-[11px] text-panel-muted">
        <span className="flex-1">Protocol</span>
        <span className="mr-6 w-44 text-right">Packets (% of total)</span>
        <span className="w-24 text-right">Bytes</span>
      </div>
      {protocols.map((p) => renderNode(p, 0))}
      <div className="mt-1 flex items-center border-t border-panel-border pt-1 text-[11px] font-medium text-panel-text">
        <span className="flex-1">Total</span>
        <span className="mr-6 w-44 text-right">{pktBase} pkts</span>
        <span className="w-24 text-right">{formatBytes(totalBytes)}</span>
      </div>
    </div>
  );
}

// ── Endpoints ───────────────────────────────────────────────────────────────

type EndpointSortKey =
  | "address"
  | "packet_count"
  | "tx_packets"
  | "rx_packets"
  | "byte_count";

function EndpointsTable({
  endpoints,
  onSelect,
}: {
  endpoints: EndpointStats[];
  onSelect?: (ip: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<EndpointSortKey>("packet_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSort = (field: EndpointSortKey) => {
    if (field === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(field);
      setSortDir(field === "address" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? endpoints.filter((e) => e.address.toLowerCase().includes(q))
      : endpoints;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [endpoints, filter, sortKey, sortDir]);

  const totalPkts = rows.reduce((s, e) => s + e.packet_count, 0);
  const totalBytes = rows.reduce((s, e) => s + e.byte_count, 0);

  if (endpoints.length === 0) {
    return <p className="text-xs text-panel-muted">No endpoints</p>;
  }

  return (
    <div>
      <FilterBox
        value={filter}
        onChange={setFilter}
        placeholder="Filter endpoints"
        count={`${rows.length} of ${endpoints.length}`}
      />
      <div className="mb-2 flex items-center border-b border-panel-border pb-1 text-[11px] text-panel-muted">
        <SortHeader label="Address" field="address" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="flex-1" />
        <SortHeader label="Packets" field="packet_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-16 justify-end" />
        <SortHeader label="Tx" field="tx_packets" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-16 justify-end" />
        <SortHeader label="Rx" field="rx_packets" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-16 justify-end" />
        <SortHeader label="Bytes" field="byte_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-20 justify-end" />
      </div>
      {rows.map((ep) => (
        <div
          key={ep.address}
          onClick={() => onSelect?.(ep.address)}
          className={`flex items-center rounded px-2 py-1 text-xs ${
            onSelect ? "cursor-pointer hover:bg-panel-accent/5" : ""
          }`}
        >
          <span className="flex-1 text-panel-text">{ep.address}</span>
          <span className="w-16 text-right text-panel-muted">{ep.packet_count}</span>
          <span className="w-16 text-right text-panel-muted">{ep.tx_packets}</span>
          <span className="w-16 text-right text-panel-muted">{ep.rx_packets}</span>
          <span className="w-20 text-right text-panel-muted">{formatBytes(ep.byte_count)}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center border-t border-panel-border pt-1 text-[11px] font-medium text-panel-text">
        <span className="flex-1">Total ({rows.length})</span>
        <span className="w-16 text-right">{totalPkts}</span>
        <span className="w-16" />
        <span className="w-16" />
        <span className="w-20 text-right">{formatBytes(totalBytes)}</span>
      </div>
    </div>
  );
}

// ── Conversations ───────────────────────────────────────────────────────────

type ConvSortKey = "packet_count" | "byte_count" | "duration" | "avg";

function ConversationsTable({
  conversations,
  onSelect,
}: {
  conversations: ConversationStats[];
  onSelect?: (conv: ConversationStats) => void;
}) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<ConvSortKey>("packet_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const formatDur = (ts: number) => (ts * 1000).toFixed(0) + " ms";
  const duration = (c: ConversationStats) => c.end_ts - c.start_ts;
  const avgSize = (c: ConversationStats) =>
    c.packet_count > 0 ? c.byte_count / c.packet_count : 0;

  const onSort = (field: ConvSortKey) => {
    if (field === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(field);
      setSortDir("desc");
    }
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? conversations.filter((c) =>
          `${c.src_ip}:${c.src_port} ${c.dst_ip}:${c.dst_port} ${c.proto} ${c.app_protocol ?? ""}`
            .toLowerCase()
            .includes(q)
        )
      : conversations;
    const valueOf = (c: ConversationStats) =>
      sortKey === "duration"
        ? duration(c)
        : sortKey === "avg"
        ? avgSize(c)
        : c[sortKey];
    const sorted = [...filtered].sort((a, b) => {
      const cmp = (valueOf(a) as number) - (valueOf(b) as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [conversations, filter, sortKey, sortDir]);

  if (conversations.length === 0) {
    return <p className="text-xs text-panel-muted">No conversations</p>;
  }

  return (
    <div>
      <FilterBox
        value={filter}
        onChange={setFilter}
        placeholder="Filter conversations"
        count={`${rows.length} of ${conversations.length}`}
      />
      <div className="mb-2 flex items-center border-b border-panel-border pb-1 text-[11px] text-panel-muted">
        <span className="w-8">#</span>
        <span className="w-32">Source</span>
        <span className="w-32">Destination</span>
        <span className="w-12">Proto</span>
        <span className="w-16">App</span>
        <span className="w-20">Flags</span>
        <SortHeader label="Pkts" field="packet_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-14 justify-end" />
        <SortHeader label="Bytes" field="byte_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-14 justify-end" />
        <SortHeader label="Avg" field="avg" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-14 justify-end" />
        <SortHeader label="Dur" field="duration" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-16 justify-end" />
      </div>
      {rows.map((conv, i) => (
        <div
          key={conv.id}
          onClick={() => onSelect?.(conv)}
          className={`flex items-center rounded px-2 py-1 text-xs ${
            onSelect ? "cursor-pointer hover:bg-panel-accent/5" : ""
          }`}
        >
          <span className="w-8 text-panel-muted">{i + 1}</span>
          <span className="w-32 truncate text-panel-text">
            {conv.src_ip}:{conv.src_port}
          </span>
          <span className="w-32 truncate text-panel-text">
            {conv.dst_ip}:{conv.dst_port}
          </span>
          <span
            className={`w-12 font-medium ${
              conv.proto === "tcp" ? "text-panel-accent" : "text-purple-400"
            }`}
          >
            {conv.proto.toUpperCase()}
          </span>
          <span className="w-16 truncate text-panel-muted">
            {conv.app_protocol ?? "-"}
          </span>
          <span className="w-20 truncate text-panel-muted">
            {conv.flags_summary ?? "-"}
          </span>
          <span className="w-14 text-right text-panel-muted">{conv.packet_count}</span>
          <span className="w-14 text-right text-panel-muted">
            {formatBytes(conv.byte_count)}
          </span>
          <span className="w-14 text-right text-panel-muted">
            {formatBytes(avgSize(conv))}
          </span>
          <span className="w-16 text-right text-panel-muted">
            {formatDur(duration(conv))}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── IO graph ────────────────────────────────────────────────────────────────

const BUCKET_OPTIONS = [
  { value: 1, label: "1s" },
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
  { value: 60, label: "1min" },
];

function IOGraph({
  buckets,
  duration,
  bucketSeconds,
  metric,
  onChange,
}: {
  buckets: IOBucket[];
  duration: number;
  bucketSeconds: number;
  metric: "packets" | "bytes";
  onChange?: (bucketSeconds: number, metric: "packets" | "bytes") => void;
}) {
  const values = buckets.map((b) => (metric === "bytes" ? b.byte_count : b.packet_count));
  const maxVal = Math.max(...values, 1);
  const peak = values.length ? Math.max(...values) : 0;
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const unit = metric === "bytes" ? "B" : "pkts";

  const W = 720;
  const H = 160;
  const n = buckets.length;
  const gap = n > 0 ? Math.min(4, W / n / 4) : 0;
  const barW = n > 0 ? Math.max(1, W / n - gap) : 0;
  const avgY = H - (avg / maxVal) * H;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs">
        <p className="text-panel-muted">
          IO Graph ({buckets.length} buckets, {(duration * 1000).toFixed(0)} ms total)
          {n > 0 && (
            <span className="ml-2">
              · peak {peak} {unit} · avg {avg.toFixed(1)} {unit}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <select
            aria-label="Bucket size"
            value={bucketSeconds}
            onChange={(e) => onChange?.(Number(e.target.value), metric)}
            className="rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
          >
            {BUCKET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Metric"
            value={metric}
            onChange={(e) =>
              onChange?.(bucketSeconds, e.target.value as "packets" | "bytes")
            }
            className="rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
          >
            <option value="packets">Packets</option>
            <option value="bytes">Bytes</option>
          </select>
        </div>
      </div>

      {n === 0 ? (
        <p className="text-xs text-panel-muted">No IO data</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-44 w-full"
            role="img"
            aria-label="IO graph"
          >
            {buckets.map((b, i) => {
              const val = metric === "bytes" ? b.byte_count : b.packet_count;
              const h = Math.max((val / maxVal) * H, 1);
              const x = i * (barW + gap);
              const tEnd = b.ts_start + bucketSeconds;
              return (
                <rect
                  key={i}
                  x={x}
                  y={H - h}
                  width={barW}
                  height={h}
                  className="fill-panel-accent/50 hover:fill-panel-accent"
                >
                  <title>
                    {b.ts_start.toFixed(3)}s–{tEnd.toFixed(3)}s: {val} {unit}
                  </title>
                </rect>
              );
            })}
            {/* average reference line */}
            <line
              x1={0}
              x2={W}
              y1={avgY}
              y2={avgY}
              className="stroke-panel-warning/60"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          </svg>
          <div className="mt-1 flex justify-between">
            <span className="text-[10px] text-panel-muted">0s</span>
            <span className="text-[10px] text-panel-muted">
              {(duration * 1000).toFixed(0)}ms
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function formatBytes(b: number) {
  if (b < 1024) return `${b.toFixed(0)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
