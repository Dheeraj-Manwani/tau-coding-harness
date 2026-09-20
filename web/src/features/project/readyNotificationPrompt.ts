import type { JobStatus } from "@/src/stores/useProjectStore";

export const READY_NOTIFICATION_PROMPT_DELAY_MS = 5_000;

type ReadyNotificationPromptState = {
  currentJobId: string | null;
  thresholdJobId: string | null;
  status: JobStatus;
  notificationsEnabled: boolean;
  supported: boolean;
};

/**
 * The opt-in bar is only an invitation to enable the persisted setting. Browser
 * permission affects whether a notification can fire, but it must not make the
 * bar reappear while that setting is already on.
 */
export function shouldShowReadyNotificationPrompt({
  currentJobId,
  thresholdJobId,
  status,
  notificationsEnabled,
  supported,
}: ReadyNotificationPromptState): boolean {
  return Boolean(
    currentJobId &&
      thresholdJobId === currentJobId &&
      status === "streaming" &&
      supported &&
      !notificationsEnabled,
  );
}
