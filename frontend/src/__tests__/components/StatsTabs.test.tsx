import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatsTabs } from "@/components/StatsTabs";
import { createMockStatisticsResponse } from "../test-setup";

describe("StatsTabs", () => {
  it("renders loading state", () => {
    render(<StatsTabs stats={null} loading={true} />);
    expect(screen.getByText("Statistics")).toBeInTheDocument();
  });

  it("renders placeholder when no stats available", () => {
    render(<StatsTabs stats={null} loading={false} />);
    expect(screen.getByText("No statistics available")).toBeInTheDocument();
  });

  it("shows IP Statistics view by default", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2")).toBeInTheDocument();
  });

  it("shows packet count in summary", () => {
    const stats = createMockStatisticsResponse({ packet_count: 42, duration: 3.5 });
    render(<StatsTabs stats={stats} loading={false} />);
    expect(screen.getByText(/42 packets/)).toBeInTheDocument();
  });

  it("switches to Protocol Statistics view", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Protocol Statistics"));
    expect(screen.getByText("TLS")).toBeInTheDocument();
  });

  it("switches to Country Statistics view", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Country Statistics"));
    expect(screen.getAllByText("Local Network").length).toBeGreaterThan(0);
  });

  it("renders country flags as SVG images", () => {
    const stats = createMockStatisticsResponse({
      country_stats: [
        { country: "Singapore", country_code: "SG", country_flag: "\uD83C\uDDF8\uD83C\uDDEC", ip_count: 1, total_packets: 10, total_bytes: 1000, session_count: 1 },
      ],
    });
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Country Statistics"));
    const flag = document.querySelector('img[src$="/1f1f8-1f1ec.svg"]');
    expect(flag).toBeInTheDocument();
  });

  it("switches to IO Graph view", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("IO Graph"));
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

  it("filters IPs by address in IP Statistics view", () => {
    const stats = createMockStatisticsResponse({
      ip_stats: [
        { ip: "10.0.0.1", country: "Local Network", country_code: "LAN", country_flag: "", earliest_time: 0, latest_time: 2.5, ports: [443], protocols: ["TLS"], total_sent_packets: 10, total_recv_packets: 0, total_sent_bytes: 1000, total_recv_bytes: 0, tcp_session_count: 1, udp_session_count: 0 },
        { ip: "192.168.1.5", country: "Local Network", country_code: "LAN", country_flag: "", earliest_time: 0, latest_time: 2.5, ports: [80], protocols: ["HTTP"], total_sent_packets: 20, total_recv_packets: 5, total_sent_bytes: 2000, total_recv_bytes: 500, tcp_session_count: 1, udp_session_count: 0 },
      ],
    });
    render(<StatsTabs stats={stats} loading={false} />);
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter IPs"), {
      target: { value: "192" },
    });
    expect(screen.queryByText("10.0.0.1")).not.toBeInTheDocument();
    expect(screen.getByText("192.168.1.5")).toBeInTheDocument();
  });

  it("calls onSelectEndpoint when an IP row is clicked", () => {
    const stats = createMockStatisticsResponse();
    const onSelectEndpoint = vi.fn();
    render(<StatsTabs stats={stats} loading={false} onSelectEndpoint={onSelectEndpoint} />);
    fireEvent.click(screen.getByText("10.0.0.1"));
    expect(onSelectEndpoint).toHaveBeenCalledWith("10.0.0.1");
  });

  it("calls onSelectProtocol when a protocol row is clicked", () => {
    const stats = createMockStatisticsResponse();
    const onSelectProtocol = vi.fn();
    render(<StatsTabs stats={stats} loading={false} onSelectProtocol={onSelectProtocol} />);
    fireEvent.click(screen.getByText("Protocol Statistics"));
    fireEvent.click(screen.getByText("TLS"));
    expect(onSelectProtocol).toHaveBeenCalledWith("TLS");
  });

  it("renders IO graph as SVG with peak/avg annotations", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("IO Graph"));
    expect(screen.getByLabelText("IO graph")).toBeInTheDocument();
    expect(screen.getByText(/peak/)).toBeInTheDocument();
  });

  it("shows sidebar navigation items", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    expect(screen.getByText("IP Statistics")).toBeInTheDocument();
    expect(screen.getByText("Protocol Statistics")).toBeInTheDocument();
    expect(screen.getByText("Country Statistics")).toBeInTheDocument();
    expect(screen.getByText("IO Graph")).toBeInTheDocument();
  });

  it("shows no countries message when country_stats is empty", () => {
    const stats = createMockStatisticsResponse({ country_stats: [] });
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Country Statistics"));
    expect(screen.getByText("No country data available")).toBeInTheDocument();
  });

  it("shows protocol percentage bar", () => {
    const stats = createMockStatisticsResponse();
    render(<StatsTabs stats={stats} loading={false} />);
    fireEvent.click(screen.getByText("Protocol Statistics"));
    expect(screen.getAllByText("100.0%").length).toBeGreaterThan(0);
  });
});
