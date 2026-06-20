import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "@/pages/Login";
import { useAuthStore } from "@/lib/store";

// Mock API client
const mockLoginWithGitHub = vi.fn();

vi.mock("@/api/client", () => ({
  loginWithGitHub: (...args: any[]) => mockLoginWithGitHub(...args),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, loading: false });
  });

  function renderLogin(initialEntry = "/login") {
    return render(
      <MemoryRouter
        initialEntries={[initialEntry]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <LoginPage />
      </MemoryRouter>
    );
  }

  it("renders the app title", () => {
    renderLogin();
    expect(screen.getByText("pcapGo")).toBeInTheDocument();
  });

  it('renders "Sign in with GitHub" button', () => {
    renderLogin();
    expect(screen.getByText("Sign in with GitHub")).toBeInTheDocument();
  });

  it("renders the subtitle text", () => {
    renderLogin();
    expect(screen.getByText(/upload and analyze packet captures/i)).toBeInTheDocument();
  });

  it("calls loginWithGitHub when button clicked", async () => {
    renderLogin();
    await act(async () => {
      screen.getByText("Sign in with GitHub").click();
    });
    expect(mockLoginWithGitHub).toHaveBeenCalled();
  });

  it("passes default '/' when no redirect target is available", async () => {
    renderLogin("/login");
    await act(async () => {
      screen.getByText("Sign in with GitHub").click();
    });
    expect(mockLoginWithGitHub).toHaveBeenCalledWith("/");
  });

  it("passes deep link from location.state.from", async () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: "/login", state: { from: { pathname: "/captures/abc" } } }]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <LoginPage />
      </MemoryRouter>
    );
    await act(async () => {
      screen.getByText("Sign in with GitHub").click();
    });
    expect(mockLoginWithGitHub).toHaveBeenCalledWith("/captures/abc");
  });

  it("passes deep link from ?next= query param", async () => {
    renderLogin("/login?next=/captures/xyz");
    await act(async () => {
      screen.getByText("Sign in with GitHub").click();
    });
    expect(mockLoginWithGitHub).toHaveBeenCalledWith("/captures/xyz");
  });

  it("ignores dangerous next values (protocol-relative)", async () => {
    renderLogin("/login?next=//evil.com/path");
    await act(async () => {
      screen.getByText("Sign in with GitHub").click();
    });
    // Dangerous values fall back to '/'.
    expect(mockLoginWithGitHub).toHaveBeenCalledWith("/");
  });
});
