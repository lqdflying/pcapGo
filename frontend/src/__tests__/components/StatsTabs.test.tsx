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

  it("shows packet percentage and a total row in the protocol tab", () => {
    const stats = createMockStatisticsResponse({
      packet_count: 10,
      protocols: [{ name: "TCP", packet_count: 10, byte_count: 1000, children: [] }],
    });
    render(<StatsTabs stats={stats} loading={false} />);
    expect(screen.getByText("100.0%")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("filters endpoints by address", () => {
    const stats = createMockStatisticsResponse({
      endpoints: [
        { address: "10.0.0.1", packet_count: 5, byte_count: 500, tx_packets: 5, rx_packets: 0, tx_bytes: 500, rx_bytes: 0 },
        { address: "192.168.1.5", packet_count: 20, byte_count: 2000, tx_packets: 0, rx_packets: 20, tx_bytes: 0, rx_bytes: 2000 },
      ],
    });
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Endpoints"));
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter endpoints"), {
      target: { value: "192" },
    });
    expect(screen.queryByText("10.0.0.1")).not.toBeInTheDocument();
    expect(screen.getByText("192.168.1.5")).toBeInTheDocument();
  });

  it("sorts endpoints when a column header is clicked", () => {
    const stats = createMockStatisticsResponse({
      endpoints: [
        { address: "10.0.0.1", packet_count: 5, byte_count: 500, tx_packets: 5, rx_packets: 0, tx_bytes: 500, rx_bytes: 0 },
        { address: "10.0.0.9", packet_count: 20, byte_count: 2000, tx_packets: 20, rx_packets: 0, tx_bytes: 2000, rx_bytes: 0 },
      ],
    });
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Endpoints"));
    // Default sort is packets desc → the 20-packet endpoint comes first.
    let addrs = screen.getAllByText(/10\.0\.0\./);
    expect(addrs[0].textContent).toBe("10.0.0.9");
    // Toggle to ascending.
    fireEvent.click(screen.getByText("Packets"));
    addrs = screen.getAllByText(/10\.0\.0\./);
    expect(addrs[0].textContent).toBe("10.0.0.1");
  });

  it("calls onSelectEndpoint when an endpoint row is clicked", () => {
    const stats = createMockStatisticsResponse();
    const onSelectEndpoint = vi.fn();
    render(<StatsTabs stats={stats} loading={false} onSelectEndpoint={onSelectEndpoint} />);
    fireEvent.click(screen.getByText("Endpoints"));
    fireEvent.click(screen.getByText("10.0.0.1"));
    expect(onSelectEndpoint).toHaveBeenCalledWith("10.0.0.1");
  });

  it("calls onSelectConversation when a conversation row is clicked", () => {
    const stats = createMockStatisticsResponse();
    const onSelectConversation = vi.fn();
    render(
      <StatsTabs stats={stats} loading={false} onSelectConversation={onSelectConversation} />
    );
    fireEvent.click(screen.getByText("Conversations"));
    fireEvent.click(screen.getByText("10.0.0.1:443"));
    expect(onSelectConversation).toHaveBeenCalledTimes(1);
    expect(onSelectConversation.mock.calls[0][0]).toMatchObject({ src_ip: "10.0.0.1" });
  });

  it("shows an average packet size column in conversations", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Conversations"));
    expect(screen.getByText("Avg")).toBeInTheDocument();
  });

  it("renders the IO graph as an SVG with peak/avg annotations", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("IO Graph"));
    expect(screen.getByLabelText("IO graph")).toBeInTheDocument();
    expect(screen.getByText(/peak/)).toBeInTheDocument();
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
