import type { JobStatus } from "@/src/stores/useProjectStore";

/** Long enough that quick turns never see the bar: it is for runs worth
 *  walking away from. */
export const READY_NOTIFICATION_PROMPT_DELAY_MS = 20_000;

type ReadyNotificationPromptState = {
  currentJobId: string | null;
  thresholdJobId: string | null;
  status: JobStatus;
  /** Preview restarts and deploys are not builds; nothing to wait for. */
  isPreviewJob: boolean;
  notificationsEnabled: boolean;
  permissionGranted: boolean;
  supported: boolean;
  /** "Not now" hides the bar until this time (epoch ms). */
  snoozedUntil: number | null;
  now: number;
};

/**
 * The opt-in bar appears when either the saved preference is off or browser
 * permission has been lost. That lets the user repair a permission reset
 * instead of leaving notifications silently enabled but unable to fire.
 */
export function shouldShowReadyNotificationPrompt({
  currentJobId,
  thresholdJobId,
  status,
  isPreviewJob,
  notificationsEnabled,
  permissionGranted,
  supported,
  snoozedUntil,
  now,
}: ReadyNotificationPromptState): boolean {
  return Boolean(
    currentJobId &&
      thresholdJobId === currentJobId &&
      status === "streaming" &&
      !isPreviewJob &&
      supported &&
      (snoozedUntil === null || now >= snoozedUntil) &&
      (!notificationsEnabled || !permissionGranted),
  );
}
