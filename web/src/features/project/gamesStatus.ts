import {
  activityPhrase,
  getEmptyPreviewState,
  type EmptyPreviewInput,
} from "@/src/features/project/previewEmptyState";

export interface GamesStatus {
  tone: "working" | "done" | "attention" | "idle";
  label: string;
  /** Closes the games modal; absent while tau is still working. */
  actionLabel?: string;
}

/**
 * What the games modal's bottom bar says about the build behind it. It reads
 * the same project state as the empty preview screen so the two never
 * disagree, and adds the one case that screen never shows: a finished build
 * with a preview waiting.
 */
export function getGamesStatus({
  hasPreview,
  ...input
}: EmptyPreviewInput & { hasPreview: boolean }): GamesStatus {
  const empty = getEmptyPreviewState(input);

  if (empty.animated) {
    return { tone: "working", label: `tau is ${activityPhrase(empty.title)}` };
  }
  if (empty.loading) {
    return { tone: "working", label: empty.description ?? empty.title };
  }
  if (!input.interruptedForCredits && input.status === "done") {
    return hasPreview
      ? {
          tone: "done",
          label: "tau is done. Your preview is ready.",
          actionLabel: "View preview",
        }
      : { tone: "done", label: "tau is done.", actionLabel: "Back to tau" };
  }
  if (!input.interruptedForCredits && input.status === "idle") {
    return {
      tone: "idle",
      label: "tau isn't working on anything right now.",
      actionLabel: "Back to tau",
    };
  }
  // Waiting on an answer, stalled, stopped, failed or out of credits: all of
  // them need the user back in the chat.
  return { tone: "attention", label: empty.title, actionLabel: "Back to tau" };
}
