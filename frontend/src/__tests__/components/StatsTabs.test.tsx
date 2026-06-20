import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatsTabs } from "@/components/StatsTabs";
import { createMockStatisticsResponse } from "../test-setup";

describe("StatsTabs", () => {
  it("renders loading state", () => {
    render(<StatsTabs stats={null} loading={true} />);
    expect(screen.getByText("Protocol Hierarchy")).toBeInTheDocument();
  });

  it("renders placeholder when no stats available", () => {
    render(<StatsTabs stats={null} loading={false} />);
    expect(screen.getByText("No statistics available")).toBeInTheDocument();
  });

  it("renders protocol hierarchy tab by default", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    expect(screen.getByText("TCP")).toBeInTheDocument();
  });

  it("shows packet count in summary", () => {
    const stats = createMockStatisticsResponse({ packet_count: 42, duration: 3.5 });
    render(<StatsTabs stats={stats} loading={false} />);
    expect(screen.getByText(/42 packets/)).toBeInTheDocument();
  });

  it("switches to endpoints tab", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Endpoints"));
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
  });

  it("renders Tx/Rx columns in endpoints tab", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Endpoints"));
    expect(screen.getByText("Tx")).toBeInTheDocument();
    expect(screen.getByText("Rx")).toBeInTheDocument();
  });

  it("switches to conversations tab", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Conversations"));
    // Should show source IP:port pattern
    expect(screen.getByText(/10\.0\.0\.1/)).toBeInTheDocument();
  });

  it("renders app_protocol and flags columns in conversations tab", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Conversations"));
    expect(screen.getByText("App")).toBeInTheDocument();
    expect(screen.getByText("Flags")).toBeInTheDocument();
    expect(screen.getByText("TLS")).toBeInTheDocument();
    expect(screen.getByText("SYN,ACK")).toBeInTheDocument();
  });

  it("switches to IO Graph tab", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("IO Graph"));
    // IO Graph renders a message with "IO Graph" text
    const allText = screen.getAllByText(/IO Graph/);
    expect(allText.length).toBeGreaterThan(0);
  });

  it("calls onBucketChange when IO graph controls change", () => {
    const stats = createMockStatisticsResponse();
    const onBucketChange = vi.fn();
    render(<StatsTabs stats={stats} loading={false} onBucketChange={onBucketChange} />);
    fireEvent.click(screen.getByText("IO Graph"));

    const metricSelect = screen.getByLabelText("Metric") as HTMLSelectElement;
    fireEvent.change(metricSelect, { target: { value: "bytes" } });

    expect(onBucketChange).toHaveBeenCalledWith(1, "bytes");
  });

  it("displays protocol children when expanded", () => {
    const stats = createMockStatisticsResponse({
      protocols: [
        {
          name: "TCP",
          packet_count: 10,
          byte_count: 1000,
          children: [
            { name: "HTTP", packet_count: 5, byte_count: 500, children: [] },
          ],
        },
      ],
    });
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("TCP"));
    expect(screen.getByText("HTTP")).toBeInTheDocument();
  });
});
