import { create } from "zustand";

const DEFAULT_TITLE = "Upgrade to PRO";

interface UpgradeModalStore {
  open: boolean;
  title: string;
  /** Opens the modal. Pass a custom title to override the default copy. */
  openModal: (title?: string) => void;
  close: () => void;
}

export const useUpgradeModalStore = create<UpgradeModalStore>((set) => ({
  open: false,
  title: DEFAULT_TITLE,
  openModal: (title) => set({ open: true, title: title ?? DEFAULT_TITLE }),
  close: () => set({ open: false }),
}));
