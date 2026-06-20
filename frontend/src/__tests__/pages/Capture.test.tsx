import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapturePage } from "@/pages/Capture";
import { createMockCapture } from "../test-setup";

// Mock API client
const mockApiGet = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
  },
  getPackets: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 200 }),
  getPacketDetail: vi.fn().mockResolvedValue(null),
  getStatistics: vi.fn().mockResolvedValue(null),
  packetsExportUrl: vi.fn().mockReturnValue("/api/captures/test/export?format=csv"),
}));

// Mock store
import { useCaptureStore } from "@/lib/store";

function renderCapturePage(captureId = "test-capture-id") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[`/captures/${captureId}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/captures/:id" element={<CapturePage />} />
          <Route path="/" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("CapturePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCaptureStore.setState({ selectedPacketIdx: null, filterProto: "" });
    // Default: capture is in ready state
    mockApiGet.mockResolvedValue({
      data: createMockCapture({ status: "ready", filename: "test.pcap", packet_count: 42 }),
    });
  });

  it("shows parsing state for non-ready capture", async () => {
    mockApiGet.mockResolvedValue({
      data: createMockCapture({ status: "parsing", packet_count: 0 }),
    });
    await act(async () => {
      renderCapturePage();
    });
    await screen.findByText(/parsing packet capture/i);
    expect(screen.getByText(/parsing packet capture/i)).toBeInTheDocument();
  });

  it("shows failed state for failed capture", async () => {
    mockApiGet.mockResolvedValue({
      data: createMockCapture({ status: "failed" }),
    });
    await act(async () => {
      renderCapturePage();
    });
    await screen.findByText(/parsing failed/i);
    expect(screen.getByText(/parsing failed/i)).toBeInTheDocument();
  });

  it("renders packets view mode when capture is ready", async () => {
    await act(async () => {
      renderCapturePage();
    });
    await screen.findByText("test.pcap");
    expect(screen.getByText("test.pcap")).toBeInTheDocument();
  });

  it("shows view mode toggle buttons", async () => {
    await act(async () => {
      renderCapturePage();
    });
    expect(await screen.findByText("Packets")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(screen.getByText("AI Analysis")).toBeInTheDocument();
  });

  it("shows protocol filter dropdown in packets view", async () => {
    await act(async () => {
      renderCapturePage();
    });
    expect(screen.getByLabelText("Filter by protocol")).toBeInTheDocument();
  });

  it("shows the packet search box and CSV export link in packets view", async () => {
    await act(async () => {
      renderCapturePage();
    });
    expect(await screen.findByLabelText("Search packets")).toBeInTheDocument();
    expect(screen.getByLabelText("Export packets as CSV")).toBeInTheDocument();
  });

  it("updates the search box value as the user types", async () => {
    await act(async () => {
      renderCapturePage();
    });
    const input = (await screen.findByLabelText("Search packets")) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "10.0.0.5" } });
    });
    expect(input.value).toBe("10.0.0.5");
  });

  it("shows pagination controls in packets view", async () => {
    await act(async () => {
      renderCapturePage();
    });
    expect(await screen.findByText(/Page 1 of/)).toBeInTheDocument();
    expect(screen.getByLabelText("Packets per page")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
  });
});
