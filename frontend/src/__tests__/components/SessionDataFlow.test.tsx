import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionDataFlow } from "@/components/SessionDataFlow";
import { createMockPacketSummary } from "../test-setup";
import type { GeoInfo } from "@/api/client";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>(
    "@/api/client"
  );
  return { ...actual, getPacketDetail: vi.fn() };
});

const geo: GeoInfo = {
  country: "LAN",
  country_code: "LAN",
  country_flag: "",
};

const packets = [
  createMockPacketSummary({
    idx: 0,
    ts: 1.0,
    src: "10.0.0.1",
    dst: "10.0.0.2",
    length: 66,
    info: "443 > 54321 [SYN]",
  }),
  createMockPacketSummary({
    idx: 1,
    ts: 1.05,
    src: "10.0.0.2",
    dst: "10.0.0.1",
    length: 66,
    info: "54321 > 443 [SYN ACK]",
  }),
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("SessionDataFlow", () => {
  it("renders packet table with column headers", () => {
    render(
      <SessionDataFlow
        captureId="cap-1"
        packets={packets}
        total={2}
        srcIp="10.0.0.1"
        dstIp="10.0.0.2"
        srcGeo={geo}
        dstGeo={geo}
        offset={0}
        limit={200}
      />,
      { wrapper }
    );
    expect(screen.getByText("Index")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Destination")).toBeInTheDocument();
  });

  it("displays packet data in rows", () => {
    render(
      <SessionDataFlow
        captureId="cap-1"
        packets={packets}
        total={2}
        srcIp="10.0.0.1"
        dstIp="10.0.0.2"
        srcGeo={geo}
        dstGeo={geo}
        offset={0}
        limit={200}
      />,
      { wrapper }
    );
    // 10.0.0.1 appears as src in row 0 and dst in row 1
    expect(screen.getAllByText("10.0.0.1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("10.0.0.2").length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no packets", () => {
    render(
      <SessionDataFlow
        captureId="cap-1"
        packets={[]}
        total={0}
        srcIp="10.0.0.1"
        dstIp="10.0.0.2"
        srcGeo={geo}
        dstGeo={geo}
        offset={0}
        limit={200}
      />,
      { wrapper }
    );
    expect(
      screen.getByText("No packets found for this session")
    ).toBeInTheDocument();
  });

  it("shows status bar with total counts", () => {
    render(
      <SessionDataFlow
        captureId="cap-1"
        packets={packets}
        total={2}
        srcIp="10.0.0.1"
        dstIp="10.0.0.2"
        srcGeo={geo}
        dstGeo={geo}
        offset={0}
        limit={200}
      />,
      { wrapper }
    );
    expect(screen.getByText(/Total Packets/)).toBeInTheDocument();
    expect(screen.getByText(/Total Bytes/)).toBeInTheDocument();
  });

  it("shows packet info in table rows", () => {
    render(
      <SessionDataFlow
        captureId="cap-1"
        packets={packets}
        total={2}
        srcIp="10.0.0.1"
        dstIp="10.0.0.2"
        srcGeo={geo}
        dstGeo={geo}
        offset={0}
        limit={200}
      />,
      { wrapper }
    );
    expect(screen.getByText("443 > 54321 [SYN]")).toBeInTheDocument();
    expect(screen.getByText("54321 > 443 [SYN ACK]")).toBeInTheDocument();
  });
});
