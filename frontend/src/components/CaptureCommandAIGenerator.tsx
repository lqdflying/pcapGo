import { useCallback, useRef, useState } from "react";
import { Loader2, Send, Square } from "lucide-react";
import { streamCaptureCommandGenerate } from "../api/client";
import type { Platform } from "../lib/captureCommandBuilder";
import { useTranslation } from "react-i18next";

interface Props {
  captureId?: string;
  onCommandChange: (cmd: string) => void;
}

function extractCommand(text: string): string {
  const fenced = text.match(/```[\w]*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("tcpdump ") || trimmed.startsWith("pktmon ")) {
      return trimmed;
    }
  }
  return "";
}

export function CaptureCommandAIGenerator({ captureId, onCommandChange }: Props) {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<Platform>("tcpdump");
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [useContext, setUseContext] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const generate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || streaming) return;
    setError(null);
    setResult("");
    setStreaming(true);
    // Clear any stale command so the preview/copy button doesn't show a value
    // from a previous generation (or from the Builder mode) while this request
    // is in flight or if it ultimately yields no extractable command.
    onCommandChange("");

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    try {
      await streamCaptureCommandGenerate(text, {
        signal: controller.signal,
        platform,
        captureId: useContext && captureId ? captureId : undefined,
        onDelta: (delta) => {
          acc += delta;
          setResult(acc);
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
        },
        onError: (msg) => setError(msg),
      });
    } catch {
      // aborted or network error
    } finally {
      setStreaming(false);
      abortRef.current = null;
      if (acc) {
        const cmd = extractCommand(acc);
        if (cmd) onCommandChange(cmd);
      }
    }
  }, [prompt, streaming, platform, captureId, useContext, onCommandChange]);

  const stop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 p-3">
        {/* Platform selector */}
        <div>
          <label className="text-[11px] font-medium text-panel-muted">
            {t("captureCommand.platform")}
          </label>
          <select
            aria-label="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="w-full rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
          >
            <option value="tcpdump">{t("captureCommand.tcpdumpPlatform")}</option>
            <option value="pktmon">{t("captureCommand.pktmonPlatform")}</option>
          </select>
        </div>

        {/* Capture context toggle */}
        {captureId && (
          <label className="flex items-center gap-1.5 text-[11px] text-panel-muted cursor-pointer">
            <input
              type="checkbox"
              checked={useContext}
              onChange={(e) => setUseContext(e.target.checked)}
              className="rounded border-panel-border accent-[rgb(var(--panel-accent))]"
            />
            {t("captureCommand.useCaptureContext")}
          </label>
        )}

        {/* Prompt */}
        <div>
          <label className="text-[11px] font-medium text-panel-muted">
            {t("captureCommand.describeCapture")}
          </label>
          <textarea
            aria-label="Describe capture"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                generate();
              }
            }}
            rows={3}
            placeholder={
              platform === "tcpdump"
                ? t("captureCommand.tcpdumpPlaceholder")
                : t("captureCommand.pktmonPlaceholder")
            }
            className="w-full resize-none rounded border border-panel-border bg-panel-bg px-2 py-1.5 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
          />
        </div>

        {/* Generate / Stop */}
        <div className="flex gap-2">
          {streaming ? (
            <button
              onClick={stop}
              aria-label="Stop"
              className="inline-flex items-center gap-1 rounded-lg bg-panel-error/20 px-3 py-1.5 text-xs font-medium text-panel-error hover:bg-panel-error/30"
            >
              <Square className="h-3 w-3" /> {t("common.stop")}
            </button>
          ) : (
            <button
              onClick={generate}
              disabled={!prompt.trim()}
              aria-label="Generate"
              className="inline-flex items-center gap-1 rounded-lg bg-panel-accent px-3 py-1.5 text-xs font-medium text-panel-header transition hover:bg-panel-accent/80 disabled:opacity-40"
            >
              <Send className="h-3 w-3" /> {t("common.generate")}
            </button>
          )}
        </div>

        {error && (
          <p className="text-[11px] text-panel-error">{error}</p>
        )}
      </div>

      {/* Result area */}
      {(result || streaming) && (
        <div ref={scrollRef} className="flex-1 overflow-auto border-t border-panel-border p-3">
          {result ? (
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-panel-text font-mono">
              {result}
            </pre>
          ) : (
            <div className="flex items-center gap-2 text-xs text-panel-muted">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("common.generating")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
