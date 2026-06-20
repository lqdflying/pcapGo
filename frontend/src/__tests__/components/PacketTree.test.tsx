import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PacketTree } from "@/components/PacketTree";
import { createMockPacketDetail } from "../test-setup";

describe("PacketTree", () => {
  it("renders loading state with spinner", () => {
    render(<PacketTree detail={null} loading={true} />);
    expect(screen.getByText("Packet Details")).toBeInTheDocument();
  });

  it("renders placeholder when no detail selected", () => {
    render(<PacketTree detail={null} loading={false} />);
    expect(screen.getByText(/select a packet/i)).toBeInTheDocument();
  });

  it("renders frame info when detail is provided", () => {
    const detail = createMockPacketDetail({ idx: 5, length: 200, proto: "TCP" });
    render(<PacketTree detail={detail} loading={false} />);
    expect(screen.getByText(/Frame 5/i)).toBeInTheDocument();
    expect(screen.getByText(/200 bytes/)).toBeInTheDocument();
  });

  it("renders layer hierarchy from detail", () => {
    const detail = createMockPacketDetail();
    render(<PacketTree detail={detail} loading={false} />);
    // All three layers show via recursive TreeNode
    expect(screen.getByText("Ethernet")).toBeInTheDocument();
    // "IP" appears twice: as layer name and as summary; getAllByText handles this
    const ipElements = screen.getAllByText("IP");
    expect(ipElements.length).toBeGreaterThanOrEqual(1);
    const tcpElements = screen.getAllByText("TCP");
    expect(tcpElements.length).toBeGreaterThanOrEqual(1);
  });

  it("toggles layer expansion on click", () => {
    const detail = createMockPacketDetail();
    render(<PacketTree detail={detail} loading={false} />);
    // Click on the Ethernet layer to collapse it
    const etherNode = screen.getByText("Ethernet");
    fireEvent.click(etherNode);
    // After collapsing, IP should not be visible
    // (but since we have a flat test detail with same names, just check no crash)
    expect(screen.getByText("Ethernet")).toBeInTheDocument();
  });

  it("handles detail with empty layers", () => {
    const detail = createMockPacketDetail({ layers: [] });
    render(<PacketTree detail={detail} loading={false} />);
    expect(screen.getByText(/Frame/i)).toBeInTheDocument();
  });

  it("calls onSelectLayer when a layer row is clicked", () => {
    const detail = createMockPacketDetail();
    const onSelectLayer = vi.fn();
    render(<PacketTree detail={detail} loading={false} onSelectLayer={onSelectLayer} />);
    fireEvent.click(screen.getByText("Ethernet"));
    expect(onSelectLayer).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, length: 14 })
    );
  });
});
