import type { JobStatus } from "@/src/stores/useProjectStore";

export const READY_NOTIFICATION_PROMPT_DELAY_MS = 5_000;

type ReadyNotificationPromptState = {
  currentJobId: string | null;
  thresholdJobId: string | null;
  status: JobStatus;
  notificationsEnabled: boolean;
  permissionGranted: boolean;
  supported: boolean;
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
  notificationsEnabled,
  permissionGranted,
  supported,
}: ReadyNotificationPromptState): boolean {
  return Boolean(
    currentJobId &&
      thresholdJobId === currentJobId &&
      status === "streaming" &&
      supported &&
      (!notificationsEnabled || !permissionGranted),
  );
}
