import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowLeft,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  Palette,
  Terminal,
  PanelRightOpen,
  PanelRightClose,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  getPackets,
  getPacketDetail,
  getStatistics,
  packetsExportUrl,
  streamExplainPackets,
  type Capture,
  type PacketSummary,
  type PacketDetail,
  type ConversationStats,
} from "../api/client";
import { api } from "../api/client";
import { useCaptureStore, useThemeStore, useAIDockStore, type Theme } from "../lib/store";
import { PacketList } from "../components/PacketList";
import { PacketTree } from "../components/PacketTree";
import { HexViewer } from "../components/HexViewer";
import { StatsTabs } from "../components/StatsTabs";
import { CaptureCommandPanel } from "../components/CaptureCommandPanel";
import { FloatingWindow } from "../components/FloatingWindow";
import { FollowStream } from "../components/FollowStream";

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];
const PROTOCOL_OPTIONS = [
  { value: "", label: "All" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
  { value: "icmp", label: "ICMP" },
  { value: "http", label: "HTTP" },
  { value: "tls", label: "TLS" },
  { value: "dns", label: "DNS" },
  { value: "ssh", label: "SSH" },
  { value: "smtp", label: "SMTP" },
  { value: "ftp", label: "FTP" },
  { value: "telnet", label: "Telnet" },
  { value: "pop3", label: "POP3" },
  { value: "imap", label: "IMAP" },
  { value: "imaps", label: "IMAPS" },
  { value: "pop3s", label: "POP3S" },
  { value: "radius", label: "RADIUS" },
  { value: "dhcp", label: "DHCP" },
  { value: "ntp", label: "NTP" },
  { value: "netbios", label: "NetBIOS" },
  { value: "snmp", label: "SNMP" },
  { value: "syslog", label: "Syslog" },
  { value: "ssdp", label: "SSDP" },
  { value: "mdns", label: "mDNS" },
  { value: "llmnr", label: "LLMNR" },
  { value: "redis", label: "Redis" },
  { value: "mysql", label: "MySQL" },
  { value: "postgresql", label: "PostgreSQL" },
];

export function CapturePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    selectedPacketIdx,
    selectedIndices,
    selectPacket,
    filterProto,
    setFilterProto,
  } = useCaptureStore();
  const { theme, setTheme } = useThemeStore();
  const {
    aiDockOpen,
    aiPoppedOut,
    aiFloat,
    setAiDockOpen,
    toggleAiPopOut,
    setAiFloat,
  } = useAIDockStore();
  const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices]);
  const [packetDetail, setPacketDetail] = useState<PacketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"packets" | "stats">("packets");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [highlight, setHighlight] = useState<{ offset: number; length: number } | null>(null);
  const [bucketSeconds, setBucketSeconds] = useState(1);
  const [ioMetric, setIoMetric] = useState<"packets" | "bytes">("packets");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [followConv, setFollowConv] = useState<ConversationStats | null>(null);
  const [explainText, setExplainText] = useState("");
  const [explainStreaming, setExplainStreaming] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const explainAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const captureQuery = useQuery<Capture>({
    queryKey: ["capture", id],
    queryFn: async () => {
      const { data } = await api.get(`/api/captures/${id}`);
      return data;
    },
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && d.status !== "ready" && d.status !== "failed" ? 2000 : false;
    },
  });

  const packetsQuery = useQuery({
    queryKey: ["packets", id, filterProto, appliedSearch, page, pageSize],
    queryFn: () =>
      getPackets(id!, page * pageSize, pageSize, filterProto, appliedSearch),
    enabled: captureQuery.data?.status === "ready",
  });

  const packets: PacketSummary[] = packetsQuery.data?.items ?? [];
  const totalPackets = packetsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalPackets / pageSize));

  const statsQuery = useQuery({
    queryKey: ["statistics", id, bucketSeconds, ioMetric],
    queryFn: () =>
      getStatistics(id!, { bucketSeconds, metric: ioMetric }),
    enabled: viewMode === "stats" && captureQuery.data?.status === "ready",
  });

  useEffect(() => {
    setPage(0);
  }, [filterProto, appliedSearch, pageSize]);

  useEffect(() => {
    if (selectedPacketIdx === null || !id) return;
    setDetailLoading(true);
    getPacketDetail(id, selectedPacketIdx)
      .then((d) => setPacketDetail(d))
      .catch(() => setPacketDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedPacketIdx, id]);

  const capture = captureQuery.data;

  const applySearch = (value: string) => {
    setSearch(value);
    setAppliedSearch(value);
  };

  const handleSelectEndpoint = (ip: string) => {
    applySearch(ip);
    setViewMode("packets");
  };

  const handleSelectConversation = (conv: ConversationStats) => {
    applySearch(conv.src_ip);
    setViewMode("packets");
  };

  const handleBucketChange = (bs: number, metric: "packets" | "bytes") => {
    setBucketSeconds(bs);
    setIoMetric(metric);
  };

  const explainSelected = useCallback(async () => {
    if (!selectedIndices.length || explainStreaming || !id) return;
    setExplainText("");
    setExplainError(null);
    setExplainStreaming(true);
    const controller = new AbortController();
    explainAbortRef.current = controller;
    let acc = "";
    let errorSet = false;
    try {
      await streamExplainPackets(id, selectedIndices, {
        signal: controller.signal,
        onDelta: (text) => {
          acc += text;
          setExplainText(acc);
        },
        onError: (msg) => {
          setExplainError(msg);
          errorSet = true;
          controller.abort();
        },
      });
    } catch {
      // aborted or network error — surface a message only if we got none from
      // the onError callback (e.g. a hard network failure).
      if (acc === "" && !errorSet) {
        setExplainError("Explanation request failed.");
      }
    } finally {
      setExplainStreaming(false);
      explainAbortRef.current = null;
    }
  }, [id, selectedIndices, explainStreaming]);

  const stopExplain = () => {
    explainAbortRef.current?.abort();
  };

  const dismissExplain = () => {
    setExplainText("");
    setExplainStreaming(false);
    setExplainError(null);
    explainAbortRef.current?.abort();
  };

  const captureCommandPanel = id ? (
    <CaptureCommandPanel captureId={id} />
  ) : null;

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      {/* Toolbar */}
      <header className="flex items-center gap-4 border-b border-panel-border bg-panel-header px-4 py-2">
        <button
          onClick={() => navigate("/")}
          className="rounded-lg p-1.5 text-panel-muted transition hover:bg-panel-border hover:text-panel-text"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <p className="text-sm font-medium text-panel-text">
            {capture?.filename ?? "Loading..."}
          </p>
          <p className="text-xs text-panel-muted">
            {capture
              ? `${capture.packet_count} packets · ${(capture.size_bytes / 1024).toFixed(0)} KB · ${capture.status}`
              : ""}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-panel-border overflow-hidden">
            {(["packets", "stats"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-xs font-medium transition ${
                  viewMode === mode
                    ? "bg-panel-accent text-panel-header"
                    : "text-panel-muted hover:bg-panel-border"
                }`}
              >
                {mode === "packets" ? "Packets" : "Statistics"}
              </button>
            ))}
          </div>

          {/* Capture Command dock toggle */}
          {viewMode === "packets" && (
            <>
              <button
                onClick={() => setAiDockOpen(!aiDockOpen)}
                title={aiDockOpen ? "Close AI Tools panel" : "Open AI Tools panel"}
                className={`rounded-lg p-1.5 transition ${
                  aiDockOpen
                    ? "bg-panel-accent/20 text-panel-accent"
                    : "text-panel-muted hover:bg-panel-border hover:text-panel-text"
                }`}
              >
                <Terminal className="h-4 w-4" />
              </button>
              {aiDockOpen && (
                <button
                  onClick={toggleAiPopOut}
                  title={aiPoppedOut ? "Dock panel" : "Pop out panel"}
                  className="rounded-lg p-1.5 text-panel-muted transition hover:bg-panel-border hover:text-panel-text"
                >
                  {aiPoppedOut ? (
                    <PanelRightClose className="h-4 w-4" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" />
                  )}
                </button>
              )}
            </>
          )}

          {/* Packet search, protocol filter, export */}
          {viewMode === "packets" && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-panel-muted" />
                <input
                  aria-label="Search packets"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search src/dst/info…"
                  className="w-52 rounded border border-panel-border bg-panel-bg py-1 pl-7 pr-2 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
                />
              </div>
              <select
                aria-label="Filter by protocol"
                value={filterProto}
                onChange={(e) => setFilterProto(e.target.value)}
                className="rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
              >
                {PROTOCOL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <a
                href={packetsExportUrl(id!, "csv", filterProto, appliedSearch)}
                download
                aria-label="Export packets as CSV"
                title="Export current view as CSV"
                className="inline-flex items-center gap-1 rounded border border-panel-border px-2 py-1 text-xs text-panel-text transition hover:bg-panel-border"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </a>
            </>
          )}
          <div className="flex items-center gap-1 rounded border border-panel-border px-1">
            <Palette className="h-3.5 w-3.5 text-panel-muted" />
            <select
              aria-label="Theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="bg-transparent py-1 pr-1 text-xs text-panel-text focus:outline-none"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="obsidian">Obsidian</option>
            </select>
          </div>
        </div>
      </header>

      {/* Main content */}
      {capture?.status !== "ready" ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-panel-accent" />
            <p className="mt-3 text-sm text-panel-muted">
              {capture?.status === "failed"
                ? "Parsing failed. Please re-upload."
                : "Parsing packet capture..."}
            </p>
          </div>
        </div>
      ) : (
        <>
          {viewMode === "packets" && (
            <PanelGroup direction="horizontal" autoSaveId="capture-main" className="flex-1">
              <Panel minSize={40} order={1} id="packets-main">
                <PanelGroup direction="vertical" autoSaveId="capture-vertical">
                  {/* Packet list */}
                  <Panel defaultSize={55} minSize={20}>
                    <div className="flex h-full flex-col">
                      <PacketList
                        packets={packets}
                        selectedIdx={selectedPacketIdx}
                        selectedSet={selectedSet}
                        onSelect={selectPacket}
                        loading={packetsQuery.isLoading}
                      />
                      {/* Selection actions: explain */}
                      {selectedIndices.length > 0 && (
                        <div className="flex items-center gap-2 border-t border-panel-border bg-panel-header/40 px-3 py-1.5">
                          <span className="text-[11px] text-panel-muted">
                            {selectedIndices.length} packet{selectedIndices.length > 1 ? "s" : ""} selected
                          </span>
                          {explainStreaming ? (
                            <button
                              onClick={stopExplain}
                              aria-label="Stop explain"
                              className="inline-flex items-center gap-1 rounded bg-panel-error/20 px-2 py-0.5 text-[11px] font-medium text-panel-error hover:bg-panel-error/30"
                            >
                              <Square className="h-3 w-3" /> Stop
                            </button>
                          ) : (
                            <button
                              onClick={explainSelected}
                              aria-label="Explain selected packets"
                              className="inline-flex items-center gap-1 rounded bg-panel-accent/20 px-2 py-0.5 text-[11px] font-medium text-panel-accent hover:bg-panel-accent/30"
                            >
                              <Sparkles className="h-3 w-3" /> Explain
                            </button>
                          )}
                        </div>
                      )}
                      {/* Explain result */}
                      {(explainText || explainStreaming || explainError) && (
                        <div className="border-t border-panel-border bg-panel-header/40 px-3 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-medium text-panel-muted">Packet Explanation</span>
                            <button
                              onClick={dismissExplain}
                              aria-label="Dismiss explanation"
                              className="rounded p-0.5 text-panel-muted hover:bg-panel-border hover:text-panel-text"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="max-h-40 overflow-auto rounded border border-panel-border bg-panel-bg px-3 py-2">
                            {explainError ? (
                              <p className="whitespace-pre-wrap text-xs leading-relaxed text-panel-error">
                                {explainError}
                              </p>
                            ) : explainText ? (
                              <p className="whitespace-pre-wrap text-xs leading-relaxed text-panel-text">
                                {explainText}
                              </p>
                            ) : (
                              <div className="flex items-center gap-2 text-xs text-panel-muted">
                                <Loader2 className="h-3 w-3 animate-spin" /> Generating explanation...
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Pagination controls */}
                      <div className="flex items-center justify-between border-t border-panel-border bg-panel-header px-3 py-1.5 text-xs">
                        <div className="flex items-center gap-2 text-panel-muted">
                          <span>Page {page + 1} of {totalPages}</span>
                          <span>·</span>
                          <span>{totalPackets.toLocaleString()} packets</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            aria-label="Packets per page"
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            className="rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
                          >
                            {PAGE_SIZE_OPTIONS.map((size) => (
                              <option key={size} value={size}>
                                {size} / page
                              </option>
                            ))}
                          </select>
                          <button
                            aria-label="Previous page"
                            disabled={page === 0 || packetsQuery.isLoading}
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            className="rounded border border-panel-border p-1 text-panel-text disabled:opacity-40 hover:bg-panel-border"
                          >
                            <ChevronLeft className="h-3 w-3" />
                          </button>
                          <button
                            aria-label="Next page"
                            disabled={page >= totalPages - 1 || packetsQuery.isLoading}
                            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                            className="rounded border border-panel-border p-1 text-panel-text disabled:opacity-40 hover:bg-panel-border"
                          >
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </Panel>
                  <PanelResizeHandle className="h-1 bg-panel-border transition hover:bg-panel-accent" />
                  {/* Detail panes */}
                  <Panel defaultSize={45} minSize={15}>
                    <PanelGroup direction="horizontal">
                      <Panel defaultSize={50} minSize={20}>
                        <PacketTree
                          detail={packetDetail}
                          loading={detailLoading}
                          onSelectLayer={setHighlight}
                        />
                      </Panel>
                      <PanelResizeHandle className="w-1 bg-panel-border transition hover:bg-panel-accent" />
                      <Panel defaultSize={50} minSize={20}>
                        <HexViewer
                          detail={packetDetail}
                          loading={detailLoading}
                          highlight={highlight}
                        />
                      </Panel>
                    </PanelGroup>
                  </Panel>
                </PanelGroup>
              </Panel>

              {/* Capture Command dock (right panel) */}
              {aiDockOpen && !aiPoppedOut && (
                <>
                  <PanelResizeHandle className="w-1 bg-panel-border transition hover:bg-panel-accent" />
                  <Panel defaultSize={30} minSize={20} order={2} id="ai-dock">
                    <div className="flex h-full flex-col border-l border-panel-border">
                      <div className="flex items-center justify-between border-b border-panel-border bg-panel-header px-3 py-1.5">
                        <span className="text-xs font-medium text-panel-muted">AI Tools</span>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        {captureCommandPanel}
                      </div>
                    </div>
                  </Panel>
                </>
              )}
            </PanelGroup>
          )}

          {viewMode === "stats" && (
            <div className="flex-1 overflow-auto">
              <StatsTabs
                stats={statsQuery.data ?? null}
                loading={statsQuery.isLoading}
                onSelectEndpoint={handleSelectEndpoint}
                onSelectConversation={handleSelectConversation}
                onFollowConversation={setFollowConv}
                onBucketChange={handleBucketChange}
              />
            </div>
          )}
        </>
      )}

      {/* Capture Command floating window */}
      {aiDockOpen && aiPoppedOut && viewMode === "packets" && (
        <FloatingWindow
          geom={aiFloat}
          onChange={setAiFloat}
          onDock={() => toggleAiPopOut()}
          onClose={() => setAiDockOpen(false)}
          title="AI Tools"
        >
          {captureCommandPanel}
        </FloatingWindow>
      )}

      {followConv && (
        <FollowStream
          captureId={id!}
          conversation={followConv}
          onClose={() => setFollowConv(null)}
        />
      )}
    </div>
  );
}
