import { useCallback, useEffect, useRef } from "react";

import { ApiError } from "@/src/lib/api-client";
import { useSaveProjectFile } from "@/src/features/project/api";
import { isFileDirty, useProjectStore } from "@/src/stores/useProjectStore";

/** Idle delay before an unsaved buffer is flushed automatically. */
const AUTOSAVE_DEBOUNCE_MS = 2_000;

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      // Either the agent is mid-build or the file moved under the editor; the
      // server's message distinguishes them and both are actionable as-is.
      return err.message === "generation in progress"
        ? "Can't save while tau is building."
        : "This file changed since you opened it: reopen it to get the latest.";
    }
    return err.message;
  }
  return "Couldn't save this file.";
}

/**
 * Persistence for the code editor: debounced autosave plus explicit flushes.
 *
 * Reads live state via `useProjectStore.getState()` rather than closing over
 * `files`, so a save fired from a timer or an unmount can't act on a stale
 * snapshot of the buffer.
 */
export function useFileSave(projectId: string | undefined) {
  const save = useSaveProjectFile(projectId);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const flush = useCallback(
    (path: string) => {
      const timer = timers.current.get(path);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(path);
      }

      const store = useProjectStore.getState();
      const file = store.files[path];
      if (!file || !isFileDirty(file) || file.saving) return;

      const content = file.draft;
      if (content === undefined) return;

      store.setFileSaving(path, true);
      save.mutate(
        { path, content, baseHash: file.savedHash },
        {
          onSuccess: (data) =>
            useProjectStore
              .getState()
              .markFileSaved(path, content, data.contentHash),
          onError: (err) =>
            useProjectStore.getState().setFileSaveError(path, messageFor(err)),
        },
      );
    },
    [save],
  );

  const scheduleSave = useCallback(
    (path: string) => {
      const existing = timers.current.get(path);
      if (existing) clearTimeout(existing);
      timers.current.set(
        path,
        setTimeout(() => flush(path), AUTOSAVE_DEBOUNCE_MS),
      );
    },
    [flush],
  );

  // Don't leave a pending autosave behind on unmount: but do let an in-flight
  // request finish; the mutation isn't tied to this component's lifetime.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { flush, scheduleSave };
}
