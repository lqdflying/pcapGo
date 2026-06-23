import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, CheckSquare, Square, Trash2, MessageSquare } from "lucide-react";
import type { ChatThread } from "../api/client";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

interface Props {
  captureId: string;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  threads: ChatThread[];
  loading: boolean;
  onBatchDelete: (threadIds: string[]) => void;
}

export function ChatSessionSidebar({
  activeThreadId,
  onSelectThread,
  onNewChat,
  threads,
  loading,
  onBatchDelete,
}: Props) {
  const { t } = useTranslation();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const handleBatchDelete = () => {
    if (selected.size === 0) return;
    const msg = t("chat.deleteSelectedConfirm", { count: selected.size });
    if (!window.confirm(msg)) return;
    onBatchDelete(Array.from(selected));
    exitSelectMode();
  };

  return (
    <div className="flex h-full w-48 flex-col border-r border-panel-border bg-panel-header/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-panel-border px-2 py-1.5">
        <span className="text-[11px] font-medium text-panel-muted">
          {t("chat.sessions")}
        </span>
        <div className="flex items-center gap-0.5">
          {selectMode ? (
            <button
              onClick={exitSelectMode}
              className="rounded px-1.5 py-0.5 text-[10px] text-panel-muted hover:bg-panel-border hover:text-panel-text"
            >
              {t("chat.cancelSelection")}
            </button>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              title={t("chat.selectSessions")}
              className="rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
            >
              <CheckSquare className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={onNewChat}
            title={t("chat.newChat")}
            className="rounded p-1 text-panel-accent hover:bg-panel-accent/20"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <p className="px-2 py-4 text-center text-[11px] text-panel-muted">...</p>
        )}
        {!loading && threads.length === 0 && (
          <p className="px-2 py-4 text-center text-[11px] text-panel-muted">
            {t("chat.noSessions")}
          </p>
        )}
        {threads.map((thread) => {
          const isActive = thread.id === activeThreadId;
          const isSelected = selected.has(thread.id);
          return (
            <button
              key={thread.id}
              onClick={() =>
                selectMode ? toggleSelect(thread.id) : onSelectThread(thread.id)
              }
              className={`flex w-full items-start gap-1.5 border-b border-panel-border/50 px-2 py-1.5 text-left transition ${
                isActive
                  ? "bg-panel-accent/15 text-panel-text"
                  : "text-panel-muted hover:bg-panel-border/40 hover:text-panel-text"
              }`}
            >
              {selectMode && (
                <span className="mt-0.5 flex-shrink-0">
                  {isSelected ? (
                    <CheckSquare className="h-3 w-3 text-panel-accent" />
                  ) : (
                    <Square className="h-3 w-3" />
                  )}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium leading-tight">
                  {thread.title}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-panel-muted">
                  <span className="flex items-center gap-0.5">
                    <MessageSquare className="h-2.5 w-2.5" />
                    {thread.message_count}
                  </span>
                  <span>{relativeTime(thread.updated_at)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Batch delete bar */}
      {selectMode && selected.size > 0 && (
        <div className="border-t border-panel-border p-1.5">
          <button
            onClick={handleBatchDelete}
            className="flex w-full items-center justify-center gap-1 rounded bg-panel-error/20 px-2 py-1 text-[11px] font-medium text-panel-error hover:bg-panel-error/30"
          >
            <Trash2 className="h-3 w-3" />
            {t("chat.deleteSelected", { count: selected.size })}
          </button>
        </div>
      )}
    </div>
  );
}
