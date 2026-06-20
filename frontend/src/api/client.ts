import axios from "axios";

export const api = axios.create({
  baseURL: "/",
  withCredentials: true,
});

// Hard-redirect to /login on 401 — but skip when already there to avoid an
// infinite reload loop. Pass the current relative path as ?next= so the
// deep link survives the GitHub OAuth round trip.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      !window.location.pathname.startsWith("/login")
    ) {
      const currentPath = window.location.pathname + window.location.search;
      // Defer the redirect so callers can react to the rejection first.
      setTimeout(() => {
        window.location.href = `/login?next=${encodeURIComponent(currentPath)}`;
      }, 0);
    }
    return Promise.reject(error);
  }
);

export interface User {
  id: string;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

export interface Capture {
  id: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  linktype: number;
  packet_count: number;
  status: string;
  created_at: string;
}

export interface PacketSummary {
  idx: number;
  ts: number;
  src: string;
  dst: string;
  proto: string;
  length: number;
  info: string;
}

export interface LayerNode {
  name: string;
  summary: string;
  offset: number;
  length: number;
  children: LayerNode[];
}

export interface PacketDetail {
  idx: number;
  ts: number;
  src: string;
  dst: string;
  proto: string;
  length: number;
  info: string;
  layers: LayerNode[];
  raw_hex: string;
  raw_offset: number;
}

export interface ConversationStats {
  id: string;
  proto: string;
  src_ip: string;
  src_port: number;
  dst_ip: string;
  dst_port: number;
  packet_count: number;
  byte_count: number;
  start_ts: number;
  end_ts: number;
  app_protocol: string | null;
  flags_summary: string | null;
}

export interface EndpointStats {
  address: string;
  packet_count: number;
  byte_count: number;
  tx_packets: number;
  rx_packets: number;
  tx_bytes: number;
  rx_bytes: number;
}

export interface ProtocolHierarchy {
  name: string;
  packet_count: number;
  byte_count: number;
  children: ProtocolHierarchy[];
}

export interface IOBucket {
  ts_start: number;
  packet_count: number;
  byte_count: number;
}

export interface StatisticsResponse {
  capture_id: string;
  packet_count: number;
  duration: number;
  protocols: ProtocolHierarchy[];
  endpoints: EndpointStats[];
  conversations: ConversationStats[];
  io_buckets: IOBucket[];
  bucket_seconds: number;
  metric: "packets" | "bytes";
}

export interface FollowStreamSegment {
  direction: "client" | "server";
  ts: number;
  data_b64: string;
  length: number;
}

export interface FollowStreamResponse {
  proto: string;
  client: string;
  server: string;
  segments: FollowStreamSegment[];
  client_bytes: number;
  server_bytes: number;
  truncated: boolean;
}

export interface AnalysisIssue {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
}

export interface AnalysisEvent {
  conversation_id: string;
  proto: string;
  src: string;
  dst: string;
  summary_markdown: string;
  issues: AnalysisIssue[];
}

export interface PacketListEnvelope {
  items: PacketSummary[];
  total: number;
  offset: number;
  limit: number;
}

// API helpers
export async function getUser(): Promise<User> {
  const { data } = await api.get("/auth/me");
  return data;
}

export async function loginWithGitHub(nextPath?: string) {
  const next = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
    ? `?next=${encodeURIComponent(nextPath)}`
    : "";
  window.location.href = `/auth/github/login${next}`;
}

export async function logout() {
  await api.post("/auth/logout");
}

export async function listCaptures(): Promise<{ captures: Capture[]; total: number }> {
  const { data } = await api.get("/api/captures");
  return data;
}

export async function uploadCapture(file: File): Promise<Capture> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/api/captures", form);
  return data;
}

export async function deleteCapture(id: string) {
  await api.delete(`/api/captures/${id}`);
}

export async function getPackets(
  captureId: string,
  offset: number = 0,
  limit: number = 200,
  proto: string = "",
  q: string = ""
): Promise<PacketListEnvelope> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (proto) params.set("proto", proto);
  if (q) params.set("q", q);
  const { data } = await api.get(`/api/captures/${captureId}/packets?${params}`);
  return data;
}

// Build the export URL so the browser can download it directly (the cookie
// auth rides along on the GET). Honors the active proto/q filters.
export function packetsExportUrl(
  captureId: string,
  format: "csv" | "json",
  proto: string = "",
  q: string = ""
): string {
  const params = new URLSearchParams({ format });
  if (proto) params.set("proto", proto);
  if (q) params.set("q", q);
  return `/api/captures/${captureId}/export?${params}`;
}

export async function getPacketDetail(
  captureId: string,
  packetIdx: number
): Promise<PacketDetail> {
  const { data } = await api.get(`/api/captures/${captureId}/packets/${packetIdx}`);
  return data;
}

export async function getFollowStream(
  captureId: string,
  params: {
    src_ip: string;
    src_port: number;
    dst_ip: string;
    dst_port: number;
    proto: string;
  }
): Promise<FollowStreamResponse> {
  const query = new URLSearchParams({
    src_ip: params.src_ip,
    src_port: String(params.src_port),
    dst_ip: params.dst_ip,
    dst_port: String(params.dst_port),
    proto: params.proto,
  });
  const { data } = await api.get(`/api/captures/${captureId}/follow?${query}`);
  return data;
}

export async function getStatistics(
  captureId: string,
  params?: { bucketSeconds?: number; metric?: "packets" | "bytes" }
): Promise<StatisticsResponse> {
  const query = new URLSearchParams();
  if (params?.bucketSeconds) query.set("bucket_seconds", String(params.bucketSeconds));
  if (params?.metric) query.set("metric", params.metric);
  const qs = query.toString();
  const { data } = await api.get(
    `/api/captures/${captureId}/statistics${qs ? "?" + qs : ""}`
  );
  return data;
}
