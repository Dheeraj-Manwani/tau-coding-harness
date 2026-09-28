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
  /** Chime when a build finishes or needs input: soft while the user is looking
   *  at the project, full when they are away. Per-device, like the speakers. */
  notificationSound: boolean;
  /** Until when (epoch ms) the "Notify when ready?" bar stays hidden after the
   *  user chose "Not now". */
  notifyPromptSnoozedUntil: number | null;
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
  setNotificationSound: (v: boolean) => void;
  snoozeNotifyPrompt: () => void;
  setPlanDefault: (e: Effort) => void;
  openSettings: () => void;
  closeSettings: () => void;
  requestTour: (id: TourId) => void;
  clearTourRequest: () => void;
}

/** "Not now" on the notification opt-in hides it for this long. */
export const NOTIFY_PROMPT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      notifyWhenReady: false,
      notificationSound: true,
      notifyPromptSnoozedUntil: null,
      planDefault: null,
      settingsOpen: false,
      tourRequest: null,

      setNotifyWhenReady: (v) => set({ notifyWhenReady: v }),
      setNotificationSound: (v) => set({ notificationSound: v }),
      snoozeNotifyPrompt: () =>
        set({ notifyPromptSnoozedUntil: Date.now() + NOTIFY_PROMPT_SNOOZE_MS }),
      setPlanDefault: (e) => set({ planDefault: e }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      requestTour: (id) => set({ tourRequest: id, settingsOpen: false }),
      clearTourRequest: () => set({ tourRequest: null }),
    }),
    {
      name: "tau-settings",
      // v1 moved motion, motion intro and last effort to the server: dropping
      // them keeps stale device values from shadowing the account's. v2 added
      // the sound toggle and the prompt snooze, which start at their defaults.
      version: 2,
      migrate: (persisted) => {
        const old = (persisted ?? {}) as {
          notifyWhenReady?: unknown;
          notificationSound?: unknown;
          notifyPromptSnoozedUntil?: unknown;
        };
        return {
          notifyWhenReady: old.notifyWhenReady === true,
          notificationSound: old.notificationSound !== false,
          notifyPromptSnoozedUntil:
            typeof old.notifyPromptSnoozedUntil === "number"
              ? old.notifyPromptSnoozedUntil
              : null,
        };
      },
      partialize: (s) => ({
        notifyWhenReady: s.notifyWhenReady,
        notificationSound: s.notificationSound,
        notifyPromptSnoozedUntil: s.notifyPromptSnoozedUntil,
      }),
    },
  ),
);
