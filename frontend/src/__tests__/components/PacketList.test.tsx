import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PacketList } from "@/components/PacketList";
import { createMockPacketSummary } from "../test-setup";

describe("PacketList", () => {
  const mockOnSelect = vi.fn();
  const packets = [
    createMockPacketSummary({ idx: 0, proto: "TCP", src: "10.0.0.1", dst: "10.0.0.2", length: 100, info: "SYN" }),
    createMockPacketSummary({ idx: 1, proto: "UDP", src: "10.0.0.3", dst: "10.0.0.4", length: 80, info: "DNS query" }),
    createMockPacketSummary({ idx: 2, proto: "ICMP", src: "10.0.0.5", dst: "10.0.0.6", length: 64, info: "Echo request" }),
  ];

  beforeEach(() => {
    mockOnSelect.mockReset();
  });

  it("renders column headers", () => {
    render(
      <PacketList packets={[]} selectedIdx={null} onSelect={mockOnSelect} loading={false} />
    );
    expect(screen.getByText("No.")).toBeInTheDocument();
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Destination")).toBeInTheDocument();
    expect(screen.getByText("Proto")).toBeInTheDocument();
    expect(screen.getByText("Len")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    render(
      <PacketList packets={[]} selectedIdx={null} onSelect={mockOnSelect} loading={true} />
    );
    expect(screen.getByText("Loading packets...")).toBeInTheDocument();
  });

  it("renders without crashing with empty packets", () => {
    const { container } = render(
      <PacketList packets={[]} selectedIdx={null} onSelect={mockOnSelect} loading={false} />
    );
    expect(container).toBeTruthy();
  });

  it("renders virtualized container when packets are provided", () => {
    const { container } = render(
      <PacketList packets={packets} selectedIdx={null} onSelect={mockOnSelect} loading={false} />
    );
    // Virtualizer renders a position relative div as wrapper
    const virtualContainer = container.querySelector('[style*="position: relative"]');
    expect(virtualContainer).toBeTruthy();
  });
});
