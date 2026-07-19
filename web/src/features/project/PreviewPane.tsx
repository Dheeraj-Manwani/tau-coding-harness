import { useState } from "react";
import { motion } from "motion/react";
import { PlayIcon, PowerOffIcon } from "lucide-react";
import toast from "react-hot-toast";

import BorderGlow from "@/src/components/ui/glow-loader";
import { useProjectStore } from "@/src/stores/useProjectStore";
import {
  usePreviewStatus,
  useRestartPreview,
} from "@/src/features/project/api";
import { previewSrc } from "@/src/features/project/previewUrl";

const DEVICE_WIDTH: Record<string, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 9999,
};

function PreviewPlaceholder({ label }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center p-0">
      <BorderGlow
        autoAnimate
        autoAnimateDuration={3200}
        coneSpread={8}
        borderRadius={20}
        backgroundColor="var(--space-surface)"
        glowColor="253 91 85"
        colors={["#8b7bff", "#f472b6", "#38bdf8"]}
        glowRadius={32}
        glowIntensity={0.9}
        fillOpacity={0.3}
        className=" px-8 mx-0 py-5"
      >
        <div className="flex flex-col items-center gap-3">
          <span className="logo-mark size-12" role="img" aria-label="tau" />

          <div className="flex flex-col items-center  text-center">
            <span className="text-sm font-semibold text-(--silver-900)">
              {label ?? "tau is building your app…"}
            </span>
          </div>
        </div>
      </BorderGlow>
    </div>
  );
}

/** Shown when the live sandbox has gone down — lets the user reboot it from the
 *  persisted project files without spending a chat turn. While the restart is
 *  in flight the button itself shows the progress (no full-pane shimmer). */
function PreviewStopped({
  starting,
  onStart,
}: {
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-full bg-[var(--space-overlay)] text-[var(--silver-600)]">
        <PowerOffIcon className="size-4.5" />
      </span>
      <span className="text-xs text-[var(--silver-600)]">Preview stopped</span>
      <button
        type="button"
        disabled={starting}
        onClick={onStart}
        className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-brand px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-brand/90 active:scale-95 disabled:cursor-default disabled:hover:bg-brand"
      >
        {starting ? (
          <>
            <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Starting…
          </>
        ) : (
          <>
            <PlayIcon className="size-3.5" />
            Start preview
          </>
        )}
      </button>
    </div>
  );
}

export function PreviewPane({ device }: { device: string }) {
  const previewUrl = useProjectStore((s) => s.previewUrl);
  const previewPath = useProjectStore((s) => s.previewPath);
  const previewNonce = useProjectStore((s) => s.previewNonce);
  const projectId = useProjectStore((s) => s.projectId);
  const status = useProjectStore((s) => s.status);
  const currentJobId = useProjectStore((s) => s.currentJobId);
  const startPreviewJob = useProjectStore((s) => s.startPreviewJob);

  const isStreaming = status === "streaming";
  const restart = useRestartPreview(projectId ?? "");
  // Id of the restart job we launched; used to keep the "Starting…" state up
  // for the whole life of that job (it clears itself when currentJobId resets
  // to null on the terminal frame), without a setState-in-effect.
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);

  // Covers the click→dispatch gap and the whole streamed restart job.
  const starting =
    restart.isPending ||
    (previewJobId !== null && currentJobId === previewJobId);

  // Only probe liveness while a preview exists and nothing is actively
  // streaming (a running job means the sandbox is being managed already).
  const liveness = usePreviewStatus(projectId ?? undefined, {
    enabled: Boolean(previewUrl) && !isStreaming && !starting,
  });

  const isDown =
    Boolean(previewUrl) && !isStreaming && liveness.data?.alive === false;

  const src = previewSrc(previewUrl, previewPath);

  const handleStart = () => {
    if (!projectId || starting) return;
    restart.mutate(undefined, {
      onSuccess: ({ jobId }) => {
        setPreviewJobId(jobId);
        startPreviewJob(jobId);
      },
      onError: () => toast.error("Couldn't start the preview. Please try again."),
    });
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <motion.div
        animate={{ maxWidth: DEVICE_WIDTH[device] }}
        transition={{ type: "spring", stiffness: 200, damping: 26 }}
        className="relative h-full w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--silver-200)]"
        style={{ backgroundColor: "var(--space-void)" }}
      >
        {starting || isDown ? (
          <PreviewStopped starting={starting} onStart={handleStart} />
        ) : src ? (
          <iframe
            // The nonce is bumped by both reload and any path change, so the
            // frame remounts either way — re-entering the current path still
            // re-navigates instead of being a no-op.
            key={`${previewUrl}-${previewNonce}`}
            src={src}
            title="App preview"
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : (
          <PreviewPlaceholder />
        )}
      </motion.div>
    </div>
  );
}
