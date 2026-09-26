import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  completeUpload,
  createPaste,
  deleteAttachment,
  getAttachment,
  sha256Bytes,
  signUpload,
  uploadToR2,
} from "./api";
import type { AttachmentDraft } from "./types";

/** Mirrors ATTACHMENT_MAX_PER_MESSAGE in api/src/lib/env.ts. */
export const MAX_ATTACHMENTS = 5;
/** Mirror the server caps; these only exist to fail fast without a round trip. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const POLL_INTERVAL_MS = 1000;

let keyCounter = 0;
function nextKey(): string {
  return `att_${Date.now().toString(36)}_${keyCounter++}`;
}

function friendlyError(message: string): string {
  switch (message) {
    case "FILE_TOO_LARGE":
      return "That file is too large.";
    case "UNSUPPORTED_FILE_TYPE":
      return "That file type isn't supported.";
    case "ATTACHMENTS_DISABLED":
      return "Attachments are currently unavailable.";
    default:
      return message || "Upload failed";
  }
}

function isSettled(a: AttachmentDraft): boolean {
  return (
    !a.uploading &&
    a.id !== null &&
    (a.status === "READY" || a.status === "FAILED")
  );
}

export interface UseAttachments {
  attachments: AttachmentDraft[];
  /** Ids safe to send: server rows that have settled. */
  readyIds: string[];
  /** True while any chip is still uploading or extracting. */
  isBusy: boolean;
  addFiles: (files: File[], userMessage?: string) => void;
  addPaste: (text: string) => void;
  remove: (key: string) => void;
  /** Clear local state after a successful send (does NOT delete server rows). */
  clear: () => void;
  /** Restore chips after a failed send. */
  restore: (drafts: AttachmentDraft[]) => void;
}

export function useAttachments(): UseAttachments {
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);

  // Unrevoked object URLs leak for the tab's lifetime. In a ref so unmount
  // cleanup doesn't need to read state.
  const objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const patch = useCallback((key: string, next: Partial<AttachmentDraft>) => {
    setAttachments((prev) =>
      prev.map((a) => (a.key === key ? { ...a, ...next } : a)),
    );
  }, []);

  const dropByKey = useCallback((key: string) => {
    setAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const revoke = useCallback((url?: string) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }, []);

  /** Sign → PUT → complete, for one file. */
  const uploadOne = useCallback(
    async (file: File, key: string, userMessage?: string): Promise<void> => {
      try {
        const buffer = await file.arrayBuffer();
        const contentHash = await sha256Bytes(buffer);
        const mimeType = file.type || "application/octet-stream";

        const signed = await signUpload({
          filename: file.name,
          mimeType,
          sizeBytes: file.size,
          contentHash,
        });
        patch(key, { id: signed.attachmentId });

        if (signed.uploadUrl) {
          await uploadToR2(signed.uploadUrl, file, mimeType);
        }
        await completeUpload(signed.attachmentId, userMessage);

        patch(key, { uploading: false, status: "EXTRACTING" });
      } catch (err) {
        toast.error(
          friendlyError(err instanceof Error ? err.message : "Upload failed"),
        );
        setAttachments((prev) => {
          const target = prev.find((a) => a.key === key);
          if (target?.localUrl) revoke(target.localUrl);
          return prev.filter((a) => a.key !== key);
        });
      }
    },
    [patch, revoke],
  );

  const addFiles = useCallback(
    (files: File[], userMessage?: string) => {
      // Kept outside the state updater: StrictMode invokes it twice.
      const room = MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) {
        toast.error(`You can attach at most ${MAX_ATTACHMENTS} items.`);
        return;
      }
      if (files.length > room) {
        toast.error(`Only the first ${room} file(s) were attached.`);
      }

      const drafts: AttachmentDraft[] = [];
      const pendingUploads: { file: File; key: string }[] = [];

      for (const file of files.slice(0, room)) {
        const isImg = file.type.startsWith("image/");
        if (file.size > (isImg ? MAX_IMAGE_BYTES : MAX_FILE_BYTES)) {
          toast.error(`"${file.name}" is too large.`);
          continue;
        }

        const key = nextKey();
        // Instant thumbnail, no waiting on the round trip.
        const localUrl = isImg ? URL.createObjectURL(file) : undefined;
        if (localUrl) objectUrls.current.add(localUrl);

        drafts.push({
          key,
          id: null,
          kind: isImg ? "IMAGE" : "FILE",
          status: "PENDING",
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          extractionError: null,
          preview: null,
          lineCount: null,
          localUrl,
          uploading: true,
        });
        pendingUploads.push({ file, key });
      }

      if (drafts.length === 0) return;
      setAttachments((prev) => [...prev, ...drafts]);
      pendingUploads.forEach(({ file, key }) => {
        void uploadOne(file, key, userMessage);
      });
    },
    [attachments.length, uploadOne],
  );

  const addPaste = useCallback(
    (text: string) => {
      if (attachments.length >= MAX_ATTACHMENTS) {
        toast.error(`You can attach at most ${MAX_ATTACHMENTS} items.`);
        return;
      }

      const key = nextKey();
      setAttachments((prev) => [
        ...prev,
        {
          key,
          id: null,
          kind: "PASTED",
          status: "READY",
          filename: "Pasted content",
          mimeType: "text/plain",
          sizeBytes: new Blob([text]).size,
          extractionError: null,
          preview: text.slice(0, 240),
          lineCount: text.split("\n").length,
          uploading: true,
        },
      ]);

      void (async () => {
        try {
          const row = await createPaste(text);
          patch(key, { ...row, uploading: false });
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Couldn't attach pasted content",
          );
          dropByKey(key);
        }
      })();
    },
    [attachments.length, patch, dropByKey],
  );

  const remove = useCallback(
    (key: string) => {
      const target = attachments.find((a) => a.key === key);
      revoke(target?.localUrl);
      dropByKey(key);
      // Best-effort server cleanup; the hourly orphan sweep is the backstop.
      if (target?.id) {
        void deleteAttachment(target.id).catch(() => undefined);
      }
    },
    [attachments, dropByKey, revoke],
  );

  const clear = useCallback(() => {
    // The rows belong to a sent message now; only the local URLs are ours.
    attachments.forEach((a) => revoke(a.localUrl));
    setAttachments([]);
  }, [attachments, revoke]);

  const restore = useCallback((drafts: AttachmentDraft[]) => {
    setAttachments(drafts);
  }, []);

  // One interval for all pending chips.
  const pendingIds = attachments
    .filter(
      (a) =>
        !a.uploading &&
        a.id !== null &&
        (a.status === "PENDING" || a.status === "EXTRACTING"),
    )
    .map((a) => a.id!);
  const pendingKey = pendingIds.join(",");

  useEffect(() => {
    if (!pendingKey) return;
    const ids = pendingKey.split(",");
    let cancelled = false;

    const tick = async () => {
      const results = await Promise.allSettled(
        ids.map((id) => getAttachment(id)),
      );
      if (cancelled) return;
      setAttachments((prev) =>
        prev.map((a) => {
          if (a.id === null) return a;
          const idx = ids.indexOf(a.id);
          const r = idx === -1 ? undefined : results[idx];
          return r?.status === "fulfilled" ? { ...a, ...r.value } : a;
        }),
      );
    };

    const handle = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [pendingKey]);

  return {
    attachments,
    readyIds: attachments.filter(isSettled).map((a) => a.id!),
    isBusy: attachments.some((a) => !isSettled(a)),
    addFiles,
    addPaste,
    remove,
    clear,
    restore,
  };
}
