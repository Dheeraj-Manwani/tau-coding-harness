import { create } from "zustand";

interface BillingStore {
  outOfCreditsOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useBillingStore = create<BillingStore>((set) => ({
  outOfCreditsOpen: false,
  open: () => set({ outOfCreditsOpen: true }),
  close: () => set({ outOfCreditsOpen: false }),
}));
