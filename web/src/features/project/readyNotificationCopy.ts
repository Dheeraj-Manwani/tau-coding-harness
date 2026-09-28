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

/** A project name fit for a notification title, or null to use generic copy. */
function titleName(projectName: string | null | undefined): string | null {
  const name = projectName?.replace(/\s+/g, " ").trim();
  if (!name) return null;
  return name.length > 40 ? `${name.slice(0, 39).trimEnd()}…` : name;
}

export function getInputNotificationCopy(
  question: string,
  projectName?: string | null,
): ReadyNotificationCopy {
  const name = titleName(projectName);
  return {
    title: name ? `${name} needs your input` : "Tau needs your input",
    body: concise(question),
  };
}

/** User-facing copy for every meaningful way an active run can end. */
export function getReadyNotificationCopy(
  outcome: TerminalOutcome | null,
  status: JobStatus,
  projectName?: string | null,
): ReadyNotificationCopy | null {
  const name = titleName(projectName);

  if (outcome?.kind === "done" || (!outcome && status === "done")) {
    return name
      ? { title: `${name} is ready`, body: "Tau has finished working on it." }
      : {
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
          title: "Tau stopped: credits ran out",
          body: "Add credits, then send another message to continue.",
        };
  }

  if (outcome?.kind === "cancelled" || (!outcome && status === "cancelled")) {
    return {
      title: name ? `Tau stopped working on ${name}` : "Tau stopped",
      body: "The run was cancelled before it finished.",
    };
  }

  const failedTitle = name ? `Tau couldn’t finish ${name}` : "Tau couldn’t finish";

  if (outcome?.kind === "error") {
    return {
      title: failedTitle,
      body: concise(outcome.message),
    };
  }

  if (status === "error") {
    return {
      title: failedTitle,
      body: "Open Tau to see what went wrong.",
    };
  }

  return null;
}
