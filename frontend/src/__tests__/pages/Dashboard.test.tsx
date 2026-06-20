import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardPage } from "@/pages/Dashboard";
import { createMockUser, createMockCapture } from "../test-setup";

// Mock API client
const mockGetUser = vi.fn();
const mockListCaptures = vi.fn();
const mockLogout = vi.fn();
const mockDeleteCapture = vi.fn();

vi.mock("@/api/client", () => ({
  getUser: (...args: any[]) => mockGetUser(...args),
  listCaptures: (...args: any[]) => mockListCaptures(...args),
  uploadCapture: vi.fn(),
  deleteCapture: (...args: any[]) => mockDeleteCapture(...args),
  logout: (...args: any[]) => mockLogout(...args),
}));

// Mock the store
import { useAuthStore } from "@/lib/store";

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={["/"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: createMockUser(), loading: false });
    mockGetUser.mockResolvedValue(createMockUser());
  });

  it("renders the header with title", async () => {
    mockListCaptures.mockResolvedValue({ captures: [], total: 0 });
    await act(async () => {
      renderDashboard();
    });
    expect(await screen.findByText("pcapGo")).toBeInTheDocument();
  });

  it("renders the upload area", async () => {
    mockListCaptures.mockResolvedValue({ captures: [], total: 0 });
    await act(async () => {
      renderDashboard();
    });
    expect(await screen.findByText(/drop a/i)).toBeInTheDocument();
  });

  it('shows "No captures yet" when list is empty', async () => {
    mockListCaptures.mockResolvedValue({ captures: [], total: 0 });
    await act(async () => {
      renderDashboard();
    });
    expect(await screen.findByText(/no captures yet/i)).toBeInTheDocument();
  });

  it("renders capture list items", async () => {
    mockListCaptures.mockResolvedValue({
      captures: [
        createMockCapture({
          id: "cap-1",
          filename: "my-capture.pcap",
          size_bytes: 2048,
          packet_count: 42,
          status: "ready",
        }),
      ],
      total: 1,
    });
    await act(async () => {
      renderDashboard();
    });
    expect(await screen.findByText("my-capture.pcap")).toBeInTheDocument();
  });

  it("shows ready status indicator for ready captures", async () => {
    mockListCaptures.mockResolvedValue({
      captures: [createMockCapture({ status: "ready" })],
      total: 1,
    });
    await act(async () => {
      renderDashboard();
    });
    expect(await screen.findByText("Analyze")).toBeInTheDocument();
  });

  it("shows user login name in header", async () => {
    const customUser = createMockUser({ login: "mygithub" });
    useAuthStore.setState({ user: customUser, loading: false });
    mockGetUser.mockResolvedValue(customUser);
    mockListCaptures.mockResolvedValue({ captures: [], total: 0 });
    act(() => {
      renderDashboard();
    });
    // Wait for the list captures to settle
    await screen.findByText(/no captures yet/i);
    expect(screen.getByText("mygithub")).toBeInTheDocument();
  });

  it("does not call deleteCapture when user cancels confirm", async () => {
    mockListCaptures.mockResolvedValue({
      captures: [
        createMockCapture({
          id: "cap-delete",
          filename: "delete-me.pcap",
          status: "ready",
        }),
      ],
      total: 1,
    });
    vi.stubGlobal("confirm", () => false);
    await act(async () => {
      renderDashboard();
    });
    const deleteBtn = await screen.findByLabelText("Delete capture");
    fireEvent.click(deleteBtn);
    expect(mockDeleteCapture).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("calls deleteCapture when user confirms", async () => {
    mockListCaptures.mockResolvedValue({
      captures: [
        createMockCapture({
          id: "cap-delete",
          filename: "delete-me.pcap",
          status: "ready",
        }),
      ],
      total: 1,
    });
    vi.stubGlobal("confirm", () => true);
    await act(async () => {
      renderDashboard();
    });
    const deleteBtn = await screen.findByLabelText("Delete capture");
    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    expect(mockDeleteCapture).toHaveBeenCalledWith("cap-delete", expect.anything());
    vi.unstubAllGlobals();
  });
});
