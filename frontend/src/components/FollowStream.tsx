import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { X, Loader2 } from "lucide-react";
import { getFollowStream, type ConversationStats } from "../api/client";

interface Props {
  captureId: string;
  conversation: ConversationStats;
  onClose: () => void;
}

type ViewMode = "ascii" | "hex";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toAscii(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
  return s;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
    s += (i + 1) % 16 === 0 ? "\n" : " ";
  }
  return s;
}

export function FollowStream({ captureId, conversation, onClose }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ViewMode>("ascii");

  const { data, isLoading, error } = useQuery({
    queryKey: ["follow", captureId, conversation.id],
    queryFn: () =>
      getFollowStream(captureId, {
        src_ip: conversation.src_ip,
        src_port: conversation.src_port,
        dst_ip: conversation.dst_ip,
        dst_port: conversation.dst_port,
        proto: conversation.proto,
      }),
  });

  const rendered = useMemo(() => {
    if (!data) return [];
    return data.segments.map((seg, i) => {
      const bytes = b64ToBytes(seg.data_b64);
      return {
        key: i,
        direction: seg.direction,
        text: mode === "ascii" ? toAscii(bytes) : toHex(bytes),
      };
    });
  }, [data, mode]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-label={t("followStream.title")}
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-[80vw] max-w-4xl flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-panel-border bg-panel-header px-4 py-2">
          <span className="text-sm font-medium text-panel-text">{t("followStream.title")}</span>
          <span className="text-xs text-panel-muted">
            {conversation.proto.toUpperCase()} · {conversation.src_ip}:
            {conversation.src_port} ↔ {conversation.dst_ip}:{conversation.dst_port}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex overflow-hidden rounded border border-panel-border">
              {(["ascii", "hex"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-2 py-1 text-xs ${
                    mode === m
                      ? "bg-panel-accent text-panel-header"
                      : "text-panel-muted hover:bg-panel-border"
                  }`}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-panel-accent" />
            </div>
          ) : error ? (
            <p className="text-panel-error">{t("followStream.failedToLoad")}</p>
          ) : !data || data.segments.length === 0 ? (
            <p className="text-panel-muted">{t("followStream.noPayload")}</p>
          ) : (
            <>
              {rendered.map((seg) => (
                <pre
                  key={seg.key}
                  className={`mb-1 whitespace-pre-wrap break-all ${
                    seg.direction === "client"
                      ? "text-panel-accent"
                      : "text-panel-success"
                  }`}
                >
                  {seg.text}
                </pre>
              ))}
              {data.truncated && (
                <p className="mt-2 text-[11px] text-panel-warning">
                  {t("followStream.truncated")}
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-panel-border bg-panel-header px-4 py-1.5 text-[11px] text-panel-muted">
          <span className="text-panel-accent">■</span> {t("followStream.client")} ·{" "}
          <span className="text-panel-success">■</span> {t("followStream.server")}
          {data && (
            <span className="ml-3">
              {t("followStream.bytesSent", { bytes: data.client_bytes })} · {t("followStream.bytesReceived", { bytes: data.server_bytes })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
