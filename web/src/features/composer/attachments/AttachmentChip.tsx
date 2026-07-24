import { useEffect, useState } from "react";
import { AlertCircleIcon, FileTextIcon, Loader2Icon, XIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { getAttachmentUrl } from "./api";
import { fileExtension } from "./types";
import type { ChipModel } from "./chipModel";

/** Prefers the local object URL; falls back to a presigned GET for chips
 *  restored from the server. */
function useThumbnail(chip: ChipModel): string | null {
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const needsRemote =
    chip.kind === "IMAGE" && !chip.localUrl && chip.id !== null;

  useEffect(() => {
    if (!needsRemote || !chip.id) return;
    let cancelled = false;
    void getAttachmentUrl(chip.id)
      .then(({ url }) => {
        if (!cancelled) setRemoteUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsRemote, chip.id]);

  return chip.localUrl ?? remoteUrl;
}

interface AttachmentChipProps {
  chip: ChipModel;
  onOpen: () => void;
  /** Omitted in the transcript, where chips are read-only. */
  onRemove?: () => void;
}

export function AttachmentChip({ chip, onOpen, onRemove }: AttachmentChipProps) {
  const thumbnail = useThumbnail(chip);
  const busy =
    chip.uploading || chip.status === "PENDING" || chip.status === "EXTRACTING";
  const failed = chip.status === "FAILED";

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        onClick={onOpen}
        title={chip.filename}
        className={cn(
          "relative flex h-16 overflow-hidden rounded-lg border text-left transition-colors",
          chip.kind === "PASTED" || chip.kind === "FILE" ? "w-40" : "w-16",
          failed
            ? "border-red-500/60 bg-red-500/5"
            : "border-silver-400/40 bg-space-overlay hover:border-silver-600/60",
        )}
      >
        {chip.kind === "IMAGE" &&
          (thumbnail ? (
            <img
              src={thumbnail}
              alt={chip.filename}
              className="size-full object-cover"
            />
          ) : (
            <div className="size-full bg-space-surface" />
          ))}

        {chip.kind === "PASTED" && (
          <div className="flex size-full flex-col justify-between p-1.5">
            <p className="overflow-hidden font-mono text-[9px] leading-[1.35] text-muted-foreground">
              {(chip.preview ?? "").slice(0, 180)}
            </p>
            <span className="w-fit rounded bg-space-surface px-1 py-px text-[8px] font-medium tracking-wide text-silver-600">
              PASTED
            </span>
          </div>
        )}

        {chip.kind === "FILE" && (
          <div className="flex size-full items-center gap-2 p-2">
            <FileTextIcon className="size-5 shrink-0 text-silver-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-foreground">
                {chip.filename}
              </p>
              <span className="mt-0.5 inline-block rounded bg-space-surface px-1 py-px text-[8px] font-medium tracking-wide text-silver-600">
                {fileExtension(chip.filename)}
              </span>
            </div>
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-space-void/60">
            <Loader2Icon className="size-4 animate-spin text-silver-600" />
          </div>
        )}
        {failed && (
          <div className="absolute right-1 bottom-1">
            <AlertCircleIcon className="size-3.5 text-red-400" />
          </div>
        )}
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${chip.filename}`}
          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-silver-400/40 bg-space-surface text-silver-600 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-silver-900"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
