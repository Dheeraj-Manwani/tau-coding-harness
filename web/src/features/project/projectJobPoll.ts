import type { ProjectDetail, ProjectJobStatusResponse } from "./types";

interface CurrentJobView {
  currentJobId: string | null;
  pendingQuestion: { id: string } | null;
  isAiTyping: boolean;
}

/** A mismatch means the browser missed a transition and needs full project data. */
export function jobStatusNeedsResync(
  snapshot: ProjectJobStatusResponse,
  current: CurrentJobView,
): boolean {
  if (!snapshot.activeJobId || snapshot.activeJobId !== current.currentJobId) {
    return true;
  }
  if (!snapshot.jobType) return true;

  const shouldBeTyping =
    !snapshot.pendingQuestionId &&
    snapshot.jobType !== "PREVIEW" &&
    snapshot.jobType !== "DEPLOY";
  return snapshot.pendingQuestionId !== (current.pendingQuestion?.id ?? null) ||
    current.isAiTyping !== shouldBeTyping;
}

export function jobStatusFromDetail(detail: ProjectDetail): ProjectJobStatusResponse {
  return {
    activeJobId: detail.activeJobId,
    jobType: detail.activeJobId ? detail.jobState?.type ?? null : null,
    pendingQuestionId: detail.jobState?.pendingQuestion?.id ?? null,
  };
}
