import { create } from "zustand";

export const useSupportStore = create<{
  isOpen: boolean;
  open: () => void;
  setOpen: (isOpen: boolean) => void;
}>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  setOpen: (isOpen) => set({ isOpen }),
}));
