import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUser,
  listCaptures,
  uploadCapture,
  deleteCapture,
  logout,
  type Capture,
} from "../api/client";
import { useAuthStore } from "../lib/store";
import { Uploader } from "../components/Uploader";
import {
  FileText,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  LogOut,
  ChevronRight,
  Palette,
} from "lucide-react";
import { useThemeStore, type Theme } from "../lib/store";

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "obsidian", label: "Obsidian" },
];

export function DashboardPage() {
  const { user, setUser } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    getUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null));
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["captures"],
    queryFn: listCaptures,
    refetchInterval: (q) => {
      const captures = (q.state.data?.captures ?? []) as Capture[];
      const pending = captures.some(
        (c) => c.status === "uploaded" || c.status === "parsing"
      );
      return pending ? 3000 : false;
    },
  });

  const uploadMut = useMutation({
    mutationFn: uploadCapture,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["captures"] });
      setUploading(false);
    },
    onError: () => setUploading(false),
  });

  const deleteMut = useMutation({
    mutationFn: deleteCapture,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["captures"] }),
  });

  const handleUpload = useCallback((file: File) => {
    setUploading(true);
    uploadMut.mutate(file);
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    navigate("/login");
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "ready":
        return <CheckCircle className="h-4 w-4 text-panel-success" />;
      case "failed":
        return <AlertCircle className="h-4 w-4 text-panel-error" />;
      case "parsing":
        return <Loader2 className="h-4 w-4 animate-spin text-panel-warning" />;
      default:
        return <Clock className="h-4 w-4 text-panel-muted" />;
    }
  };

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-panel-border bg-panel-header px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-panel-text">pcapGo</h1>
          <p className="text-xs text-panel-muted">Packet Capture Inspector</p>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <div className="flex items-center gap-2 text-sm text-panel-muted">
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="h-6 w-6 rounded-full"
                />
              )}
              <span>{user.login}</span>
            </div>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-panel-border px-1">
            <Palette className="h-3.5 w-3.5 text-panel-muted" />
            <select
              aria-label="Theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="bg-transparent py-1 pr-1 text-xs text-panel-text focus:outline-none"
            >
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg p-2 text-panel-muted transition hover:bg-panel-border hover:text-panel-text"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Upload area */}
      <div className="border-b border-panel-border px-6 py-4">
        <Uploader onUpload={handleUpload} uploading={uploading} />
      </div>

      {/* Captures list */}
      <main className="flex-1 overflow-auto px-6 py-4">
        <h2 className="mb-4 text-sm font-medium text-panel-muted">
          Your Captures
        </h2>
        {isLoading ? (
          <p className="text-sm text-panel-muted">Loading...</p>
        ) : !data?.captures?.length ? (
          <p className="text-sm text-panel-muted">
            No captures yet. Upload a .pcap file above.
          </p>
        ) : (
          <div className="space-y-2">
            {data.captures.map((cap: Capture) => (
              <div
                key={cap.id}
                className="flex items-center justify-between rounded-lg border border-panel-border bg-panel-header/50 px-4 py-3 transition hover:border-panel-accent/30"
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-panel-muted" />
                  <div>
                    <p className="text-sm font-medium text-panel-text">
                      {cap.filename}
                    </p>
                    <p className="text-xs text-panel-muted">
                      {formatBytes(cap.size_bytes)} · {cap.packet_count} packets ·{" "}
                      {new Date(cap.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {statusIcon(cap.status)}
                  {cap.status === "ready" && (
                    <button
                      onClick={() => navigate(`/captures/${cap.id}`)}
                      className="rounded-lg px-4 py-1.5 text-sm font-medium text-panel-accent transition hover:bg-panel-accent/10"
                    >
                      Analyze <ChevronRight className="ml-1 inline h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${cap.filename}"? This cannot be undone.`
                        )
                      ) {
                        deleteMut.mutate(cap.id);
                      }
                    }}
                    className="rounded-lg p-1.5 text-panel-muted transition hover:bg-panel-error/10 hover:text-panel-error"
                    title="Delete"
                    aria-label="Delete capture"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
