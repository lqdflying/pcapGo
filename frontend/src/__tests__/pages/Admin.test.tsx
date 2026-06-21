import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminPage } from "@/pages/Admin";
import { useAuthStore } from "@/lib/store";
import { createMockUser } from "../test-setup";

const mockListAllowedUsers = vi.fn();
const mockAddAllowedUser = vi.fn();
const mockRemoveAllowedUser = vi.fn();
const mockUpdateAllowedUserRole = vi.fn();

vi.mock("@/api/client", () => ({
  listAllowedUsers: (...args: any[]) => mockListAllowedUsers(...args),
  addAllowedUser: (...args: any[]) => mockAddAllowedUser(...args),
  removeAllowedUser: (...args: any[]) => mockRemoveAllowedUser(...args),
  updateAllowedUserRole: (...args: any[]) => mockUpdateAllowedUserRole(...args),
}));

function renderAdmin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={["/admin"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AdminPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: createMockUser({ login: "admin", role: "super_admin" }),
      loading: false,
    });
    mockListAllowedUsers.mockResolvedValue({
      users: [
        {
          id: "allowed-1",
          github_login: "admin",
          role: "super_admin",
          added_by: null,
          created_at: "2026-06-21T00:00:00Z",
          has_logged_in: true,
        },
        {
          id: "allowed-2",
          github_login: "pending-user",
          role: "user",
          added_by: "admin",
          created_at: "2026-06-21T00:00:00Z",
          has_logged_in: false,
        },
      ],
      total: 2,
    });
  });

  it("renders allowed users with login status", async () => {
    await act(async () => {
      renderAdmin();
    });

    expect(await screen.findByText("User Management")).toBeInTheDocument();
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(screen.getByText("pending-user")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("adds a new allowed user", async () => {
    mockAddAllowedUser.mockResolvedValue({
      id: "allowed-3",
      github_login: "octocat",
      role: "user",
      added_by: "admin",
      created_at: "2026-06-21T00:00:00Z",
      has_logged_in: false,
    });
    await act(async () => {
      renderAdmin();
    });

    fireEvent.change(await screen.findByPlaceholderText("octocat"), {
      target: { value: "octocat" },
    });
    fireEvent.click(screen.getByText("Add User"));

    await waitFor(() => {
      expect(mockAddAllowedUser).toHaveBeenCalledWith("octocat", "user");
    });
  });

  it("changes a user's role", async () => {
    mockUpdateAllowedUserRole.mockResolvedValue({
      id: "allowed-2",
      github_login: "pending-user",
      role: "super_admin",
      added_by: "admin",
      created_at: "2026-06-21T00:00:00Z",
      has_logged_in: false,
    });
    await act(async () => {
      renderAdmin();
    });

    await screen.findByText("pending-user");
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "super_admin" } });

    await waitFor(() => {
      expect(mockUpdateAllowedUserRole).toHaveBeenCalledWith(
        "pending-user",
        "super_admin"
      );
    });
  });

  it("does not show mutation controls for the seed admin", async () => {
    await act(async () => {
      renderAdmin();
    });

    expect(await screen.findByText("Seed Admin")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Remove user")).toHaveLength(1);
  });

  it("removes a user after confirmation", async () => {
    vi.stubGlobal("confirm", () => true);
    mockRemoveAllowedUser.mockResolvedValue(undefined);
    await act(async () => {
      renderAdmin();
    });

    const removeButton = await screen.findByLabelText("Remove user");
    await act(async () => {
      fireEvent.click(removeButton);
    });

    await waitFor(() => {
      expect(mockRemoveAllowedUser).toHaveBeenCalledWith(
        "pending-user",
        expect.anything()
      );
    });
    vi.unstubAllGlobals();
  });

  it("shows mutation errors", async () => {
    mockAddAllowedUser.mockRejectedValue({
      response: { data: { detail: "User already exists in allowlist" } },
    });
    await act(async () => {
      renderAdmin();
    });

    fireEvent.change(await screen.findByPlaceholderText("octocat"), {
      target: { value: "octocat" },
    });
    fireEvent.click(screen.getByText("Add User"));

    expect(await screen.findByText("User already exists in allowlist")).toBeInTheDocument();
  });

  it("shows query load errors distinctly", async () => {
    mockListAllowedUsers.mockRejectedValue(new Error("forbidden"));
    await act(async () => {
      renderAdmin();
    });

    expect(
      await screen.findByText("Failed to load allowed users. Please try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText("No users configured. Add a GitHub username above.")).not.toBeInTheDocument();
  });
});
