import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { X, Loader2 } from "lucide-react";
import type { ConversationStats } from "../api/client";
import { getSessionPackets } from "../api/client";
import { SessionSequenceDiagram } from "./SessionSequenceDiagram";
import { SessionDataFlow } from "./SessionDataFlow";
import { FlagIcon } from "./stats/FlagIcon";

interface Props {
  captureId: string;
  conversation: ConversationStats;
  onClose: () => void;
}

type Tab = "sequence" | "dataflow";

export function SessionView({ captureId, conversation, onClose }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("sequence");
  const [offset, setOffset] = useState(0);
  const limit = tab === "sequence" ? 5000 : 200;

  const { data, isLoading, error } = useQuery({
    queryKey: [
      "session-packets",
      captureId,
      conversation.id,
      tab,
      offset,
      limit,
    ],
    queryFn: () =>
      getSessionPackets(captureId, {
        src_ip: conversation.src_ip,
        src_port: conversation.src_port,
        dst_ip: conversation.dst_ip,
        dst_port: conversation.dst_port,
        proto: conversation.proto,
        offset: tab === "sequence" ? 0 : offset,
        limit,
      }),
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "sequence", label: t("session.sequenceDiagram") },
    { id: "dataflow", label: t("session.dataFlow") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-label={t("session.title")}
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-[90vw] max-w-7xl flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-panel-border bg-panel-header px-4 py-2">
          <span className="flex items-center gap-1 font-mono text-xs text-panel-text">
            <FlagIcon countryCode={data?.src_geo.country_code} />
            {conversation.src_ip}:{conversation.src_port}
          </span>
          <span className="text-xs text-panel-muted">↔</span>
          <span className="flex items-center gap-1 font-mono text-xs text-panel-text">
            <FlagIcon countryCode={data?.dst_geo.country_code} />
            {conversation.dst_ip}:{conversation.dst_port}
          </span>
          <span className="rounded bg-panel-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-panel-accent">
            {conversation.app_protocol ?? conversation.proto.toUpperCase()}
          </span>
          <span className="text-[11px] text-panel-muted">
            {((conversation.end_ts - conversation.start_ts) * 1000).toFixed(0)}{" "}
            ms
          </span>

          {/* Tabs */}
          <div className="ml-auto flex overflow-hidden rounded border border-panel-border">
            {tabs.map((t_) => (
              <button
                key={t_.id}
                onClick={() => {
                  setTab(t_.id);
                  setOffset(0);
                }}
                className={`px-3 py-1 text-xs ${
                  tab === t_.id
                    ? "bg-panel-accent text-panel-header"
                    : "text-panel-muted hover:bg-panel-border"
                }`}
              >
                {t_.label}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="ml-2 rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-panel-accent" />
            </div>
          ) : error ? (
            <p className="p-4 text-panel-error">
              {t("followStream.failedToLoad")}
            </p>
          ) : !data ? null : tab === "sequence" ? (
            <SessionSequenceDiagram
              packets={data.items}
              srcIp={conversation.src_ip}
              srcPort={conversation.src_port}
              dstIp={conversation.dst_ip}
              dstPort={conversation.dst_port}
              srcGeo={data.src_geo}
              dstGeo={data.dst_geo}
              proto={conversation.proto}
              appProtocol={conversation.app_protocol}
            />
          ) : (
            <SessionDataFlow
              captureId={captureId}
              packets={data.items}
              total={data.total}
              srcIp={conversation.src_ip}
              dstIp={conversation.dst_ip}
              srcGeo={data.src_geo}
              dstGeo={data.dst_geo}
              offset={offset}
              limit={limit}
              onPageChange={setOffset}
            />
          )}
        </div>
      </div>
    </div>
  );
}
