import { create } from "zustand";

export const useFeedbackStore = create<{
  isOpen: boolean;
  submitting: boolean;
  source: "account" | "preview";
  projectId?: string;
  open: (source?: "account" | "preview", projectId?: string) => void;
  close: () => void;
}>((set, get) => ({
  isOpen: false,
  submitting: false,
  source: "account",
  open: (source = "account", projectId) => set({ isOpen: true, source, projectId }),
  close: () => { if (!get().submitting) set({ isOpen: false }); },
}));
