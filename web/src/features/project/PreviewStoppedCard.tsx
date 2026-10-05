import { PauseIcon, PlayIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";

const COPY: Record<string, { title: string; description: string }> = {
  stopped: {
    title: "Preview stopped",
    description:
      "Sandboxes pause when idle to save credits. Your files are safe, and restarting takes about ten seconds.",
  },
  restoring: {
    title: "Restoring preview",
    description: "Bringing your sandbox back - this takes a few seconds.",
  },
  checking: {
    title: "Checking preview",
    description: "Confirming your sandbox is still running.",
  },
  failed: {
    title: "Couldn't restore preview",
    description: "Something went wrong waking the sandbox. Give it another try.",
  },
};

/**
 * Bold "PREVIEW STOPPED" card, restyled to match the storm voice. Pure
 * presentation - `PreviewPane.tsx` keeps the restart mutation and the
 * surface-mode derivation; this only renders the state it's given.
 */
export function PreviewStoppedCard({
  mode,
  onStart,
  coverImageUrl,
}: {
  mode: "stopped" | "restoring" | "checking" | "failed";
  onStart: () => void;
  coverImageUrl: string | null;
}) {
  const starting = mode === "restoring" || mode === "checking";
  const copy = COPY[mode] ?? COPY.stopped!;

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-4 overflow-hidden bg-black px-6 text-center">
      {coverImageUrl && (
        <>
          <img
            src={coverImageUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full scale-110 object-cover object-top opacity-30 blur-md"
          />
          <div className="absolute inset-0 bg-black/85" />
        </>
      )}
      <div aria-hidden="true" className="rain-streaks" />

      <span
        className={cn(
          "relative flex size-14 items-center justify-center rounded-full border border-silver-400/30 bg-space-overlay text-silver-300 shadow-[0_0_30px_rgba(96,165,250,0.15)]",
        )}
      >
        {starting ? (
          <span
            aria-hidden
            className="size-5 animate-spin rounded-full border-2 border-silver-600 border-t-blue-400"
          />
        ) : mode === "failed" ? (
          <PlayIcon className="size-5" />
        ) : (
          <PauseIcon className="size-5" />
        )}
      </span>

      <div className="relative">
        <h2
          role={starting ? "status" : undefined}
          className="display-heading text-3xl text-silver-900 sm:text-4xl"
        >
          {copy.title}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-silver-600">
          {copy.description}
        </p>
      </div>

      {!starting && (
        <button
          type="button"
          onClick={onStart}
          className="relative flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-blue-900 shadow-lg transition-[background-color,transform] hover:bg-blue-400 active:scale-95"
        >
          <PlayIcon className="size-4 fill-current" />
          {mode === "failed" ? "Retry preview" : "Start preview"}
        </button>
      )}
    </div>
  );
}

export default PreviewStoppedCard;
