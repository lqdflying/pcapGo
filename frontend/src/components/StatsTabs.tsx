import { useState } from "react";
import { Loader2 } from "lucide-react";
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
          <ProtocolTree protocols={stats.protocols} />
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

function ProtocolTree({ protocols }: { protocols: ProtocolHierarchy[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (protocols.length === 0) {
    return <p className="text-xs text-panel-muted">No protocols detected</p>;
  }

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const renderNode = (node: ProtocolHierarchy, depth: number) => (
    <div key={`${node.name}-${depth}`}>
      <div
        className="flex cursor-pointer items-center rounded px-2 py-1 text-xs hover:bg-panel-accent/5"
        style={{ paddingLeft: 8 + depth * 20 }}
        onClick={() => node.children.length > 0 && toggle(node.name)}
      >
        <span className="flex-1 font-medium text-panel-text">{node.name}</span>
        <span className="mr-6 w-24 text-right text-panel-muted">
          {node.packet_count} pkts
        </span>
        <span className="w-24 text-right text-panel-muted">
          {formatBytes(node.byte_count)}
        </span>
      </div>
      {expanded.has(node.name) &&
        node.children.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex items-center border-b border-panel-border pb-1 text-[11px] text-panel-muted">
        <span className="flex-1">Protocol</span>
        <span className="mr-6 w-24 text-right">Packets</span>
        <span className="w-24 text-right">Bytes</span>
      </div>
      {protocols.map((p) => renderNode(p, 0))}
    </div>
  );
}

function EndpointsTable({
  endpoints,
  onSelect,
}: {
  endpoints: EndpointStats[];
  onSelect?: (ip: string) => void;
}) {
  if (endpoints.length === 0) {
    return <p className="text-xs text-panel-muted">No endpoints</p>;
  }
  return (
    <div>
      <div className="mb-2 flex items-center border-b border-panel-border pb-1 text-[11px] text-panel-muted">
        <span className="flex-1">Address</span>
        <span className="w-16 text-right">Packets</span>
        <span className="w-16 text-right">Tx</span>
        <span className="w-16 text-right">Rx</span>
        <span className="w-20 text-right">Bytes</span>
      </div>
      {endpoints.map((ep) => (
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
    </div>
  );
}

function ConversationsTable({
  conversations,
  onSelect,
}: {
  conversations: ConversationStats[];
  onSelect?: (conv: ConversationStats) => void;
}) {
  const formatTs = (ts: number) => (ts * 1000).toFixed(0) + " ms";

  if (conversations.length === 0) {
    return <p className="text-xs text-panel-muted">No conversations</p>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center border-b border-panel-border pb-1 text-[11px] text-panel-muted">
        <span className="w-8">#</span>
        <span className="w-32">Source</span>
        <span className="w-32">Destination</span>
        <span className="w-12">Proto</span>
        <span className="w-16">App</span>
        <span className="w-20">Flags</span>
        <span className="w-14 text-right">Pkts</span>
        <span className="w-14 text-right">Bytes</span>
        <span className="w-14 text-right">Dur</span>
      </div>
      {conversations.map((conv, i) => (
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
            {formatTs(conv.end_ts - conv.start_ts)}
          </span>
        </div>
      ))}
    </div>
  );
}

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
  if (buckets.length === 0) {
    return <p className="text-xs text-panel-muted">No IO data</p>;
  }

  const values = buckets.map((b) => (metric === "bytes" ? b.byte_count : b.packet_count));
  const maxVal = Math.max(...values, 1);
  const unit = metric === "bytes" ? "B" : "pkts";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs">
        <p className="text-panel-muted">
          IO Graph ({buckets.length} buckets, {(duration * 1000).toFixed(0)} ms total)
        </p>
        <div className="flex items-center gap-2">
          <select
            aria-label="Bucket size"
            value={bucketSeconds}
            onChange={(e) =>
              onChange?.(Number(e.target.value), metric)
            }
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
      <div className="flex h-40 items-end gap-1">
        {buckets.map((b, i) => {
          const val = metric === "bytes" ? b.byte_count : b.packet_count;
          return (
            <div
              key={i}
              className="flex flex-1 flex-col items-center"
              title={`${val} ${unit}`}
            >
              <span className="mb-1 text-[10px] text-panel-muted">{val}</span>
              <div
                className="w-full rounded-t bg-panel-accent/40"
                style={{ height: `${Math.max((val / maxVal) * 100, 2)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between">
        <span className="text-[10px] text-panel-muted">0s</span>
        <span className="text-[10px] text-panel-muted">
          {(duration * 1000).toFixed(0)}ms
        </span>
      </div>
    </div>
  );
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
