import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock setup ──────────────────────────────────────────────────────
// vi.mock is hoisted above imports, so all referenced values must be created
// inside vi.hoisted() so they are available when the mock factory executes.
const {
  mockGet,
  mockPost,
  mockDelete,
  mockPatch,
  interceptorCapture,
  mockAxiosInstance,
  mockCreate,
} = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  const mockDelete = vi.fn();
  const mockPatch = vi.fn();

  // Mutable container so the captured interceptor handler can be read in tests.
  const interceptorCapture: { rejected: ((error: unknown) => unknown) | null } = {
    rejected: null,
  };

  const mockAxiosInstance = {
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
    patch: mockPatch,
    interceptors: {
      response: {
        use: vi.fn((_onFulfilled: unknown, onRejected: unknown) => {
          interceptorCapture.rejected = onRejected as (error: unknown) => unknown;
          return 0;
        }),
      },
    },
  };

  const mockCreate = vi.fn(() => mockAxiosInstance);

  return { mockGet, mockPost, mockDelete, mockPatch, interceptorCapture, mockAxiosInstance, mockCreate };
});

vi.mock("axios", () => ({
  default: {
    create: mockCreate,
  },
}));

// ── Module under test (imports after mock) ──────────────────────────────────
import {
  api,
  getUser,
  loginWithGitHub,
  logout,
  listCaptures,
  uploadCapture,
  deleteCapture,
  getPackets,
  getPacketDetail,
  getStatistics,
  listAllowedUsers,
  addAllowedUser,
  removeAllowedUser,
  updateAllowedUserRole,
} from "@/api/client";

