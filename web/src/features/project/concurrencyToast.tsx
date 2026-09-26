import toast from "react-hot-toast";

import { cancelAllJobs } from "@/src/features/project/api";

/**
 * The 429 shown when the user already has the maximum number of generations
 * running. Unlike a plain `toast.error`, this one offers a "Stop all running"
 * action that cancels every in-flight job so the slot frees up and the user can
 * retry immediately instead of waiting for the running one to finish.
 *
 * Shared by both composers (Home + project chat) so the message and behaviour
 * stay in one place.
 */
export function showConcurrentJobLimitToast(): void {
  toast.error(
    (t) => (
      <div className="flex flex-col gap-2">
        <span>
          Tau is already busy with as many builds as your plan allows.
        </span>
        <button
          type="button"
          onClick={() => {
            toast.dismiss(t.id);
            void toast.promise(cancelAllJobs(), {
              loading: "Stopping your active builds…",
              success: ({ cancelled }) =>
                cancelled > 0
                  ? `Stopped ${cancelled} active build${cancelled === 1 ? "" : "s"}. You can start a new one now.`
                  : "There were no active builds to stop.",
              error: "Couldn't stop your active builds. Please try again.",
            });
          }}
          className="self-start rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-brand/90"
        >
          Stop all running
        </button>
      </div>
    ),
    { duration: 8000 },
  );
}
