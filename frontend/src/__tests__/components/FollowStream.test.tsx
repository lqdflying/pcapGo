import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FollowStream } from "@/components/FollowStream";

const getFollowStream = vi.fn();
vi.mock("@/api/client", () => ({
  getFollowStream: (...args: any[]) => getFollowStream(...args),
}));

const conversation = {
  id: "conv-1",
  proto: "tcp",
  src_ip: "10.0.0.1",
  src_port: 12345,
  dst_ip: "10.0.0.2",
  dst_port: 80,
  packet_count: 2,
  byte_count: 50,
  start_ts: 0,
  end_ts: 1,
  app_protocol: "HTTP",
  flags_summary: "PA",
};

function b64(s: string) {
  return btoa(s);
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FollowStream captureId="cap-1" conversation={conversation as any} onClose={vi.fn()} />
    </QueryClientProvider>
  );
}

describe("FollowStream", () => {
  beforeEach(() => {
    getFollowStream.mockReset();
    getFollowStream.mockResolvedValue({
      proto: "tcp",
      client: "10.0.0.1:12345",
      server: "10.0.0.2:80",
      segments: [
        { direction: "client", ts: 0, data_b64: b64("GET /"), length: 5 },
        { direction: "server", ts: 1, data_b64: b64("200 OK"), length: 6 },
      ],
      client_bytes: 5,
      server_bytes: 6,
      truncated: false,
    });
  });

  it("renders client and server payloads as ASCII by default", async () => {
    renderPanel();
    expect(await screen.findByText("GET /")).toBeInTheDocument();
    expect(screen.getByText("200 OK")).toBeInTheDocument();
  });

  it("switches to hex view", async () => {
    renderPanel();
    await screen.findByText("GET /");
    fireEvent.click(screen.getByText("HEX"));
    // "GET /" -> 47 45 54 20 2f
    await waitFor(() =>
      expect(screen.getByText(/47 45 54 20 2f/)).toBeInTheDocument()
    );
  });

  it("shows the byte summary", async () => {
    renderPanel();
    await screen.findByText("GET /");
    expect(screen.getByText(/5 B sent · 6 B received/)).toBeInTheDocument();
  });
});
