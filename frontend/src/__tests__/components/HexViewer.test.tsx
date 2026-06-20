import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HexViewer } from "@/components/HexViewer";
import { createMockPacketDetail } from "../test-setup";

describe("HexViewer", () => {
  it("renders loading state", () => {
    render(<HexViewer detail={null} loading={true} />);
    expect(screen.getByText("Hex Dump")).toBeInTheDocument();
  });

  it("renders placeholder when no detail selected", () => {
    render(<HexViewer detail={null} loading={false} />);
    expect(screen.getByText(/select a packet to view hex dump/i)).toBeInTheDocument();
  });

  it("renders hex dump table when detail has raw_hex", () => {
    const detail = createMockPacketDetail({
      raw_hex: "00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f",
    });
    render(<HexViewer detail={detail} loading={false} />);

    // Should have an offset column with "0000"
    expect(screen.getByText("0000")).toBeInTheDocument();
  });

  it("renders ASCII column with dots for non-printable characters", () => {
    const detail = createMockPacketDetail({
      raw_hex: "00 01 02 41 42 43 7f ff",
    });
    render(<HexViewer detail={detail} loading={false} />);

    // ABC are printable; 00, 01, 02, 7f, ff are non-printable
    const asciiCells = screen.getAllByText(/[A-Za-z.]/);
    expect(asciiCells.length).toBeGreaterThan(0);
  });

  it("renders rows chunked into groups of 16 bytes", () => {
    // 17 bytes should produce 2 rows
    const hexValues = Array.from({ length: 17 }, (_, i) =>
      i.toString(16).padStart(2, "0")
    ).join(" ");
    const detail = createMockPacketDetail({ raw_hex: hexValues });
    render(<HexViewer detail={detail} loading={false} />);

    // First row offset 0000, second row offset 0010
    expect(screen.getByText("0000")).toBeInTheDocument();
    expect(screen.getByText("0010")).toBeInTheDocument();
  });

  it("highlights bytes matching the selected layer range", () => {
    const detail = createMockPacketDetail({
      raw_hex: Array.from({ length: 34 }, (_, i) =>
        i.toString(16).padStart(2, "0")
      ).join(" "),
      raw_offset: 0,
    });
    const { container } = render(
      <HexViewer detail={detail} loading={false} highlight={{ offset: 0, length: 14 }} />
    );
    const highlighted = container.querySelectorAll(".bg-panel-accent\\/30");
    expect(highlighted.length).toBeGreaterThan(0);
  });
});
