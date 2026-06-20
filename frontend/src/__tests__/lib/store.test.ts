import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore, useCaptureStore, useThemeStore } from "@/lib/store";

// ── Helpers ─────────────────────────────────────────────────────────────────
function createMockUser(overrides = {}) {
  return {
    id: "user-1",
    login: "testuser",
    email: "test@example.com",
    name: "Test User",
    avatar_url: "https://avatar.example.com/test.png",
    ...overrides,
  };
}

// ── useAuthStore ────────────────────────────────────────────────────────────
describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      loading: true,
    });
  });

  it("has correct initial state — user=null, loading=true", () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.loading).toBe(true);
  });

  it("setUser(user) sets the user and loading=false", () => {
    const user = createMockUser();

    useAuthStore.getState().setUser(user);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.loading).toBe(false);
  });

  it("setUser(null) clears user and sets loading=false", () => {
    // first populate the store
    useAuthStore.getState().setUser(createMockUser());

    // then clear it
    useAuthStore.getState().setUser(null);

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("setLoading(false) sets loading=false", () => {
    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it("setLoading(true) sets loading=true", () => {
    // start from false
    useAuthStore.setState({ loading: false });
    expect(useAuthStore.getState().loading).toBe(false);

    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().loading).toBe(true);
  });

  it("setUser sets user with null fields intact", () => {
    const user = createMockUser({ email: null, name: null });

    useAuthStore.getState().setUser(user);

    const state = useAuthStore.getState();
    expect(state.user?.email).toBeNull();
    expect(state.user?.name).toBeNull();
  });
});

// ── useThemeStore ──────────────────────────────────────────────────────────
describe("useThemeStore", () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: "dark" });
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark", () => {
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("setTheme('obsidian') updates state and data-theme attribute", () => {
    useThemeStore.getState().setTheme("obsidian");

    expect(useThemeStore.getState().theme).toBe("obsidian");
    expect(document.documentElement.getAttribute("data-theme")).toBe("obsidian");
  });

  it("setTheme('light') persists to localStorage", () => {
    useThemeStore.getState().setTheme("light");
    expect(localStorage.getItem("pcapgo-theme")).toBe("light");
  });
});

// ── useCaptureStore ─────────────────────────────────────────────────────────
describe("useCaptureStore", () => {
  beforeEach(() => {
    useCaptureStore.setState({
      selectedPacketIdx: null,
      selectedIndices: [],
      lastClickedIdx: null,
      filterProto: "",
    });
  });

  it("has correct initial state — selectedPacketIdx=null, filterProto=''", () => {
    const state = useCaptureStore.getState();
    expect(state.selectedPacketIdx).toBeNull();
    expect(state.filterProto).toBe("");
  });

  it("setSelectedPacket(5) sets selectedPacketIdx to 5", () => {
    useCaptureStore.getState().setSelectedPacket(5);
    expect(useCaptureStore.getState().selectedPacketIdx).toBe(5);
  });

  it("setSelectedPacket(null) clears selectedPacketIdx", () => {
    useCaptureStore.getState().setSelectedPacket(42);
    expect(useCaptureStore.getState().selectedPacketIdx).toBe(42);

    useCaptureStore.getState().setSelectedPacket(null);
    expect(useCaptureStore.getState().selectedPacketIdx).toBeNull();
  });

  it("setFilterProto('tcp') sets filterProto and clears selectedPacketIdx", () => {
    // set a selection first so we can verify it gets cleared
    useCaptureStore.getState().setSelectedPacket(5);

    useCaptureStore.getState().setFilterProto("tcp");

    const state = useCaptureStore.getState();
    expect(state.filterProto).toBe("tcp");
    expect(state.selectedPacketIdx).toBeNull();
  });

  it("setFilterProto('') still clears selectedPacketIdx", () => {
    useCaptureStore.getState().setSelectedPacket(3);

    useCaptureStore.getState().setFilterProto("");

    const state = useCaptureStore.getState();
    expect(state.filterProto).toBe("");
    expect(state.selectedPacketIdx).toBeNull();
  });

  it("stores consecutive filter changes", () => {
    useCaptureStore.getState().setFilterProto("udp");
    expect(useCaptureStore.getState().filterProto).toBe("udp");

    useCaptureStore.getState().setFilterProto("icmp");
    expect(useCaptureStore.getState().filterProto).toBe("icmp");
  });

  // ── Multi-select tests ──────────────────────────────────────────────────

  it("selectPacket single mode sets selectedIndices to [idx]", () => {
    useCaptureStore.getState().selectPacket(5, "single");
    const state = useCaptureStore.getState();
    expect(state.selectedIndices).toEqual([5]);
    expect(state.selectedPacketIdx).toBe(5);
  });

  it("selectPacket toggle adds and removes", () => {
    const { selectPacket } = useCaptureStore.getState();
    selectPacket(5, "single");
    useCaptureStore.getState().selectPacket(7, "toggle");
    expect(useCaptureStore.getState().selectedIndices).toEqual([5, 7]);

    useCaptureStore.getState().selectPacket(5, "toggle");
    expect(useCaptureStore.getState().selectedIndices).toEqual([7]);
    expect(useCaptureStore.getState().selectedPacketIdx).toBe(5);
  });

  it("selectPacket range selects inclusive range over page indices", () => {
    const pageIndices = [1, 3, 5, 7, 9];
    useCaptureStore.getState().selectPacket(3, "single", pageIndices);
    useCaptureStore.getState().selectPacket(7, "range", pageIndices);
    expect(useCaptureStore.getState().selectedIndices).toEqual([3, 5, 7]);
  });

  it("clearSelection resets everything", () => {
    useCaptureStore.getState().selectPacket(5, "single");
    useCaptureStore.getState().clearSelection();
    const state = useCaptureStore.getState();
    expect(state.selectedPacketIdx).toBeNull();
    expect(state.selectedIndices).toEqual([]);
    expect(state.lastClickedIdx).toBeNull();
  });
});
