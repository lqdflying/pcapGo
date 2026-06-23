import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { X, Loader2, Minus, Plus, RotateCcw, ListFilter } from "lucide-react";
import type { ConversationStats } from "../api/client";
import { getSessionPackets } from "../api/client";
import { SessionSequenceDiagram } from "./SessionSequenceDiagram";
import { SessionDataFlow } from "./SessionDataFlow";
import { FlagIcon } from "./stats/FlagIcon";

interface Props {
  captureId: string;
  conversation: ConversationStats;
  onClose: () => void;
  onJumpToPackets?: (conv: ConversationStats) => void;
}

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Tab = "sequence" | "dataflow";

const MIN_W = 560;
const MIN_H = 360;
const SIZE_STEP = 0.12;

function defaultGeom(): Geom {
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  const w = Math.max(MIN_W, Math.round(vw * 0.9));
  const h = Math.max(MIN_H, Math.round(vh * 0.85));
  return {
    x: Math.max(0, Math.round((vw - w) / 2)),
    y: Math.max(0, Math.round((vh - h) / 2)),
    w,
    h,
  };
}

function clampGeom(geom: Geom): Geom {
  const vw = window.innerWidth || geom.w;
  const vh = window.innerHeight || geom.h;
  const w = Math.max(MIN_W, Math.min(geom.w, vw));
  const h = Math.max(MIN_H, Math.min(geom.h, vh));
  return {
    x: Math.max(0, Math.min(vw - Math.min(100, w), geom.x)),
    y: Math.max(0, Math.min(vh - Math.min(40, h), geom.y)),
    w,
    h,
  };
}

export function SessionView({ captureId, conversation, onClose, onJumpToPackets }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("sequence");
  const [offset, setOffset] = useState(0);
  const [geom, setGeom] = useState(defaultGeom);
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

  const onDragStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const start = {
        clientX: event.clientX,
        clientY: event.clientY,
        x: geom.x,
        y: geom.y,
      };
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - start.clientX;
        const dy = moveEvent.clientY - start.clientY;
        setGeom((current) => clampGeom({ ...current, x: start.x + dx, y: start.y + dy }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [geom.x, geom.y]
  );

  const onResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const start = {
        clientX: event.clientX,
        clientY: event.clientY,
        w: geom.w,
        h: geom.h,
      };
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const dw = moveEvent.clientX - start.clientX;
        const dh = moveEvent.clientY - start.clientY;
        setGeom((current) => clampGeom({ ...current, w: start.w + dw, h: start.h + dh }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [geom.w, geom.h]
  );

  const scaleWindow = useCallback((delta: number) => {
    setGeom((current) => {
      const nextW = current.w * (1 + delta);
      const nextH = current.h * (1 + delta);
      return clampGeom({
        x: current.x - (nextW - current.w) / 2,
        y: current.y - (nextH - current.h) / 2,
        w: nextW,
        h: nextH,
      });
    });
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "sequence", label: t("session.sequenceDiagram") },
    { id: "dataflow", label: t("session.dataFlow") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60"
      role="dialog"
      aria-label={t("session.title")}
      onClick={onClose}
    >
      <div
        className="fixed flex flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg shadow-2xl"
        style={{ left: geom.x, top: geom.y, width: geom.w, height: geom.h }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex cursor-grab items-center gap-3 border-b border-panel-border bg-panel-header px-4 py-2 active:cursor-grabbing"
          onPointerDown={onDragStart}
        >
          <span className="flex items-center gap-1 font-mono text-xs text-panel-text">
            <FlagIcon
              countryCode={data?.src_geo.country_code}
              fallback={data?.src_geo.country_flag}
            />
            {conversation.src_ip}:{conversation.src_port}
          </span>
          <span className="text-xs text-panel-muted">↔</span>
          <span className="flex items-center gap-1 font-mono text-xs text-panel-text">
            <FlagIcon
              countryCode={data?.dst_geo.country_code}
              fallback={data?.dst_geo.country_flag}
            />
            {conversation.dst_ip}:{conversation.dst_port}
          </span>
          <span className="rounded bg-panel-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-panel-accent">
            {conversation.app_protocol ?? conversation.proto.toUpperCase()}
          </span>
          <span className="text-[11px] text-panel-muted">
            {((conversation.end_ts - conversation.start_ts) * 1000).toFixed(0)}{" "}
            ms
          </span>

          {onJumpToPackets && (
            <button
              onClick={() => onJumpToPackets(conversation)}
              title={t("session.jumpToPackets")}
              className="flex items-center gap-1 rounded border border-panel-accent/30 bg-panel-accent/10 px-2 py-0.5 text-[10px] font-medium text-panel-accent hover:bg-panel-accent/20"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ListFilter className="h-3 w-3" />
              {t("session.jumpToPackets")}
            </button>
          )}

          <div
            className="ml-auto flex overflow-hidden rounded border border-panel-border"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {tabs.map((tabOption) => (
              <button
                key={tabOption.id}
                onClick={() => {
                  setTab(tabOption.id);
                  setOffset(0);
                }}
                className={`px-3 py-1 text-xs ${
                  tab === tabOption.id
                    ? "bg-panel-accent text-panel-header"
                    : "text-panel-muted hover:bg-panel-border"
                }`}
              >
                {tabOption.label}
              </button>
            ))}
          </div>

          <div
            className="flex items-center gap-1"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => scaleWindow(-SIZE_STEP)}
              aria-label={t("session.zoomOut")}
              title={t("session.zoomOut")}
              className="rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              onClick={() => scaleWindow(SIZE_STEP)}
              aria-label={t("session.zoomIn")}
              title={t("session.zoomIn")}
              className="rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={() => setGeom(defaultGeom())}
              aria-label={t("session.resetWindow")}
              title={t("session.resetWindow")}
              className="rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

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

        <div
          className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize text-panel-muted/50 hover:text-panel-accent"
          onPointerDown={onResizeStart}
          aria-label={t("session.resizeWindow")}
          role="separator"
        >
          <svg className="h-full w-full" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="8" cy="12" r="1.5" />
            <circle cx="12" cy="8" r="1.5" />
          </svg>
        </div>
      </div>
    </div>
  );
}
