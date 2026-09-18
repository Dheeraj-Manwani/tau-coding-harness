import type { JobStatus } from "@/src/stores/useProjectStore";

export type EmptyPreviewAction = "add_credits" | "continue" | "stop";

export interface EmptyPreviewState {
  title: string;
  description?: string;
  action?: EmptyPreviewAction;
  actionLabel?: string;
  animated: boolean;
  tone: "neutral" | "warning" | "error";
}

interface EmptyPreviewInput {
  status: JobStatus;
  hydrated: boolean;
  activity: string | null;
  isStalled: boolean;
  interruptedForCredits: boolean;
  availableCredits: number | undefined;
}

function withEllipsis(value: string): string {
  return /[.!?…]$/.test(value) ? value : `${value}…`;
}

/** Derive the no-iframe screen from durable project state, not assumptions. */
export function getEmptyPreviewState({
  status,
  hydrated,
  activity,
  isStalled,
  interruptedForCredits,
  availableCredits,
}: EmptyPreviewInput): EmptyPreviewState {
  // The transcript is authoritative for this terminal reason and survives a
  // reload, unlike the in-memory JobStatus.
  if (interruptedForCredits) {
    if (availableCredits === undefined) {
      return {
        title: "Build paused",
        description: "Checking your credit balance…",
        animated: false,
        tone: "warning",
      };
    }
    if (availableCredits > 0) {
      return {
        title: "Credits restored",
        description: "Continue the build from exactly where tau stopped.",
        action: "continue",
        actionLabel: "Continue building",
        animated: false,
        tone: "neutral",
      };
    }
    return {
      title: "Build paused — out of credits",
      description: "Add credits to continue without losing the work already completed.",
      action: "add_credits",
      actionLabel: "Add credits",
      animated: false,
      tone: "warning",
    };
  }

  if (!hydrated && status === "idle") {
    return {
      title: "Loading project…",
      animated: true,
      tone: "neutral",
    };
  }

  if (status === "streaming") {
    if (isStalled) {
      return {
        title: "Build may be stuck",
        description: "tau has not reported progress for a while.",
        action: "stop",
        actionLabel: "Stop build",
        animated: false,
        tone: "warning",
      };
    }
    return {
      title: withEllipsis(activity?.trim() || "tau is building your app"),
      animated: true,
      tone: "neutral",
    };
  }

  if (status === "cancelled") {
    return {
      title: "Build stopped",
      description: "Continue whenever you are ready; completed work is still saved.",
      action: "continue",
      actionLabel: "Continue building",
      animated: false,
      tone: "neutral",
    };
  }

  if (status === "error") {
    return {
      title: "Build stopped with an error",
      description: "Ask tau to inspect the existing work and try again.",
      action: "continue",
      actionLabel: "Try again",
      animated: false,
      tone: "error",
    };
  }

  if (status === "done") {
    return {
      title: "No preview was created",
      description: "Continue the task and ask tau to finish a runnable preview.",
      action: "continue",
      actionLabel: "Finish the app",
      animated: false,
      tone: "neutral",
    };
  }

  return {
    title: "No preview yet",
    description: "Describe what you want to build in the chat.",
    animated: false,
    tone: "neutral",
  };
}
