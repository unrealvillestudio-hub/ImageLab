
import { create } from "zustand";

export type SessionOutput = {
  id: string;
  module: "promptpack" | "tools" | "customize"; // Unified 'tools' for simplicity or granular
  createdAt: number;
  label?: string;
  title?: string; // Legacy compat
  outputTag?: string;
  aspect?: string;
  w?: number;
  h?: number;
  imageUrl: string;   // full
  dataUrl?: string;   // Legacy compat alias for imageUrl
  thumbUrl?: string;  // optional
  metadata?: any;
};

type State = {
  max: number;
  items: SessionOutput[];
  push: (o: SessionOutput) => void;
  discard: (id: string) => void;
  clear: () => void;
};

export const useSessionOutputsStore = create<State>((set, get) => ({
  max: 30,
  items: [],
  push: (o) =>
    set((s) => {
      // Normalize dataUrl/imageUrl
      const item = { ...o, imageUrl: o.imageUrl || o.dataUrl || "", title: o.title || o.label };
      const next = [item, ...s.items].slice(0, s.max);
      return { ...s, items: next };
    }),
  discard: (id) => set((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) })),
  clear: () => set((s) => ({ ...s, items: [] })),
}));
