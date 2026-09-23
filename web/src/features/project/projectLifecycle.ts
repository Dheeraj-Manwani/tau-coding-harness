import type { ProjectDetail, TerminalOutcome } from "./types";

export type RestoredJobStatus = "idle" | "streaming" | "done" | "error" | "cancelled";

/** Convert the server's durable job snapshot into the project's visible state. */
export function lifecycleFromDetail(detail: ProjectDetail) {
  const job = detail.jobState;
  if (detail.activeJobId) {
    const pendingQuestion = job?.id === detail.activeJobId
      ? job.pendingQuestion
      : null;
    const isPreviewJob = job?.type === "PREVIEW" || job?.type === "DEPLOY";
    return {
      currentJobId: detail.activeJobId,
      status: "streaming" as RestoredJobStatus,
      terminalOutcome: null as TerminalOutcome | null,
      pendingQuestion,
      isPreviewJob,
      isAiTyping: !pendingQuestion && !isPreviewJob,
      activity: pendingQuestion || isPreviewJob
        ? null
        : job?.phase === "queued" ? "Queued" : "Thinking",
      lastEventAt: Date.now(),
    };
  }

  let status: RestoredJobStatus = "idle";
  let terminalOutcome: TerminalOutcome | null = null;
  if (job?.status === "CANCELLED") {
    status = "cancelled";
    terminalOutcome = { kind: "cancelled" };
  } else if (job?.status === "FAILED") {
    status = "error";
    terminalOutcome = { kind: "error", message: job.error ?? "This run stopped unexpectedly." };
  } else if (job?.status === "COMPLETED") {
    if (job.finishReason === "BUDGET" || job.finishReason === "INSUFFICIENT_CREDITS") {
      status = "error";
      terminalOutcome = {
        kind: "credits",
        reason: job.finishReason === "BUDGET" ? "budget" : "balance",
      };
    } else {
      status = "done";
      terminalOutcome = { kind: "done" };
    }
  }
  return {
    currentJobId: null,
    status,
    terminalOutcome,
    pendingQuestion: null,
    isPreviewJob: false,
    isAiTyping: false,
    activity: null,
    lastEventAt: null,
  };
}
