import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Effort } from "@/src/features/project/types";
import type { TourId } from "@/src/features/settings/preferences";

/**
 * Device-local and transient settings only. Anything that should follow the
 * account across devices (motion, last effort, tours) is a server preference:
 * see features/settings/preferences.ts, and read both through `useSettings`.
 */
interface SettingsState {
  /** Automatically arm browser notifications when a project run starts.
   *  Per-device on purpose: notification permission is granted per browser. */
  notifyWhenReady: boolean;
  /** What this account's plan defaults to before the user has chosen (paid
   *  plans start at HIGH). Derived from the balance, so not persisted: and
   *  deliberately not written into `lastEffort`, where it would masquerade as a
   *  choice the user made and outlive their plan. */
  planDefault: Effort | null;
  /** Settings modal visibility (not persisted). */
  settingsOpen: boolean;
  /** A tour the user asked to replay from Settings (not persisted). */
  tourRequest: TourId | null;

  setNotifyWhenReady: (v: boolean) => void;
  setPlanDefault: (e: Effort) => void;
  openSettings: () => void;
  closeSettings: () => void;
  requestTour: (id: TourId) => void;
  clearTourRequest: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      notifyWhenReady: false,
      planDefault: null,
      settingsOpen: false,
      tourRequest: null,

      setNotifyWhenReady: (v) => set({ notifyWhenReady: v }),
      setPlanDefault: (e) => set({ planDefault: e }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      requestTour: (id) => set({ tourRequest: id, settingsOpen: false }),
      clearTourRequest: () => set({ tourRequest: null }),
    }),
    {
      name: "tau-settings",
      // v1 moved motion, motion intro and last effort to the server. Drop them
      // from storage so stale device values never shadow the account's.
      version: 1,
      migrate: (persisted) => ({
        notifyWhenReady:
          (persisted as { notifyWhenReady?: unknown } | null)?.notifyWhenReady ===
          true,
      }),
      partialize: (s) => ({ notifyWhenReady: s.notifyWhenReady }),
    },
  ),
);
