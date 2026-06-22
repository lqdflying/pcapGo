import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Globe, Layers, Flag, BarChart3, ArrowLeftRight } from "lucide-react";
import type {
  StatisticsResponse,
  ConversationStats,
} from "../api/client";
import { IPStatsView } from "./stats/IPStatsView";
import { ProtocolStatsView } from "./stats/ProtocolStatsView";
import { CountryStatsView } from "./stats/CountryStatsView";
import { IOGraphView } from "./stats/IOGraphView";
import { ConversationsView } from "./stats/ConversationsView";

interface Props {
  stats: StatisticsResponse | null;
  loading: boolean;
  onSelectEndpoint?: (ip: string) => void;
  onSelectConversation?: (conv: ConversationStats) => void;
  onFollowConversation?: (conv: ConversationStats) => void;
  onViewSession?: (conv: ConversationStats) => void;
  onSelectProtocol?: (proto: string) => void;
  onBucketChange?: (bucketSeconds: number, metric: "packets" | "bytes") => void;
}

type StatsView = "ip" | "protocol" | "country" | "conversations" | "io";

const SIDEBAR_ITEMS: { id: StatsView; labelKey: string; Icon: typeof Globe }[] = [
  { id: "ip", labelKey: "stats.ipStats", Icon: Globe },
  { id: "protocol", labelKey: "stats.protocolStats", Icon: Layers },
  { id: "country", labelKey: "stats.countryStats", Icon: Flag },
  { id: "conversations", labelKey: "stats.conversations", Icon: ArrowLeftRight },
  { id: "io", labelKey: "stats.ioGraph", Icon: BarChart3 },
];

export function StatsTabs({
  stats,
  loading,
  onSelectEndpoint,
  onSelectProtocol,
  onFollowConversation,
  onViewSession,
  onBucketChange,
}: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<StatsView>("ip");

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="flex w-48 flex-shrink-0 flex-col border-r border-panel-border bg-panel-header/50">
        <div className="border-b border-panel-border px-3 py-2">
          <p className="text-xs font-medium text-panel-muted">
            {t("capture.statistics")}
          </p>
          {stats && (
            <p className="mt-0.5 text-[10px] text-panel-muted">
              {t("stats.packetsDuration", {
                packets: stats.packet_count,
                duration: (stats.duration * 1000).toFixed(1),
              })}
            </p>
          )}
        </div>
        <nav className="flex-1 overflow-auto py-1">
          {SIDEBAR_ITEMS.map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                view === id
                  ? "bg-panel-accent/15 text-panel-accent"
                  : "text-panel-muted hover:bg-panel-accent/5 hover:text-panel-text"
              }`}
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-panel-muted" />
          </div>
        ) : !stats ? (
          <p className="text-sm text-panel-muted">{t("stats.noStatistics")}</p>
        ) : view === "ip" ? (
          <IPStatsView
            entries={stats.ip_stats ?? []}
            onSelectIP={onSelectEndpoint}
          />
        ) : view === "protocol" ? (
          <ProtocolStatsView
            entries={stats.proto_stats ?? []}
            onSelectProtocol={onSelectProtocol}
          />
        ) : view === "country" ? (
          <CountryStatsView entries={stats.country_stats ?? []} />
        ) : view === "conversations" ? (
          <ConversationsView
            conversations={stats.conversations ?? []}
            onViewSession={onViewSession}
            onFollowConversation={onFollowConversation}
          />
        ) : (
          <IOGraphView
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
