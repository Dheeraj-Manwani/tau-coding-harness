import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface ApiState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  /** When the current `data` arrived in this tab. */
  fetchedAt: Date | undefined;
  /** Fetch again. `fresh` appends `fresh=1` (the server throttles it). */
  reload: (opts?: { fresh?: boolean }) => void;
}

/**
 * Fetch once when `path` changes, and again only when asked.
 *
 * Deliberately no interval, no refetch-on-focus, no background revalidation:
 * this console shares a server with users, and "reload is the refresh button"
 * is the load contract. Pass `null` to skip fetching.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [request, setRequest] = useState({ n: 0, fresh: false });
  const [result, setResult] = useState<{
    key: string;
    path: string;
    data?: T;
    error?: string;
    at?: Date;
  }>();
  const latest = useRef<string | null>(null);

  // One key per (path, reload) — the request in flight is whichever key the
  // render last asked for, so loading is derived, never stored.
  const key = path === null ? null : `${request.n}:${path}`;

  useEffect(() => {
    if (path === null || key === null) return;
    latest.current = key;
    const url = request.fresh ? `${path}${path.includes("?") ? "&" : "?"}fresh=1` : path;
    api<T>(url).then(
      (data) => {
        if (latest.current === key) setResult({ key, path, data, at: new Date() });
      },
      (err: unknown) => {
        if (latest.current !== key) return;
        const error = err instanceof Error ? err.message : String(err);
        // Keep what was on screen for the same path; a failed refresh shouldn't blank it.
        setResult((prev) => ({ key, path, error, data: prev?.path === path ? prev.data : undefined, at: prev?.path === path ? prev.at : undefined }));
      },
    );
  }, [key, path, request.fresh]);

  const reload = useCallback((opts?: { fresh?: boolean }) => {
    setRequest((r) => ({ n: r.n + 1, fresh: Boolean(opts?.fresh) }));
  }, []);

  // Data from a different path (navigated to another job) is never shown.
  const samePath = result?.path === path;
  return {
    data: samePath ? result?.data : undefined,
    error: result?.key === key ? result?.error : undefined,
    loading: key !== null && result?.key !== key,
    fetchedAt: samePath ? result?.at : undefined,
    reload,
  };
}
