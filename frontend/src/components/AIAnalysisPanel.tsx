import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  AlertCircle,
  Info,
  Play,
  Plus,
  Trash2,
  Send,
  Square,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import {
  listChatThreads,
  createChatThread,
  getChatThread,
  deleteChatThread,
  streamChatMessage,
  type AnalysisEvent,
  type ChatThread,
  type ChatMessage,
} from "../api/client";

interface Props {
  captureId: string;
}

export function AIAnalysisPanel({ captureId }: Props) {
  // ── Chat state ────────────────────────────────────────────────────────────
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // When we create a thread as part of sending, skip the one server fetch the
  // activeThreadId effect would otherwise run (it would clobber the local
  // optimistic messages with an empty list).
  const suppressLoadRef = useRef<string | null>(null);

  // ── Full-analysis (one-shot) state ──────────────────────────────────────────
  const [events, setEvents] = useState<AnalysisEvent[]>([]);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const t = await listChatThreads(captureId);
      setThreads(t);
      return t;
    } catch {
      return [];
    }
  }, [captureId]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    if (suppressLoadRef.current === activeThreadId) {
      suppressLoadRef.current = null;
      return;
    }
    getChatThread(captureId, activeThreadId)
      .then((d) => setMessages(d.messages))
      .catch(() => setMessages([]));
  }, [captureId, activeThreadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      abortRef.current?.abort();
    };
  }, [captureId]);

  const newThread = async () => {
    const t = await createChatThread(captureId);
    setThreads((prev) => [t, ...prev]);
    setActiveThreadId(t.id);
    setMessages([]);
  };

  const removeThread = async (id: string) => {
    await deleteChatThread(captureId, id);
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) {
      setActiveThreadId(null);
      setMessages([]);
    }
  };

  const send = async () => {
    const question = input.trim();
    if (!question || streaming) return;
    setChatError(null);

    let threadId = activeThreadId;
    if (!threadId) {
      try {
        const t = await createChatThread(captureId, question.slice(0, 60));
        setThreads((prev) => [t, ...prev]);
        suppressLoadRef.current = t.id;
        setActiveThreadId(t.id);
        threadId = t.id;
      } catch {
        setChatError("Could not start a chat.");
        return;
      }
    }

    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: question,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    setStreamingText("");

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      await streamChatMessage(captureId, threadId, question, {
        signal: controller.signal,
        onDelta: (text) => {
          acc += text;
          setStreamingText(acc);
        },
        onError: (m) => setChatError(m),
      });
    } catch {
      // Aborted or network error — keep whatever streamed so far.
    } finally {
      setMessages((prev) => [
        ...prev,
        {
          id: `local-a-${Date.now()}`,
          role: "assistant",
          content: acc,
          created_at: new Date().toISOString(),
        },
      ]);
      setStreamingText("");
      setStreaming(false);
      abortRef.current = null;
      loadThreads(); // refresh titles / counts
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  // ── Full analysis (existing per-conversation SSE flow) ──────────────────────
  const startAnalysis = useCallback(() => {
    setEvents([]);
    setAnalysisError(null);
    setAnalysisRunning(true);
    eventSourceRef.current?.close();

    const es = new EventSource(`/api/captures/${captureId}/ai`);
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      if (event.data === "[DONE]") {
        setAnalysisRunning(false);
        es.close();
        return;
      }
      try {
        setEvents((prev) => [...prev, JSON.parse(event.data) as AnalysisEvent]);
      } catch {
        // skip malformed events
      }
    };
    es.onerror = () => {
      setAnalysisError("Connection lost. Try again.");
      setAnalysisRunning(false);
      es.close();
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

  return (
    <div className="flex h-full">
      {/* Thread sidebar */}
      <div className="flex w-52 flex-col border-r border-panel-border bg-panel-header/40">
        <div className="flex items-center justify-between border-b border-panel-border px-3 py-2">
          <span className="text-xs font-medium text-panel-muted">Chats</span>
          <button
            onClick={newThread}
            aria-label="New chat"
            className="rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-1">
          {threads.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-panel-muted/60">No chats yet.</p>
          ) : (
            threads.map((t) => (
              <div
                key={t.id}
                onClick={() => setActiveThreadId(t.id)}
                className={`group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-xs ${
                  activeThreadId === t.id
                    ? "bg-panel-accent/15 text-panel-text"
                    : "text-panel-muted hover:bg-panel-border/50"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeThread(t.id);
                  }}
                  aria-label="Delete chat"
                  className="opacity-0 transition group-hover:opacity-100 hover:text-panel-error"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-panel-border p-2">
          <button
            onClick={startAnalysis}
            disabled={analysisRunning}
            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
              analysisRunning
                ? "bg-panel-border text-panel-muted"
                : "bg-panel-accent/20 text-panel-accent hover:bg-panel-accent/30"
            }`}
          >
            {analysisRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {analysisRunning ? "Analyzing..." : "Run full analysis"}
          </button>
          {analysisError && (
            <p className="mt-1 text-[11px] text-panel-error">{analysisError}</p>
          )}
        </div>
      </div>

      {/* Chat / results area */}
      <div className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-auto p-4">
          {/* Full-analysis results, if any */}
          {events.length > 0 && (
            <div className="mb-4 space-y-3">
              <p className="text-xs font-medium text-panel-muted">Full analysis</p>
              {events.map((event) => (
                <div
                  key={event.conversation_id}
                  className="rounded-xl border border-panel-border bg-panel-header/40"
                >
                  <div className="flex items-center gap-3 border-b border-panel-border px-4 py-2">
                    <span
                      className={`text-xs font-medium ${
                        event.proto === "tcp" ? "text-panel-accent" : "text-purple-400"
                      }`}
                    >
                      {event.proto.toUpperCase()}
                    </span>
                    <span className="text-xs text-panel-muted">
                      {event.src} → {event.dst}
                    </span>
                  </div>
                  <div className="px-4 py-3">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-panel-text">
                      {event.summary_markdown}
                    </p>
                  </div>
                  {event.issues.length > 0 && (
                    <div className="border-t border-panel-border px-4 py-2">
                      <div className="space-y-1.5">
                        {event.issues.map((issue, j) => (
                          <div
                            key={j}
                            className="flex items-start gap-2 rounded-lg border border-panel-border px-3 py-1.5 text-xs"
                          >
                            {severityIcon(issue.severity)}
                            <div>
                              <span className="font-medium capitalize">
                                {issue.type.replace(/_/g, " ")}
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
          )}

          {/* Chat messages */}
          {messages.length === 0 && !streaming && events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Sparkles className="mb-3 h-10 w-10 text-panel-muted/40" />
              <p className="max-w-sm text-sm text-panel-muted/60">
                Ask a question about this capture — e.g. "Why did this TCP
                connection reset?" or "Summarize the DNS traffic". You can also run
                a full per-conversation analysis from the sidebar.
              </p>
              <p className="mt-1 text-xs text-panel-muted/40">
                Requires an OpenAI-compatible LLM configured on the server.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      m.role === "user"
                        ? "bg-panel-accent/20 text-panel-text"
                        : "border border-panel-border bg-panel-header/40 text-panel-text"
                    }`}
                  >
                    {/* Rendered as plain text (whitespace preserved) so model
                        output can never inject HTML. */}
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
              {streaming && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-xl border border-panel-border bg-panel-header/40 px-3 py-2 text-xs leading-relaxed text-panel-text">
                    <p className="whitespace-pre-wrap">
                      {streamingText || <Loader2 className="h-3 w-3 animate-spin" />}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-panel-border p-3">
          {chatError && (
            <p className="mb-1 text-[11px] text-panel-error">{chatError}</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Ask about this capture…"
              aria-label="Ask a question"
              className="flex-1 resize-none rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
            />
            {streaming ? (
              <button
                onClick={stop}
                aria-label="Stop"
                className="inline-flex items-center gap-1 rounded-lg bg-panel-error/20 px-3 py-2 text-xs font-medium text-panel-error hover:bg-panel-error/30"
              >
                <Square className="h-3 w-3" /> Stop
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                aria-label="Send"
                className="inline-flex items-center gap-1 rounded-lg bg-panel-accent px-3 py-2 text-xs font-medium text-panel-header transition hover:bg-panel-accent/80 disabled:opacity-40"
              >
                <Send className="h-3 w-3" /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
