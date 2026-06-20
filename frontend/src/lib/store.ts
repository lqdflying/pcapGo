import { create } from "zustand";
import type { User } from "../api/client";

// ── Theme ──────────────────────────────────────────────────────────────

export type Theme = "dark" | "light" | "obsidian";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("pcapgo-theme", t);
}

const storedTheme = (typeof window !== "undefined"
  ? (localStorage.getItem("pcapgo-theme") as Theme | null)
  : null) ?? "dark";

if (typeof window !== "undefined") {
  applyTheme(storedTheme);
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: storedTheme,
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
}));

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user, loading: false }),
  setLoading: (loading) => set({ loading }),
}));

// ── AI dock ────────────────────────────────────────────────────────────

interface AIFloatGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_AI_FLOAT: AIFloatGeom = { x: 200, y: 100, w: 480, h: 500 };

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

interface AIDockState {
  aiDockOpen: boolean;
  aiPoppedOut: boolean;
  aiFloat: AIFloatGeom;
  setAiDockOpen: (open: boolean) => void;
  toggleAiPopOut: () => void;
  setAiFloat: (g: AIFloatGeom) => void;
}

export const useAIDockStore = create<AIDockState>((set) => ({
  aiDockOpen: loadJSON("pcapgo-ai-dock-open", false),
  aiPoppedOut: loadJSON("pcapgo-ai-popped-out", false),
  aiFloat: loadJSON("pcapgo-ai-float", DEFAULT_AI_FLOAT),

  setAiDockOpen: (open) => {
    localStorage.setItem("pcapgo-ai-dock-open", JSON.stringify(open));
    set({ aiDockOpen: open });
  },

  toggleAiPopOut: () =>
    set((s) => {
      const next = !s.aiPoppedOut;
      localStorage.setItem("pcapgo-ai-popped-out", JSON.stringify(next));
      return { aiPoppedOut: next };
    }),

  setAiFloat: (g) => {
    localStorage.setItem("pcapgo-ai-float", JSON.stringify(g));
    set({ aiFloat: g });
  },
}));

// ── Capture ────────────────────────────────────────────────────────────

type SelectMode = "single" | "toggle" | "range";

interface CaptureStore {
  selectedPacketIdx: number | null;
  selectedIndices: number[];
  lastClickedIdx: number | null;
  filterProto: string;
  setSelectedPacket: (idx: number | null) => void;
  selectPacket: (idx: number, mode: SelectMode, pageIndices?: number[]) => void;
  setSelection: (indices: number[], anchor: number | null) => void;
  clearSelection: () => void;
  setFilterProto: (proto: string) => void;
}

export const useCaptureStore = create<CaptureStore>((set, get) => ({
  selectedPacketIdx: null,
  selectedIndices: [],
  lastClickedIdx: null,
  filterProto: "",

  setSelectedPacket: (idx) =>
    set({
      selectedPacketIdx: idx,
      selectedIndices: idx != null ? [idx] : [],
      lastClickedIdx: idx,
    }),

  selectPacket: (idx, mode, pageIndices) => {
    const state = get();
    switch (mode) {
      case "single":
        set({
          selectedPacketIdx: idx,
          selectedIndices: [idx],
          lastClickedIdx: idx,
        });
        break;

      case "toggle": {
        const current = new Set(state.selectedIndices);
        if (current.has(idx)) {
          current.delete(idx);
        } else {
          current.add(idx);
        }
        const arr = [...current].sort((a, b) => a - b);
        set({
          selectedPacketIdx: idx,
          selectedIndices: arr,
          lastClickedIdx: idx,
        });
        break;
      }

      case "range": {
        const anchor = state.lastClickedIdx;
        if (anchor == null || !pageIndices) {
          set({
            selectedPacketIdx: idx,
            selectedIndices: [idx],
            lastClickedIdx: idx,
          });
          break;
        }
        const startPos = pageIndices.indexOf(anchor);
        const endPos = pageIndices.indexOf(idx);
        if (startPos < 0 || endPos < 0) {
          set({
            selectedPacketIdx: idx,
            selectedIndices: [idx],
            lastClickedIdx: idx,
          });
          break;
        }
        const lo = Math.min(startPos, endPos);
        const hi = Math.max(startPos, endPos);
        const rangeIndices = pageIndices.slice(lo, hi + 1);
        set({
          selectedPacketIdx: idx,
          selectedIndices: rangeIndices,
          lastClickedIdx: idx,
        });
        break;
      }
    }
  },

  setSelection: (indices, anchor) =>
    set({
      selectedPacketIdx: anchor,
      selectedIndices: indices,
      lastClickedIdx: anchor,
    }),

  clearSelection: () =>
    set({
      selectedPacketIdx: null,
      selectedIndices: [],
      lastClickedIdx: null,
    }),

  setFilterProto: (proto) =>
    set({
      filterProto: proto,
      selectedPacketIdx: null,
      selectedIndices: [],
      lastClickedIdx: null,
    }),
}));
