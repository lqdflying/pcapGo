import { create } from "zustand";
import type { User } from "../api/client";

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

interface CaptureStore {
  selectedPacketIdx: number | null;
  filterProto: string;
  setSelectedPacket: (idx: number | null) => void;
  setFilterProto: (proto: string) => void;
}

export const useCaptureStore = create<CaptureStore>((set) => ({
  selectedPacketIdx: null,
  filterProto: "",
  setSelectedPacket: (idx) => set({ selectedPacketIdx: idx }),
  setFilterProto: (proto) => set({ filterProto: proto, selectedPacketIdx: null }),
}));
