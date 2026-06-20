import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PacketList } from "@/components/PacketList";
import { createMockPacketSummary } from "../test-setup";

// Controllable virtualizer mock. jsdom gives the scroll element 0 height, so the
// real TanStack virtualizer renders no rows; we mock it to deterministically
// exercise row click + scroll-to-selection behaviour.
const scrollToIndex = vi.fn();
let visibleIndices: number[] = [];
let virtualCount = 0;

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => virtualCount * 28,
    getVirtualItems: () =>
      visibleIndices.map((index) => ({
        index,
        key: index,
        start: index * 28,
        size: 28,
      })),
    scrollToIndex,
    measureElement: vi.fn(),
  }),
}));

describe("PacketList", () => {
  const mockOnSelect = vi.fn();
  const packets = [
    createMockPacketSummary({ idx: 0, proto: "TCP", src: "10.0.0.1", dst: "10.0.0.2", length: 100, info: "SYN" }),
    createMockPacketSummary({ idx: 1, proto: "UDP", src: "10.0.0.3", dst: "10.0.0.4", length: 80, info: "DNS query" }),
    createMockPacketSummary({ idx: 2, proto: "ICMP", src: "10.0.0.5", dst: "10.0.0.6", length: 64, info: "Echo request" }),
  ];
  // A "page 2" set where absolute idx (100,101,102) != array position (0,1,2).
  const pageTwoPackets = [
    createMockPacketSummary({ idx: 100, proto: "TCP", src: "10.0.0.1", dst: "10.0.0.2", info: "p100" }),
    createMockPacketSummary({ idx: 101, proto: "TCP", src: "10.0.0.1", dst: "10.0.0.2", info: "p101" }),
    createMockPacketSummary({ idx: 102, proto: "TCP", src: "10.0.0.1", dst: "10.0.0.2", info: "p102" }),
  ];

  beforeEach(() => {
    mockOnSelect.mockReset();
    scrollToIndex.mockReset();
    visibleIndices = [];
    virtualCount = 0;
  });

  it("renders column headers", () => {
    render(
      <PacketList packets={[]} selectedIdx={null} selectedSet={new Set()} onSelect={mockOnSelect} loading={false} />
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
      <PacketList packets={[]} selectedIdx={null} selectedSet={new Set()} onSelect={mockOnSelect} loading={false} />
    );
    expect(container).toBeTruthy();
  });

  it("renders virtualized container when packets are provided", () => {
    virtualCount = packets.length;
    visibleIndices = [0, 1, 2];
    const { container } = render(
      <PacketList packets={packets} selectedIdx={null} selectedSet={new Set()} onSelect={mockOnSelect} loading={false} />
    );
    const virtualContainer = container.querySelector('[style*="position: relative"]');
    expect(virtualContainer).toBeTruthy();
  });

  it("calls onSelect with the absolute packet idx when a row is clicked", () => {
    virtualCount = packets.length;
    visibleIndices = [0, 1, 2];
    render(
      <PacketList packets={packets} selectedIdx={null} selectedSet={new Set()} onSelect={mockOnSelect} loading={false} />
    );
    fireEvent.click(screen.getByText("DNS query"));
    expect(mockOnSelect).toHaveBeenCalledWith(1, "single", [0, 1, 2]);
  });

  it("marks the selected row with tr-selected / aria-selected", () => {
    virtualCount = packets.length;
    visibleIndices = [0, 1, 2];
    render(
      <PacketList packets={packets} selectedIdx={2} selectedSet={new Set([2])} onSelect={mockOnSelect} loading={false} />
    );
    const selected = screen.getByText("Echo request").closest('[role="row"]')!;
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected.className).toContain("tr-selected");
  });

  it("does NOT auto-scroll when the selected row is already visible", () => {
    virtualCount = packets.length;
    visibleIndices = [0, 1, 2];
    render(
      <PacketList packets={packets} selectedIdx={1} selectedSet={new Set([1])} onSelect={mockOnSelect} loading={false} />
    );
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("scrolls using the page-relative array index, not the absolute idx", () => {
    // page 2: absolute idx 102 lives at array position 2, and is off-screen.
    virtualCount = pageTwoPackets.length;
    visibleIndices = [0];
    render(
      <PacketList packets={pageTwoPackets} selectedIdx={102} selectedSet={new Set([102])} onSelect={mockOnSelect} loading={false} />
    );
    expect(scrollToIndex).toHaveBeenCalledWith(2, { align: "center" });
    expect(scrollToIndex).not.toHaveBeenCalledWith(102, expect.anything());
  });

  it("does not scroll when the selection is on another page", () => {
    virtualCount = packets.length;
    visibleIndices = [0, 1, 2];
    render(
      <PacketList packets={packets} selectedIdx={999} selectedSet={new Set()} onSelect={mockOnSelect} loading={false} />
    );
    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
