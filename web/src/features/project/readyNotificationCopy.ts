import type { TerminalOutcome } from "@/src/features/project/types";
import type { JobStatus } from "@/src/stores/useProjectStore";

export type ReadyNotificationCopy = {
  title: string;
  body: string;
};

function concise(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "Open Tau to see what went wrong.";
  return normalized.length > 160
    ? `${normalized.slice(0, 157).trimEnd()}…`
    : normalized;
}

export function getInputNotificationCopy(question: string): ReadyNotificationCopy {
  return {
    title: "Tau needs your input",
    body: concise(question),
  };
}

/** User-facing copy for every meaningful way an active run can end. */
export function getReadyNotificationCopy(
  outcome: TerminalOutcome | null,
  status: JobStatus,
): ReadyNotificationCopy | null {
  if (outcome?.kind === "done" || (!outcome && status === "done")) {
    return {
      title: "Your Tau project is ready",
      body: "Tau has finished working on your project.",
    };
  }

  if (outcome?.kind === "credits") {
    return outcome.reason === "budget"
      ? {
          title: "Tau reached this run’s limit",
          body: "Send another message to continue where it left off.",
        }
      : {
          title: "Tau stopped — credits ran out",
          body: "Add credits, then send another message to continue.",
        };
  }

  if (outcome?.kind === "cancelled" || (!outcome && status === "cancelled")) {
    return {
      title: "Tau stopped",
      body: "The run was cancelled before it finished.",
    };
  }

  if (outcome?.kind === "error") {
    return {
      title: "Tau couldn’t finish",
      body: concise(outcome.message),
    };
  }

  if (status === "error") {
    return {
      title: "Tau couldn’t finish",
      body: "Open Tau to see what went wrong.",
    };
  }

  return null;
}
