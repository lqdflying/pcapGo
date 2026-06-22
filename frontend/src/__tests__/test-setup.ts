import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import "@/i18n/i18n";
import type { SessionPacketsResponse } from "@/api/client";

// Mock window.location for redirects
const location = {
  href: "",
  assign: vi.fn(),
  replace: vi.fn(),
  reload: vi.fn(),
  origin: "http://localhost",
  pathname: "/",
  search: "",
  hash: "",
};

Object.defineProperty(window, "location", {
  value: location,
  writable: true,
});

// Mock matchMedia (used by some UI libraries)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver (used by TanStack Virtual)
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock scrollTo for virtualizer
Element.prototype.scrollTo = vi.fn() as any;

// Mock EventSource for SSE tests
class MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState: number = 0;

  constructor(url: string) {
    this.url = url;
  }

  close() {
    this.readyState = 2;
  }

  dispatchEvent(event: Event) {
    if (event.type === "message" && this.onmessage) {
      this.onmessage(event as MessageEvent);
    }
    if (event.type === "error" && this.onerror) {
      this.onerror(event);
    }
    return true;
  }
}

(global as any).EventSource = MockEventSource;

// Mock data factories
export function createMockUser(overrides = {}) {
  return { id: "user-1", login: "testuser", email: "test@example.com", name: "Test User", avatar_url: "https://avatar.example.com/test.png", ...overrides };
}
export function createMockCapture(overrides = {}) {
  return { id: "capture-1", filename: "test.pcap", size_bytes: 1024, sha256: "a".repeat(64), linktype: 1, packet_count: 10, status: "ready", created_at: new Date().toISOString(), ...overrides };
}
export function createMockPacketSummary(overrides = {}) {
  return { idx: 0, ts: 1.0, src: "10.0.0.1", dst: "10.0.0.2", proto: "TCP", length: 100, info: "443 > 54321 [SYN] Seq=0 Ack=0", ...overrides };
}
export function createMockPacketDetail(overrides = {}) {
  return { idx: 0, ts: 1.0, src: "10.0.0.1", dst: "10.0.0.2", proto: "TCP", length: 100, info: "443 > 54321 [SYN]", layers: [{ name: "Ethernet", summary: "Ethernet II", offset: 0, length: 14, children: [{ name: "IP", summary: "IP", offset: 14, length: 20, children: [{ name: "TCP", summary: "TCP", offset: 34, length: 20, children: [] }] }] }], raw_hex: "00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f", raw_offset: 0, ...overrides };
}
export function createMockLayerNode(overrides = {}) {
  return { name: "Ethernet", summary: "Ethernet II", offset: 0, length: 14, children: [], ...overrides };
}
export function createMockStatisticsResponse(overrides = {}) {
  return {
    capture_id: "capture-1",
    packet_count: 10,
    duration: 2.5,
    protocols: [{ name: "TCP", packet_count: 10, byte_count: 1000, children: [] }],
    endpoints: [{ address: "10.0.0.1", packet_count: 10, byte_count: 1000, tx_packets: 10, rx_packets: 0, tx_bytes: 1000, rx_bytes: 0 }],
    conversations: [{ id: "conv-1", proto: "tcp", src_ip: "10.0.0.1", src_port: 443, dst_ip: "10.0.0.2", dst_port: 54321, packet_count: 10, byte_count: 1000, start_ts: 0, end_ts: 2.5, app_protocol: "TLS", flags_summary: "SYN,ACK" }],
    io_buckets: Array.from({ length: 10 }, (_, i) => ({ ts_start: i * 0.25, packet_count: 1, byte_count: 100 })),
    bucket_seconds: 1,
    metric: "packets",
    ip_stats: [
      { ip: "10.0.0.1", country: "Local Network", country_code: "LAN", country_flag: "", earliest_time: 0, latest_time: 2.5, ports: [443], protocols: ["TLS"], total_sent_packets: 10, total_recv_packets: 0, total_sent_bytes: 1000, total_recv_bytes: 0, tcp_session_count: 1, udp_session_count: 0 },
      { ip: "10.0.0.2", country: "Local Network", country_code: "LAN", country_flag: "", earliest_time: 0, latest_time: 2.5, ports: [54321], protocols: ["TLS"], total_sent_packets: 0, total_recv_packets: 10, total_sent_bytes: 0, total_recv_bytes: 1000, tcp_session_count: 0, udp_session_count: 0 },
    ],
    proto_stats: [
      { proto: "TLS", total_packets: 10, total_bytes: 1000, session_count: 1, avg_packet_size: 100, percentage_packets: 100, percentage_bytes: 100, first_seen: 0, last_seen: 2.5 },
    ],
    country_stats: [
      { country: "Local Network", country_code: "LAN", country_flag: "", ip_count: 2, total_packets: 10, total_bytes: 1000, session_count: 1 },
    ],
    ...overrides,
  };
}
export function createMockAnalysisEvent(overrides = {}) {
  return { conversation_id: "conv-1", proto: "tcp", src: "10.0.0.1:443", dst: "10.0.0.2:54321", summary_markdown: "TLS handshake between client and server.", issues: [{ type: "handshake_failure", severity: "high" as const, explanation: "The TLS handshake did not complete." }], ...overrides };
}
export function createMockSessionPacketsResponse(overrides: Partial<SessionPacketsResponse> = {}): SessionPacketsResponse {
  return {
    items: [
      createMockPacketSummary({ idx: 0, ts: 1.0, src: "10.0.0.1", dst: "10.0.0.2", info: "443 > 54321 [SYN] Seq=0" }),
      createMockPacketSummary({ idx: 1, ts: 1.05, src: "10.0.0.2", dst: "10.0.0.1", info: "54321 > 443 [SYN ACK] Seq=0 Ack=1" }),
    ],
    total: 2,
    offset: 0,
    limit: 200,
    src_geo: { country: "Local Network", country_code: "LAN", country_flag: "" },
    dst_geo: { country: "Local Network", country_code: "LAN", country_flag: "" },
    ...overrides,
  };
}
