/**
 * Starting a chat turn, in one place.
 *
 * There are two senders now — the composer and the visual-edit inspector — and
 * a send is more than a POST: an optimistic bubble that has to be rolled back,
 * a job to start streaming, and three failure modes that each need their own
 * treatment (out of credits, too many concurrent jobs, a generation already
 * running). A second copy of that would not stay a copy; it would miss the next
 * fix to the first, and the way anyone would find out is a user hitting the
 * out-of-credits case from the inspector and getting a generic toast.
 *
 * What stays with the caller is what the caller owns: its draft, its
 * attachments, and putting both back if the send fails (`onFailed`).
 *
 * See doc/VISUAL_EDIT_PROMPTING.md §3 Phase 8.0.
 */
import toast from "react-hot-toast";

import { currentEffort } from "@/src/features/composer/useEffortChoice";
import { useAddMessage } from "@/src/features/project/api";
import { showConcurrentJobLimitToast } from "@/src/features/project/concurrencyToast";
import { useBillingStore } from "@/src/features/billing/useBillingStore";
import { ApiError } from "@/src/lib/api-client";
import { useProjectStore } from "@/src/stores/useProjectStore";
import type {
  Effort,
  MessageAttachment,
  VisualMessageContext,
} from "@/src/features/project/types";

export interface SendMessageOptions {
  /** Defaults to the shared effort choice — see `useEffortChoice`. */
  effort?: Effort;
  attachmentIds?: string[];
  /** Chips to render on the optimistic bubble, so an attachment-only turn
   *  doesn't show as a bare timestamp until the next reload. */
  attachments?: MessageAttachment[];
  /** The element this message is about. The API renders it into a block the
   *  model reads; the bubble shows a chip for it and nothing else. */
  visualContext?: VisualMessageContext;
  /** Ran after the optimistic bubble has been removed, so the caller can
   *  restore whatever it cleared before calling. */
  onFailed?: () => void;
}

export function useSendMessage(projectId: string | undefined) {
  const status = useProjectStore((s) => s.status);
  const appendUserMessage = useProjectStore((s) => s.appendUserMessage);
  const removeChatMessage = useProjectStore((s) => s.removeChatMessage);
  const startJob = useProjectStore((s) => s.startJob);
  const openOutOfCredits = useBillingStore((s) => s.open);
  const addMessage = useAddMessage(projectId ?? "");

  const isSending = addMessage.isPending;
  const canSend = Boolean(projectId) && status !== "streaming" && !isSending;

  /**
   * Fire a turn. Returns false when nothing was sent — the caller is blocked,
   * or there was nothing to send — so it can keep its draft.
   */
  const send = (content: string, options: SendMessageOptions = {}): boolean => {
    const attachmentIds = options.attachmentIds ?? [];
    if (!canSend || !projectId) return false;
    if (!content && attachmentIds.length === 0) return false;

    const messageId = appendUserMessage(
      content,
      options.attachments,
      options.visualContext,
    );

    // `mutateAsync` with our own promise chain, deliberately, rather than the
    // callbacks `mutate` takes: those belong to the mutation *observer* and are
    // dropped if the component unmounts first. The inspector clears its
    // selection the moment a send is accepted, so it is always gone before the
    // request lands — and with `mutate` that would mean `startJob` never
    // running, leaving an optimistic bubble above a job nothing is streaming.
    void addMessage
      .mutateAsync({
        message: content,
        effort: options.effort ?? currentEffort(),
        attachmentIds,
        ...(options.visualContext
          ? { visualContext: options.visualContext }
          : {}),
      })
      .then(({ jobId }) => startJob(jobId, content))
      .catch((err: unknown) => {
        removeChatMessage(messageId);
        options.onFailed?.();

        if (err instanceof ApiError && err.status === 402) {
          openOutOfCredits();
        } else if (err instanceof ApiError && err.status === 429) {
          showConcurrentJobLimitToast();
        } else {
          toast.error(
            err instanceof ApiError && err.status === 409
              ? "A generation is already in progress."
              : err instanceof ApiError
                ? err.message
                : "Couldn't send your message",
          );
        }
      });

    return true;
  };

  return { send, isSending, canSend };
}
