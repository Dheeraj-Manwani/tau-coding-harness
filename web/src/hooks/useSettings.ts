import { useCallback } from "react";

import {
  usePreferences,
  useUpdatePreferences,
  type DefaultDesign,
  type TourId,
  type TourOutcome,
} from "@/src/features/settings/preferences";
import type { Effort } from "@/src/features/project/types";
import { useSettingsStore } from "@/src/stores/useSettingsStore";

/**
 * One read/write surface for every user setting, wherever it is stored.
 *
 *   account (server, follows the user): reduceMotion, hasSeenMotionIntro,
 *                                       lastEffort, tours, instructions,
 *                                       defaultDesign
 *   device  (localStorage):             notifyWhenReady, notificationSound
 *
 * Callers should not need to know which is which; moving a setting between the
 * two is a change here, not at every call site.
 */
export function useSettings() {
  const preferences = usePreferences();
  const { mutate } = useUpdatePreferences();
  const notifyWhenReady = useSettingsStore((s) => s.notifyWhenReady);
  const setNotifyWhenReady = useSettingsStore((s) => s.setNotifyWhenReady);
  const notificationSound = useSettingsStore((s) => s.notificationSound);
  const setNotificationSound = useSettingsStore((s) => s.setNotificationSound);

  const setReduceMotion = useCallback(
    (reduceMotion: boolean) => mutate({ reduceMotion }),
    [mutate],
  );
  const markMotionIntroSeen = useCallback(
    (options?: { reduceMotion?: boolean }) =>
      mutate({ hasSeenMotionIntro: true, ...options }),
    [mutate],
  );
  const setLastEffort = useCallback(
    (lastEffort: Effort) => mutate({ lastEffort }),
    [mutate],
  );
  const recordTour = useCallback(
    (id: TourId, version: number, outcome: TourOutcome) =>
      mutate({ tours: { [id]: { version, outcome } } }),
    [mutate],
  );
  const setInstructions = useCallback(
    (instructions: string) => mutate({ instructions: instructions.trim() }),
    [mutate],
  );
  // Null clears it: new projects go back to tau deciding.
  const setDefaultDesign = useCallback(
    (defaultDesign: DefaultDesign | null) => mutate({ defaultDesign }),
    [mutate],
  );

  return {
    reduceMotion: preferences.reduceMotion ?? false,
    hasSeenMotionIntro: preferences.hasSeenMotionIntro ?? false,
    lastEffort: preferences.lastEffort ?? null,
    tours: preferences.tours ?? {},
    instructions: preferences.instructions ?? "",
    defaultDesign: preferences.defaultDesign ?? null,
    notifyWhenReady,
    notificationSound,

    setReduceMotion,
    markMotionIntroSeen,
    setLastEffort,
    recordTour,
    setInstructions,
    setDefaultDesign,
    setNotifyWhenReady,
    setNotificationSound,
  };
}
