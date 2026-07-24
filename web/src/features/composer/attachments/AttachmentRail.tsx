import { useState } from "react";

import { cn } from "@/src/lib/utils";
import { AttachmentChip } from "./AttachmentChip";
import {
  draftToChip,
  messageAttachmentToChip,
  type ChipModel,
} from "./chipModel";
import { AttachmentModal, type PreviewTarget } from "./AttachmentModal";
import type { AttachmentDraft, MessageAttachment } from "./types";

function chipToTarget(
  chip: ChipModel,
  sizeBytes: number,
  localText?: string,
): PreviewTarget {
  return {
    id: chip.id,
    kind: chip.kind,
    filename: chip.filename,
    mimeType: chip.mimeType,
    sizeBytes,
    localUrl: chip.localUrl,
    localText,
  };
}

/** The composer rail — editable chips for attachments not yet sent. */
export function AttachmentRail({
  attachments,
  onRemove,
  className,
}: {
  attachments: AttachmentDraft[];
  onRemove: (key: string) => void;
  className?: string;
}) {
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <div
        className={cn(
          "scrollbar-thin mb-2 flex gap-2 overflow-x-auto px-1 pt-1",
          className,
        )}
      >
        {attachments.map((a) => {
          const chip = draftToChip(a);
          return (
            <AttachmentChip
              key={a.key}
              chip={chip}
              onOpen={() =>
                setPreview(
                  chipToTarget(
                    chip,
                    a.sizeBytes,
                    // A just-pasted chip has its text locally; skip the fetch.
                    a.kind === "PASTED" && a.id === null
                      ? (a.preview ?? "")
                      : undefined,
                  ),
                )
              }
              onRemove={() => onRemove(a.key)}
            />
          );
        })}
      </div>
      <AttachmentModal target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

/** The transcript rail — read-only chips under a sent user bubble. */
export function MessageAttachmentRail({
  attachments,
}: {
  attachments: MessageAttachment[];
}) {
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <div className="scrollbar-thin flex flex-wrap justify-end gap-2">
        {attachments.map((a) => {
          const chip = messageAttachmentToChip(a);
          return (
            <AttachmentChip
              key={a.id}
              chip={chip}
              onOpen={() => setPreview(chipToTarget(chip, a.sizeBytes))}
            />
          );
        })}
      </div>
      <AttachmentModal target={preview} onClose={() => setPreview(null)} />
    </>
  );
}
