import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionView } from "@/components/SessionView";
import { createMockSessionPacketsResponse } from "../test-setup";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>(
    "@/api/client"
  );
  return { ...actual, getSessionPackets: vi.fn() };
});

import { getSessionPackets } from "@/api/client";

const mockConv = {
  id: "conv-1",
  proto: "tcp",
  src_ip: "10.0.0.1",
  src_port: 443,
  dst_ip: "10.0.0.2",
  dst_port: 54321,
  packet_count: 5,
  byte_count: 1000,
  start_ts: 0,
  end_ts: 1,
  app_protocol: "TLS",
  flags_summary: "SYN,ACK",
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("SessionView", () => {
  beforeEach(() => {
    vi.mocked(getSessionPackets).mockResolvedValue(
      createMockSessionPacketsResponse()
    );
  });

  it("renders modal with endpoint headers", () => {
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByText(/10\.0\.0\.1:443/)).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.2:54321/)).toBeInTheDocument();
  });

  it("shows protocol badge", () => {
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByText("TLS")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={onClose}
      />,
      { wrapper }
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when backdrop clicked", () => {
    const onClose = vi.fn();
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={onClose}
      />,
      { wrapper }
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows tab buttons for Sequence Diagram and Data Flow", () => {
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByText("Sequence Diagram")).toBeInTheDocument();
    expect(screen.getByText("Data Flow")).toBeInTheDocument();
  });

  it("shows duration in header", () => {
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={vi.fn()}
      />,
      { wrapper }
    );
    // (end_ts - start_ts) * 1000 = (1 - 0) * 1000 = 1000 ms
    expect(screen.getByText(/1000/)).toBeInTheDocument();
  });
});
