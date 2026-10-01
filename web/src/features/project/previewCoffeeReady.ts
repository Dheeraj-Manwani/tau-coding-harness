import type { JobStatus } from "@/src/stores/useProjectStore";

/** A revealed preview can be ready before thumbnail/cover work finishes. */
export function isCoffeePreviewReady({
  active, loaded, status, currentJobId, previewReadyJobId,
  starting, down, error, feedbackOpen, stalled, waitingForAnswer,
}: {
  active: boolean;
  loaded: boolean;
  status: JobStatus;
  currentJobId: string | null;
  previewReadyJobId: string | null;
  starting: boolean;
  down: boolean;
  error: boolean;
  feedbackOpen: boolean;
  stalled: boolean;
  waitingForAnswer: boolean;
}) {
  if (!active || !loaded || starting || down || error || feedbackOpen || stalled || waitingForAnswer) return false;
  if (status === "done" || status === "idle") return true;
  return status === "streaming" && currentJobId !== null && previewReadyJobId === currentJobId;
}
