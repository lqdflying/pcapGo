import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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
    vi.clearAllMocks();
    vi.mocked(getSessionPackets).mockResolvedValue(
      createMockSessionPacketsResponse({
        total: 401,
        src_geo: { country: "Unknown", country_code: "XX", country_flag: "🏳" },
        dst_geo: { country: "Unknown", country_code: "XX", country_flag: "🏴" },
      })
    );
  });

  it("requests sequence packets with conversation tuple params", async () => {
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(getSessionPackets).toHaveBeenCalledWith("cap-1", {
        src_ip: "10.0.0.1",
        src_port: 443,
        dst_ip: "10.0.0.2",
        dst_port: 54321,
        proto: "tcp",
        offset: 0,
        limit: 5000,
      });
    });
  });

  it("renders modal header with endpoint flags and protocol", async () => {
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
    expect(screen.getByText("TLS")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("🏳").length).toBeGreaterThan(0));
    expect(screen.getAllByText("🏴").length).toBeGreaterThan(0);
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

  it("moves the popup by dragging the header", () => {
    const onClose = vi.fn();
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={onClose}
      />,
      { wrapper }
    );

    const dialog = screen.getByRole("dialog");
    const popup = dialog.firstElementChild as HTMLElement;
    const header = screen.getByText(/10\.0\.0\.1:443/).closest("div")!;
    const initialLeft = popup.style.left;
    const initialTop = popup.style.top;

    act(() => {
      header.dispatchEvent(
        new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true })
      );
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 160, clientY: 145 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });

    expect(popup.style.left).not.toBe(initialLeft);
    expect(popup.style.top).not.toBe(initialTop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resizes the popup using the resize grip", () => {
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    const dialog = screen.getByRole("dialog");
    const popup = dialog.firstElementChild as HTMLElement;
    const initialWidth = popup.style.width;
    const initialHeight = popup.style.height;
    const grip = screen.getByRole("separator", { name: "Resize session window" });

    act(() => {
      grip.dispatchEvent(
        new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true })
      );
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 180, clientY: 150 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });

    expect(popup.style.width).not.toBe(initialWidth);
    expect(popup.style.height).not.toBe(initialHeight);
  });

  it("supports grow, shrink, and reset window controls", () => {
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    const dialog = screen.getByRole("dialog");
    const popup = dialog.firstElementChild as HTMLElement;
    const initialWidth = popup.style.width;

    fireEvent.click(screen.getByLabelText("Shrink session window"));
    expect(popup.style.width).not.toBe(initialWidth);

    fireEvent.click(screen.getByLabelText("Grow session window"));
    fireEvent.click(screen.getByLabelText("Reset session window"));
    expect(popup.style.width).toBe(initialWidth);
  });

  it("switches to data flow query params and resets paging on tab switch", async () => {
    render(
      <SessionView
        captureId="cap-1"
        conversation={mockConv}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => expect(getSessionPackets).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Data Flow"));
    await waitFor(() => {
      expect(getSessionPackets).toHaveBeenLastCalledWith("cap-1", {
        src_ip: "10.0.0.1",
        src_port: 443,
        dst_ip: "10.0.0.2",
        dst_port: 54321,
        proto: "tcp",
        offset: 0,
        limit: 200,
      });
    });

    fireEvent.click(screen.getByText("Next page"));
    await waitFor(() => {
      expect(getSessionPackets).toHaveBeenLastCalledWith("cap-1", {
        src_ip: "10.0.0.1",
        src_port: 443,
        dst_ip: "10.0.0.2",
        dst_port: 54321,
        proto: "tcp",
        offset: 200,
        limit: 200,
      });
    });

    fireEvent.click(screen.getByText("Sequence Diagram"));
    await waitFor(() => {
      expect(getSessionPackets).toHaveBeenLastCalledWith("cap-1", {
        src_ip: "10.0.0.1",
        src_port: 443,
        dst_ip: "10.0.0.2",
        dst_port: 54321,
        proto: "tcp",
        offset: 0,
        limit: 5000,
      });
    });
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
    expect(screen.getByText(/1000/)).toBeInTheDocument();
  });
});
