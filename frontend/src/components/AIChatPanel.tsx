import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Loader2, Plus, Send, Square } from "lucide-react";
import {
  createChatThread,
  getChatThread,
  listChatThreads,
  batchDeleteChatThreads,
  streamChatMessage,
  type ChatMessage,
  type ChatThread,
} from "../api/client";
import { useCaptureStore } from "../lib/store";
import { ChatSessionSidebar } from "./ChatSessionSidebar";

interface Props {
  captureId: string;
}

export function AIChatPanel({ captureId }: Props) {
  const { t } = useTranslation();
  const { selectedIndices } = useCaptureStore();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, []);

  useEffect(scrollToBottom, [messages, streamingText, scrollToBottom]);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const list = await listChatThreads(captureId);
      setThreads(list);
    } catch {
      /* ignore */
    } finally {
      setThreadsLoading(false);
    }
  }, [captureId]);

  useEffect(() => {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setThreadId(null);
    setMessages([]);
    setInput("");
    setStreaming(false);
    setStreamingText("");
    setError(null);
    loadThreads();
  }, [captureId, loadThreads]);

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  const selectThread = useCallback(
    async (tid: string) => {
      try {
        const detail = await getChatThread(captureId, tid);
        setThreadId(detail.id);
        setMessages(detail.messages);
        setStreamingText("");
        setError(null);
      } catch {
        setError(t("chat.chatFailed"));
      }
    },
    [captureId, t]
  );

  const newChat = useCallback(() => {
    setThreadId(null);
    setMessages([]);
    setStreamingText("");
    setError(null);
  }, []);

  const handleBatchDelete = useCallback(
    async (ids: string[]) => {
      try {
        await batchDeleteChatThreads(captureId, ids);
        if (threadId && ids.includes(threadId)) {
          newChat();
        }
        loadThreads();
      } catch {
        setError(t("chat.deleteFailed"));
      }
    },
    [captureId, threadId, newChat, loadThreads, t]
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError(null);
    setStreaming(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const controller = new AbortController();
    abortRef.current = controller;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    let acc = "";
    let errorSet = false;

    try {
      let tid = threadId;
      if (!tid) {
        const thread = await createChatThread(captureId);
        tid = thread.id;
        setThreadId(tid);
        setThreads((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== thread.id);
          return [thread, ...withoutDuplicate];
        });
      }

      setStreamingText("");
      await streamChatMessage(captureId, tid, text, {
        signal: controller.signal,
        packetIndices: selectedIndices.length > 0 ? selectedIndices : undefined,
        onDelta: (delta) => {
          if (requestSeq !== requestSeqRef.current) return;
          acc += delta;
          setStreamingText(acc);
        },
        onError: (msg) => {
          if (requestSeq !== requestSeqRef.current) return;
          setError(msg);
          errorSet = true;
          controller.abort();
        },
      });
    } catch {
      if (requestSeq === requestSeqRef.current && acc === "" && !errorSet) {
        setError(t("chat.chatFailed"));
      }
    } finally {
      if (requestSeq !== requestSeqRef.current) return;
      setStreaming(false);
      abortRef.current = null;
      if (acc) {
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: acc,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText("");
      } else {
        setStreamingText("");
      }
      loadThreads();
    }
  }, [input, streaming, threadId, captureId, selectedIndices, loadThreads, t]);

  const stop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex h-full">
      {/* Session sidebar */}
      {sidebarOpen && (
        <ChatSessionSidebar
          captureId={captureId}
          activeThreadId={threadId}
          onSelectThread={selectThread}
          onNewChat={newChat}
          threads={threads}
          loading={threadsLoading}
          onBatchDelete={handleBatchDelete}
        />
      )}

      {/* Chat area */}
      <div className="flex h-full flex-1 flex-col min-w-0">
        {/* Messages area */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-xs text-panel-muted">
                {selectedIndices.length > 0
                  ? t("chat.askAboutSelected", { count: selectedIndices.length })
                  : t("chat.askAboutCapture")}
              </p>
              <p className="mt-1 text-[11px] text-panel-muted/60">
                e.g. &quot;{t("chat.exampleProtocols")}&quot; or &quot;
                {t("chat.exampleSuspicious")}&quot;
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-panel-accent/20 text-panel-text"
                    : "bg-panel-border/50 text-panel-text"
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              </div>
            </div>
          ))}

          {streaming && streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg bg-panel-border/50 px-3 py-2 text-xs leading-relaxed text-panel-text">
                <pre className="whitespace-pre-wrap font-sans">{streamingText}</pre>
              </div>
            </div>
          )}

          {streaming && !streamingText && (
            <div className="flex items-center gap-2 text-xs text-panel-muted">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("chat.thinking")}
            </div>
          )}

          {error && <p className="text-[11px] text-panel-error">{error}</p>}
        </div>

        {/* Selected packets indicator */}
        {selectedIndices.length > 0 && (
          <div className="border-t border-panel-border bg-panel-accent/5 px-3 py-1">
            <span className="text-[11px] text-panel-accent">
              {t("chat.selectedAsContext", { count: selectedIndices.length })}
            </span>
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-panel-border p-3">
          <div className="flex gap-2">
            <textarea
              aria-label="Ask about packets"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={2}
              placeholder={t("chat.askPlaceholder")}
              className="flex-1 resize-none rounded border border-panel-border bg-panel-bg px-2 py-1.5 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
            />
            <div className="flex flex-col gap-1">
              {streaming ? (
                <button
                  onClick={stop}
                  aria-label={t("common.stop")}
                  className="rounded-lg bg-panel-error/20 p-1.5 text-panel-error hover:bg-panel-error/30"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  aria-label={t("common.send")}
                  className="rounded-lg bg-panel-accent p-1.5 text-panel-header transition hover:bg-panel-accent/80 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label={t("chat.sessionHistory")}
                title={t("chat.sessionHistory")}
                className={`rounded-lg p-1.5 transition ${
                  sidebarOpen
                    ? "bg-panel-accent/20 text-panel-accent"
                    : "text-panel-muted hover:bg-panel-border hover:text-panel-text"
                }`}
              >
                <History className="h-3.5 w-3.5" />
              </button>
              {messages.length > 0 && !streaming && (
                <button
                  onClick={newChat}
                  aria-label={t("chat.newChat")}
                  title={t("chat.newChat")}
                  className="rounded-lg p-1.5 text-panel-muted hover:bg-panel-border hover:text-panel-text"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
