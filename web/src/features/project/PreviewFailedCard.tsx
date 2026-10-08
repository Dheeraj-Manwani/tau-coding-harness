import { RotateCwIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";

const COPY = {
  app: {
    title: "App crashed on start",
    description:
      "Your app hit an error before it could show anything. Your files are safe, and tau can find the cause and fix it.",
  },
  load: {
    title: "Preview didn't load",
    description:
      "The preview couldn't finish loading. Your project is saved, so give it another try.",
  },
};

/**
 * What the preview shows when its frame never came up, in the same storm voice
 * as `PreviewStoppedCard`. Pure presentation: `PreviewPane.tsx` keeps the
 * recovery state and the two actions, and lays this over the cover image.
 *
 * Two cases, told apart by `appError`. The app's own code failed (it threw
 * while starting, or did not compile): reloading alone will fail the same way,
 * so asking tau comes first. Or the frame simply did not load (a slow or
 * dropped connection to the sandbox): there is nothing to fix, only to retry.
 */
export function PreviewFailedCard({
  appError,
  onFix,
  onReload,
  canFix,
  isSending,
}: {
  appError: boolean;
  onFix: () => void;
  onReload: () => void;
  canFix: boolean;
  isSending: boolean;
}) {
  const copy = appError ? COPY.app : COPY.load;

  return (
    <div
      role="alert"
      className="relative flex flex-col items-center gap-4 px-6 text-center"
    >
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full border bg-space-overlay",
          appError
            ? "border-red-500/30 text-red-400 shadow-[0_0_30px_rgba(239,68,68,0.15)]"
            : "border-silver-400/30 text-silver-300 shadow-[0_0_30px_rgba(96,165,250,0.15)]",
        )}
      >
        {appError ? (
          <TriangleAlertIcon className="size-5" />
        ) : (
          <RotateCwIcon className="size-5" />
        )}
      </span>

      <div>
        <h2 className="display-heading text-3xl text-silver-900 sm:text-4xl">
          {copy.title}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-silver-600">
          {copy.description}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {appError && (
          <button
            type="button"
            onClick={onFix}
            disabled={!canFix}
            title={
              canFix
                ? "Ask tau to find and fix the error"
                : "tau is already working on something"
            }
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-blue-900 shadow-lg transition-[background-color,transform] hover:bg-blue-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-500 disabled:active:scale-100"
          >
            {isSending ? (
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : (
              <WrenchIcon className="size-4" />
            )}
            Ask tau to fix
          </button>
        )}
        <button
          type="button"
          onClick={onReload}
          className={cn(
            "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-[background-color,border-color,color,transform] active:scale-95",
            appError
              ? "border border-silver-400/30 text-silver-600 hover:border-silver-400/60 hover:text-silver-900"
              : "bg-blue-500 text-blue-900 shadow-lg hover:bg-blue-400",
          )}
        >
          <RotateCwIcon className="size-4" />
          Reload preview
        </button>
      </div>
    </div>
  );
}

export default PreviewFailedCard;
