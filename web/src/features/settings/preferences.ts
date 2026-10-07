/**
 * Account-level preferences: the half of Settings that follows the *person*
 * across devices. Stored server-side (one jsonb column on User), delivered on
 * `GET /auth/me`, written through `PATCH /account/preferences`.
 *
 * The `/auth/me` query cache is the client's source of truth, so there is no
 * second copy to drift: writes patch that cache optimistically, then replace it
 * with what the server merged. Device-local settings live in useSettingsStore.
 */
import { useMutation } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";
import { queryClient } from "@/src/lib/query-client";
import { authKeys, useMe } from "@/src/features/auth/queries";
import type { AuthUser } from "@/src/features/auth/types";
import type { DesignConfig } from "@/src/features/design/api";
import type { Effort } from "@/src/features/project/types";

export type TourId = "workspace" | "preview";
export type TourOutcome = "completed" | "skipped";

export interface TourRecord {
  version: number;
  outcome: TourOutcome;
  /** ISO time, stamped by the server. */
  at: string;
}

export interface Preferences {
  /** User-forced calm mode. OR'd with the OS `prefers-reduced-motion`. */
  reduceMotion?: boolean;
  /** Whether the first-visit "reduce motion" intro popover has been dismissed. */
  hasSeenMotionIntro?: boolean;
  /** Last effort the user explicitly picked. Absent until they pick one, which
   *  is what lets the plan default apply (see useEffortChoice). */
  lastEffort?: Effort;
  tours?: Partial<Record<TourId, TourRecord>>;
  /** Standing instructions for everything the user builds, in their own
   *  words. tau reads them with every request. Absent when none are set. */
  instructions?: string;
  /** The look new projects start from unless another is chosen. */
  defaultDesign?: DefaultDesign;
}

/** A default look is a choice of style, colour and feel; never an imported
 *  `DESIGN.md`, which belongs to the project it was written for. */
export type DefaultDesign = Omit<DesignConfig, "designMd">;

export interface PreferencesPatch {
  reduceMotion?: boolean;
  hasSeenMotionIntro?: boolean;
  lastEffort?: Effort;
  tours?: Partial<Record<TourId, Pick<TourRecord, "version" | "outcome">>>;
  /** An empty string clears them. */
  instructions?: string;
  /** Replaced whole; `null` clears it. */
  defaultDesign?: DefaultDesign | null;
}

const EMPTY: Preferences = {};

/**
 * The same merge the server runs: top-level keys replace, `tours` merges one
 * level deeper, and a cleared value reads back as not set. Used for the
 * optimistic cache write.
 */
export function mergePreferences(
  prev: Preferences,
  patch: PreferencesPatch,
  now: Date = new Date(),
): Preferences {
  const { tours, instructions, defaultDesign, ...top } = patch;
  const next: Preferences = { ...prev, ...top };
  if (instructions !== undefined) {
    const text = instructions.trim();
    if (text) next.instructions = text;
    else delete next.instructions;
  }
  if (defaultDesign !== undefined) {
    if (defaultDesign && Object.keys(defaultDesign).length > 0) {
      next.defaultDesign = defaultDesign;
    } else {
      delete next.defaultDesign;
    }
  }
  if (tours) {
    const stamped: Partial<Record<TourId, TourRecord>> = {};
    for (const [id, result] of Object.entries(tours) as [
      TourId,
      Pick<TourRecord, "version" | "outcome"> | undefined,
    ][]) {
      if (result) stamped[id] = { ...result, at: now.toISOString() };
    }
    next.tours = { ...prev.tours, ...stamped };
  }
  return next;
}

type MeCache = { user: AuthUser } | undefined;

function writeCache(preferences: Preferences): void {
  queryClient.setQueryData<MeCache>(authKeys.me, (old) =>
    old ? { user: { ...old.user, preferences } } : old,
  );
}

/** Current preferences, read outside React. Empty until `/auth/me` resolves. */
export function getPreferences(): Preferences {
  const cached = queryClient.getQueryData<MeCache>(authKeys.me);
  return cached?.user.preferences ?? EMPTY;
}

export function usePreferences(): Preferences {
  const { data: user } = useMe();
  return user?.preferences ?? EMPTY;
}

/**
 * Optimistic preferences write. Mutations share a scope so they reach the
 * server in order: a slow first save can never land after, and overwrite, a
 * later one.
 */
export function useUpdatePreferences() {
  return useMutation({
    scope: { id: "preferences" },
    mutationFn: (patch: PreferencesPatch) =>
      api
        .patch<{ preferences: Preferences }>("/account/preferences", patch)
        .then((r) => r.data.preferences),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: authKeys.me });
      const previous = getPreferences();
      writeCache(mergePreferences(previous, patch));
      return { previous };
    },
    retry: 2,
    onError: (_err, _patch, context) => {
      if (!context) return;
      // Roll back settings, but not tour records: undoing one would replay a
      // tour the user just dismissed. It re-shows next session at worst.
      writeCache({ ...context.previous, tours: getPreferences().tours });
    },
    onSuccess: (preferences) => writeCache(preferences),
  });
}
