import { useEffect, useState, useCallback, useRef } from "react";
import {
  Loader2,
  AlertTriangle,
  AlertCircle,
  Info,
  Shield,
  Play,
  RefreshCw,
} from "lucide-react";
import type { AnalysisEvent } from "../api/client";

interface Props {
  captureId: string;
}

export function AIAnalysisPanel({ captureId }: Props) {
  const [events, setEvents] = useState<AnalysisEvent[]>([]);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const startAnalysis = useCallback(() => {
    setEvents([]);
    setComplete(false);
    setError(null);
    setRunning(true);

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/captures/${captureId}/ai`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const raw = event.data;
      if (raw === "[DONE]") {
        setComplete(true);
        setRunning(false);
        es.close();
        return;
      }
      try {
        const parsed: AnalysisEvent = JSON.parse(raw);
        setEvents((prev) => [...prev, parsed]);
      } catch {
        // skip malformed events
      }
    };

    es.onerror = () => {
      setError("Connection lost. Try again.");
      setRunning(false);
      es.close();
    };
  }, [captureId]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [captureId]);

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "critical":
        return <AlertTriangle className="h-4 w-4 text-panel-error" />;
      case "high":
        return <AlertCircle className="h-4 w-4 text-panel-error/70" />;
      case "medium":
        return <AlertCircle className="h-4 w-4 text-panel-warning" />;
      default:
        return <Info className="h-4 w-4 text-panel-muted" />;
    }
  };

  const severityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-panel-error/20 text-panel-error border-panel-error/30";
      case "high": return "bg-panel-error/10 text-panel-error/80 border-panel-error/20";
      case "medium": return "bg-panel-warning/10 text-panel-warning/80 border-panel-warning/20";
      default: return "bg-panel-muted/10 text-panel-muted border-panel-border";
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-panel-border bg-panel-header px-4 py-2">
        <span className="text-xs font-medium text-panel-muted">AI Conversation Analysis</span>
        <button
          onClick={startAnalysis}
          disabled={running}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition ${
            running
              ? "bg-panel-border text-panel-muted cursor-not-allowed"
              : "bg-panel-accent text-panel-header hover:bg-panel-accent/80"
          }`}
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : complete ? (
            <RefreshCw className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {running ? "Analyzing..." : complete ? "Re-run" : "Start Analysis"}
        </button>
        {error && <span className="text-xs text-panel-error">{error}</span>}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!running && events.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Shield className="h-10 w-10 text-panel-muted/40 mb-3" />
            <p className="text-sm text-panel-muted/60">
              AI analysis will inspect each conversation and detect issues
              such as retransmissions, connection resets, handshake failures,
              and high latency.
            </p>
            <p className="mt-1 text-xs text-panel-muted/40">
              Requires an OpenAI-compatible LLM configured on the server.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {events.map((event) => (
            <div
              key={event.conversation_id}
              className="rounded-xl border border-panel-border bg-panel-header/40 overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-panel-border px-4 py-2">
                <span className={`text-xs font-medium ${
                  event.proto === "tcp" ? "text-panel-accent" : "text-purple-400"
                }`}>
                  {event.proto.toUpperCase()}
                </span>
                <span className="text-xs text-panel-muted">
                  {event.src} → {event.dst}
                </span>
              </div>

              {/* Summary */}
              <div className="px-4 py-3">
                {/* Render LLM output as plain text. React escapes it, which
                    prevents XSS from any payload the model emits. We are not
                    using dangerouslySetInnerHTML here. */}
                <p className="prose-invert whitespace-pre-wrap text-xs leading-relaxed text-panel-text">
                  {event.summary_markdown}
                </p>
              </div>

              {/* Issues */}
              {event.issues.length > 0 && (
                <div className="border-t border-panel-border px-4 py-2">
                  <p className="mb-2 text-[11px] font-medium text-panel-muted">
                    Detected Issues
                  </p>
                  <div className="space-y-1.5">
                    {event.issues.map((issue, j) => (
                      <div
                        key={j}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 text-xs ${severityColor(issue.severity)}`}
                      >
                        {severityIcon(issue.severity)}
                        <div>
                          <span className="font-medium capitalize">
                            {issue.type.replace(/_/g, " ")}
                          </span>
                          <span className="ml-1 text-[10px] opacity-60">
                            ({issue.severity})
                          </span>
                          <p className="mt-0.5 text-[11px] opacity-80">
                            {issue.explanation}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {running && events.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-panel-accent" />
          </div>
        )}
      </div>
    </div>
  );
}
