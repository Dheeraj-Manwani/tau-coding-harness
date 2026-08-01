import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Effort } from "@/src/features/project/types";

interface SettingsState {
  /** User-forced calm mode. OR'd with the OS `prefers-reduced-motion`. */
  reduceMotion: boolean;
  /** Whether the first-visit "reduce motion" intro popover has been dismissed. */
  hasSeenMotionIntro: boolean;
  /** Last effort the user explicitly picked, restored on next visit. Null until
   *  they pick one, which is what lets {@link planDefault} apply. */
  lastEffort: Effort | null;
  /** What this account's plan defaults to before the user has chosen (paid
   *  plans start at HIGH). Derived from the balance, so not persisted — and
   *  deliberately not written into `lastEffort`, where it would masquerade as a
   *  choice the user made and outlive their plan. */
  planDefault: Effort | null;
  /** Settings modal visibility (not persisted). */
  settingsOpen: boolean;

  setReduceMotion: (v: boolean) => void;
  markMotionIntroSeen: () => void;
  setLastEffort: (e: Effort) => void;
  setPlanDefault: (e: Effort) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

/**
 * Persisted client preferences. `reduceMotion`, `hasSeenMotionIntro` and
 * `lastEffort` survive reloads via localStorage; transient UI (`settingsOpen`)
 * does not.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      reduceMotion: false,
      hasSeenMotionIntro: false,
      lastEffort: null,
      planDefault: null,
      settingsOpen: false,

      setReduceMotion: (v) => set({ reduceMotion: v }),
      markMotionIntroSeen: () => set({ hasSeenMotionIntro: true }),
      setLastEffort: (e) => set({ lastEffort: e }),
      setPlanDefault: (e) => set({ planDefault: e }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
    }),
    {
      name: "tau-settings",
      partialize: (s) => ({
        reduceMotion: s.reduceMotion,
        hasSeenMotionIntro: s.hasSeenMotionIntro,
        lastEffort: s.lastEffort,
      }),
    },
  ),
);