// ── Tests ───────────────────────────────────────────────────────────────────
describe("API client", () => {
  beforeEach(() => {
    // Only clear call history for HTTP method mocks between tests.
    // Do NOT clear the interceptor mock (its captured handler must persist)
    // or mockCreate (it is called once at module init, not per test).
    mockGet.mockClear();
    mockPost.mockClear();
    mockDelete.mockClear();
    mockPatch.mockClear();
    window.location.href = "";
  });

  describe("axios instance", () => {
    it("creates with baseURL '/' and withCredentials true", () => {
      // mockCreate is called during module init (before any tests run).
      expect(mockCreate).toHaveBeenCalledWith({
        baseURL: "/",
        withCredentials: true,
      });
    });

    it("registers a response interceptor", () => {
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });

    it("exports the api instance", () => {
      expect(api).toBe(mockAxiosInstance);
    });
  });

  describe("401 interceptor", () => {
    it("redirects to /login on 401 response and preserves next path", async () => {
      const error = { response: { status: 401 } };

      expect(interceptorCapture.rejected).not.toBeNull();

      try {
        await interceptorCapture.rejected!(error);
      } catch {
        // interceptor rejects the promise — expected
      }

      // The redirect is deferred via setTimeout(0) so callers can react first.
      await new Promise((r) => setTimeout(r, 0));
      expect(window.location.href).toBe("/login?next=%2F");
    });

    it("does not redirect on non-401 errors", async () => {
      const error = { response: { status: 500 } };

      try {
        await interceptorCapture.rejected!(error);
      } catch {
        // expected rejection
      }

      await new Promise((r) => setTimeout(r, 0));
      expect(window.location.href).toBe("");
    });

    it("propagates non-401 errors as rejected promises", async () => {
      const error = { response: { status: 500 } };
      await expect(interceptorCapture.rejected!(error)).rejects.toEqual(error);
    });

    it("handles errors without a response object", async () => {
      const error = { message: "Network Error" };

      await expect(interceptorCapture.rejected!(error)).rejects.toEqual(error);
      await new Promise((r) => setTimeout(r, 0));
      expect(window.location.href).toBe("");
    });

    it("does not redirect when already on /login (prevents reload loop)", async () => {
      // Simulate the login page: the interceptor must skip the redirect so
      // LoginPage's own getUser() call doesn't bounce forever.
      const originalPathname = window.location.pathname;
      Object.defineProperty(window, "location", {
        value: { ...window.location, pathname: "/login", href: "" },
        writable: true,
      });

      const error = { response: { status: 401 } };
      try {
        await interceptorCapture.rejected!(error);
      } catch {
        // expected rejection
      }

      await new Promise((r) => setTimeout(r, 0));
      expect(window.location.href).toBe("");

      // Restore
      Object.defineProperty(window, "location", {
        value: { ...window.location, pathname: originalPathname, href: "" },
        writable: true,
      });
    });
  });

  describe("getUser", () => {
    it("calls GET /auth/me and returns the user", async () => {
      const mockUser = { id: "1", login: "test", email: null, name: null, avatar_url: null };
      mockGet.mockResolvedValue({ data: mockUser });

      const result = await getUser();

      expect(mockGet).toHaveBeenCalledWith("/auth/me");
      expect(result).toEqual(mockUser);
    });
  });

  describe("loginWithGitHub", () => {
    it("redirects to /auth/github/login", () => {
      loginWithGitHub();
      expect(window.location.href).toBe("/auth/github/login");
    });
  });

  describe("logout", () => {
    it("calls POST /auth/logout", async () => {
      mockPost.mockResolvedValue({});

      await logout();

      expect(mockPost).toHaveBeenCalledWith("/auth/logout");
    });
  });

  describe("listCaptures", () => {
    it("calls GET /api/captures and returns captures with total", async () => {
      const mockData = { captures: [], total: 0 };
      mockGet.mockResolvedValue({ data: mockData });

      const result = await listCaptures();

      expect(mockGet).toHaveBeenCalledWith("/api/captures");
      expect(result).toEqual(mockData);
    });

    it("passes all-captures and owner filters as query params", async () => {
      const mockData = { captures: [], total: 0 };
      mockGet.mockResolvedValue({ data: mockData });

      await listCaptures({ all: true, owner: "alice" });

      expect(mockGet).toHaveBeenCalledWith("/api/captures?all=true&owner=alice");
    });
  });

  describe("admin users", () => {
    it("lists allowed users", async () => {
      const mockData = { users: [], total: 0 };
      mockGet.mockResolvedValue({ data: mockData });

      const result = await listAllowedUsers();

      expect(mockGet).toHaveBeenCalledWith("/api/admin/users");
      expect(result).toEqual(mockData);
    });

    it("adds an allowed user", async () => {
      const mockUser = { github_login: "octocat", role: "user" };
      mockPost.mockResolvedValue({ data: mockUser });

      const result = await addAllowedUser("octocat", "user");

      expect(mockPost).toHaveBeenCalledWith("/api/admin/users", {
        github_login: "octocat",
        role: "user",
      });
      expect(result).toEqual(mockUser);
    });

    it("removes an allowed user with URL encoding", async () => {
      mockDelete.mockResolvedValue({});

      await removeAllowedUser("octo cat");

      expect(mockDelete).toHaveBeenCalledWith("/api/admin/users/octo%20cat");
    });

    it("updates an allowed user's role", async () => {
      const mockUser = { github_login: "octocat", role: "super_admin" };
      mockPatch.mockResolvedValue({ data: mockUser });

      const result = await updateAllowedUserRole("octocat", "super_admin");

      expect(mockPatch).toHaveBeenCalledWith("/api/admin/users/octocat", {
        github_login: "octocat",
        role: "super_admin",
      });
      expect(result).toEqual(mockUser);
    });
  });

  describe("uploadCapture", () => {
    it("builds correct FormData and POSTs to /api/captures", async () => {
      const file = new File(["binary content"], "capture.pcap");
      const mockCapture = { id: "c1", filename: "capture.pcap" };
      mockPost.mockResolvedValue({ data: mockCapture });

      const result = await uploadCapture(file);

      expect(mockPost).toHaveBeenCalledWith(
        "/api/captures",
        expect.any(FormData),
      );

      const formData = mockPost.mock.calls[0][1] as FormData;
      expect(formData.get("file")).toBe(file);
      expect(result).toEqual(mockCapture);
    });
  });

  describe("deleteCapture", () => {
    it("calls DELETE /api/captures/:id", async () => {
      mockDelete.mockResolvedValue({});

      await deleteCapture("capture-abc123");

      expect(mockDelete).toHaveBeenCalledWith("/api/captures/capture-abc123");
    });
  });

  describe("getPackets", () => {
    it("constructs URLSearchParams without proto filter", async () => {
      const mockEnvelope = { items: [], total: 0, offset: 0, limit: 200 };
      mockGet.mockResolvedValue({ data: mockEnvelope });

      const result = await getPackets("cap-1", 0, 200);

      const url = mockGet.mock.calls[0][0] as string;
      expect(url).toContain("/api/captures/cap-1/packets?");
      expect(url).toContain("offset=0");
      expect(url).toContain("limit=200");
      expect(url).not.toContain("proto=");
      expect(result).toEqual(mockEnvelope);
    });

    it("constructs URLSearchParams with proto filter", async () => {
      const mockEnvelope = { items: [], total: 0, offset: 50, limit: 100 };
      mockGet.mockResolvedValue({ data: mockEnvelope });

      await getPackets("cap-1", 50, 100, "TCP");

      const url = mockGet.mock.calls[0][0] as string;
      expect(url).toContain("/api/captures/cap-1/packets?");
      expect(url).toContain("offset=50");
      expect(url).toContain("limit=100");
      expect(url).toContain("proto=TCP");
    });

    it("uses default offset=0 and limit=200 when not provided", async () => {
      mockGet.mockResolvedValue({ data: { items: [], total: 0, offset: 0, limit: 200 } });

      await getPackets("cap-1");

      const url = mockGet.mock.calls[0][0] as string;
      expect(url).toContain("offset=0");
      expect(url).toContain("limit=200");
    });
  });

  describe("getPacketDetail", () => {
    it("calls GET /api/captures/:id/packets/:idx", async () => {
      const mockDetail = { idx: 42, ts: 1.5, src: "10.0.0.1", dst: "10.0.0.2", proto: "TCP", length: 100, info: "test", layers: [], raw_hex: "", raw_offset: 0 };
      mockGet.mockResolvedValue({ data: mockDetail });

      const result = await getPacketDetail("cap-1", 42);

      expect(mockGet).toHaveBeenCalledWith("/api/captures/cap-1/packets/42");
      expect(result).toEqual(mockDetail);
    });
  });

  describe("getStatistics", () => {
    it("calls GET /api/captures/:id/statistics", async () => {
      const mockStats = { capture_id: "cap-1", packet_count: 100, duration: 5.0, protocols: [], endpoints: [], conversations: [], io_buckets: [] };
      mockGet.mockResolvedValue({ data: mockStats });

      const result = await getStatistics("cap-1");

      expect(mockGet).toHaveBeenCalledWith("/api/captures/cap-1/statistics");
      expect(result).toEqual(mockStats);
    });
  });
});
