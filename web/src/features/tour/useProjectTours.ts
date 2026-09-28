import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useSettings } from "@/src/hooks/useSettings";
import { useProjectStore } from "@/src/stores/useProjectStore";
import { useSettingsStore } from "@/src/stores/useSettingsStore";
import type { TourId, TourOutcome } from "@/src/features/settings/preferences";
import {
  availableSteps,
  pickTour,
  TOUR_VERSIONS,
  type TourGate,
  type TourStepDef,
} from "@/src/features/tour/tours";

/** Below this the split workspace is cramped and the tour would cover it. */
const WIDE_QUERY = "(min-width: 1024px)";
/** Let the workspace spring in (and a chained tour breathe) before starting. */
const SETTLE_MS = 900;
/** Re-check cadence while an unrelated dialog is in the way. */
const RETRY_MS = 1000;
/** Older sandboxes never announce the element-picker runtime; don't wait on
 *  it forever, just tour without that step. */
const PREVIEW_GRACE_MS = 4000;

const OPEN_DIALOG = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export interface RunningTour {
  id: TourId;
  steps: TourStepDef[];
  /** Changes on every start, so a replay remounts a fresh tour. */
  key: number;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * True once a preview is loaded and its toolbar is complete: the picker's
 * runtime has checked in, or it has had PREVIEW_GRACE_MS to.
 */
function usePreviewReady(): boolean {
  const previewUrl = useProjectStore((s) => s.previewUrl);
  const visualEditReady = useProjectStore((s) => s.visualEditReady);
  const [graceElapsedFor, setGraceElapsedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!previewUrl) return;
    const timer = setTimeout(() => setGraceElapsedFor(previewUrl), PREVIEW_GRACE_MS);
    return () => clearTimeout(timer);
  }, [previewUrl]);

  return Boolean(previewUrl) && (visualEditReady || graceElapsedFor === previewUrl);
}

/**
 * Decides when a project tour runs and records how it ended.
 *
 * Finishing and skipping both count as seen: a tour the user closed should not
 * come back. Leaving the page mid-tour records nothing, so it shows next time.
 */
export function useProjectTours(layout: TourGate["layout"]) {
  const { hasSeenMotionIntro, tours, recordTour } = useSettings();
  const request = useSettingsStore((s) => s.tourRequest);
  const clearTourRequest = useSettingsStore((s) => s.clearTourRequest);
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const isChatOpen = useProjectStore((s) => s.isChatOpen);
  const activeTab = useProjectStore((s) => s.activeTab);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const pendingQuestion = useProjectStore((s) => s.pendingQuestion);
  const themePanelOpen = useProjectStore((s) => s.themePanelOpen);
  const wide = useMediaQuery(WIDE_QUERY);
  const previewReady = usePreviewReady();

  const [running, setRunning] = useState<RunningTour | null>(null);

  const candidate = pickTour({
    request,
    wide,
    layout,
    hasSeenMotionIntro,
    tours,
    blocked: pendingQuestion !== null || themePanelOpen || settingsOpen,
    isChatOpen,
    activeTab,
    previewReady,
  });

  // A replay asked for from Settings: the preview tour's targets only render
  // on the Preview tab, and a replay that can't run should say why.
  useEffect(() => {
    if (!request) return;
    if (request === "preview") setActiveTab("preview");
    if (!wide) {
      toast("Tours need a wider window");
      clearTourRequest();
    }
  }, [request, wide, setActiveTab, clearTourRequest]);

  useEffect(() => {
    if (running || !candidate) return;
    const isReplay = request === candidate;
    let timer: ReturnType<typeof setTimeout>;

    const attempt = () => {
      // Another dialog (delete, deploy, …) owns the screen; wait it out.
      if (document.querySelector(OPEN_DIALOG)) {
        timer = setTimeout(attempt, RETRY_MS);
        return;
      }
      const steps = availableSteps(candidate);
      if (isReplay) clearTourRequest();
      if (steps.length === 0) {
        if (isReplay) toast("Nothing to show yet: try again once tau has built a preview");
        return;
      }
      setRunning({ id: candidate, steps, key: Date.now() });
    };

    timer = setTimeout(attempt, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [candidate, running, request, clearTourRequest]);

  const end = useCallback(
    (id: TourId, outcome: TourOutcome) => {
      recordTour(id, TOUR_VERSIONS[id], outcome);
      setRunning(null);
    },
    [recordTour],
  );

  return { running, end };
}
