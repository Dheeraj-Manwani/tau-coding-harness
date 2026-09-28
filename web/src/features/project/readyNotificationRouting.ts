import type { TerminalOutcome } from "@/src/features/project/types";
import type { JobStatus } from "@/src/stores/useProjectStore";

/**
 * The two rules behind every build alert: *whether* a run is worth telling the
 * user about, and *how loudly*, given where their attention is.
 *
 * Pure so every row of the behaviour table is a unit test rather than a manual
 * click-through. The hook (useReadyNotification) only gathers the inputs.
 */

type RunEnd = {
  /** The run that just ended was a preview restart or a deploy, not a build. */
  wasPreviewJob: boolean;
  /** This tab's user pressed Stop on exactly this job. */
  cancelledByUser: boolean;
  outcome: TerminalOutcome | null;
  status: JobStatus;
};

/**
 * Only builds notify. A preview restart is a ten-second chore the preview pane
 * already narrates, and a stop the user clicked needs no announcement.
 */
export function shouldNotifyForRun({
  wasPreviewJob,
  cancelledByUser,
  outcome,
  status,
}: RunEnd): boolean {
  if (wasPreviewJob) return false;
  const cancelled = outcome?.kind === "cancelled" || status === "cancelled";
  if (cancelled && cancelledByUser) return false;
  return true;
}

export type ChimeVolume = "soft" | "full";

export type Delivery = {
  sound: ChimeVolume | null;
  /** An OS notification. */
  system: boolean;
  /** Prefix the tab title until the user looks again. */
  badge: boolean;
};

type DeliveryInput = {
  /** The tab is visible *and* focused: the user is looking at this project. */
  attentive: boolean;
  /** Desktop notifications are on and the browser has granted permission. */
  systemEnabled: boolean;
  soundEnabled: boolean;
};

/**
 * Looking at the project: the chat and preview already show the result, so a
 * soft chime is the whole alert. Away (background tab, another window): a
 * system notification if allowed, the full chime, and a title badge that is
 * still there when they come back.
 */
export function chooseDelivery({
  attentive,
  systemEnabled,
  soundEnabled,
}: DeliveryInput): Delivery {
  if (attentive) {
    return { sound: soundEnabled ? "soft" : null, system: false, badge: false };
  }
  return {
    sound: soundEnabled ? "full" : null,
    system: systemEnabled,
    badge: true,
  };
}

/** Whether the user is looking at this tab right now. */
export function isUserAttentive(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}
