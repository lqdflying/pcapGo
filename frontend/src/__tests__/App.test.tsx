import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";
import { useAuthStore } from "@/lib/store";
import { createMockUser } from "./test-setup";

vi.mock("@/pages/Login", () => ({
  LoginPage: () => <div>LoginPage</div>,
}));

vi.mock("@/pages/Dashboard", () => ({
  DashboardPage: () => <div>DashboardPage</div>,
}));

vi.mock("@/pages/Capture", () => ({
  CapturePage: () => <div>CapturePage</div>,
}));

vi.mock("@/pages/Admin", () => ({
  AdminPage: () => <div>AdminPage</div>,
}));

// Mock getUser so the App mount probe doesn't make a real HTTP call.
const mockGetUser = vi.fn();
vi.mock("@/api/client", () => ({
  getUser: (...args: any[]) => mockGetUser(...args),
}));

function renderApp(initialRoute = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[initialRoute]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("App Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, loading: false });
    // Default: getUser rejects (unauthenticated).
    mockGetUser.mockRejectedValue(new Error("not logged in"));
  });

  it("shows loading state while session probe is in flight", () => {
    // Make getUser hang (never resolve) so loading stays true.
    mockGetUser.mockReturnValue(new Promise(() => {}));
    useAuthStore.setState({ user: null, loading: true });
    renderApp("/");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows login page at / (unauthenticated)", async () => {
    useAuthStore.setState({ user: null, loading: false });
    await act(async () => {
      renderApp("/");
    });
    await waitFor(() => {
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
    });
  });

  it("shows login page at /captures/:id (unauthenticated)", async () => {
    useAuthStore.setState({ user: null, loading: false });
    await act(async () => {
      renderApp("/captures/123");
    });
    await waitFor(() => {
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
    });
  });

  it("shows login page at /login", async () => {
    useAuthStore.setState({ user: null, loading: false });
    await act(async () => {
      renderApp("/login");
    });
    await waitFor(() => {
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
    });
  });

  it("shows dashboard at / (authenticated)", async () => {
    mockGetUser.mockResolvedValue(createMockUser());
    useAuthStore.setState({ user: createMockUser(), loading: false });
    await act(async () => {
      renderApp("/");
    });
    await waitFor(() => {
      expect(screen.getByText("DashboardPage")).toBeInTheDocument();
    });
  });

  it("shows capture page at /captures/:id (authenticated)", async () => {
    mockGetUser.mockResolvedValue(createMockUser());
    useAuthStore.setState({ user: createMockUser(), loading: false });
    await act(async () => {
      renderApp("/captures/456");
    });
    await waitFor(() => {
      expect(screen.getByText("CapturePage")).toBeInTheDocument();
    });
  });

  it("shows admin page at /admin for super admins", async () => {
    const adminUser = createMockUser({ role: "super_admin" });
    mockGetUser.mockResolvedValue(adminUser);
    useAuthStore.setState({ user: adminUser, loading: false });
    await act(async () => {
      renderApp("/admin");
    });
    await waitFor(() => {
      expect(screen.getByText("AdminPage")).toBeInTheDocument();
    });
  });

  it("redirects normal users away from /admin", async () => {
    const normalUser = createMockUser({ role: "user" });
    mockGetUser.mockResolvedValue(normalUser);
    useAuthStore.setState({ user: normalUser, loading: false });
    await act(async () => {
      renderApp("/admin");
    });
    await waitFor(() => {
      expect(screen.getByText("DashboardPage")).toBeInTheDocument();
    });
    expect(screen.queryByText("AdminPage")).not.toBeInTheDocument();
  });

  it("probes the session on mount via getUser", async () => {
    await act(async () => {
      renderApp("/");
    });
    expect(mockGetUser).toHaveBeenCalled();
  });

  it("preserves deep link through auth reload", async () => {
    // Simulate a logged-in user refreshing /captures/456: start in the loading
    // state with no user, then the probe resolves and the capture page renders.
    mockGetUser.mockResolvedValue(createMockUser());
    useAuthStore.setState({ user: null, loading: true });
    await act(async () => {
      renderApp("/captures/456");
    });
    await waitFor(() => {
      expect(screen.getByText("CapturePage")).toBeInTheDocument();
    });
  });
});
