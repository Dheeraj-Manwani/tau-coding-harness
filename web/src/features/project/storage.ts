import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { api } from "@/src/lib/api-client";
import { errorMessage } from "@/src/features/project/secrets";

/**
 * What the project's app has stored with tau Cloud Storage, for the owner
 * (Tools → Storage). Talks to `/project/:id/storage/*` with the owner's
 * session; the app's storage key is never involved and never sent here.
 *
 * The response types are mirrored by hand from `storageOwner.service.ts`, as
 * `deploy.ts` does for its own.
 */

export type StorageEnv = "PREVIEW" | "LIVE";

export interface StorageOverview {
  enabled: boolean;
  suspended: boolean;
  usage: { usedBytes: number; quotaBytes: number; maxFileBytes: number };
  environments: { env: StorageEnv; fileCount: number; usedBytes: number }[];
}

export interface StoredFile {
  id: string;
  key: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
}

interface FilesPage {
  files: StoredFile[];
  nextCursor: string | null;
}

export const storageKeys = {
  overview: (projectId: string) => ["project", projectId, "storage"] as const,
  files: (projectId: string, env: StorageEnv, prefix: string) =>
    ["project", projectId, "storage", "files", env, prefix] as const,
};

export function useProjectStorage(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: storageKeys.overview(projectId ?? ""),
    queryFn: () => api.get<StorageOverview>(`/project/${projectId}/storage`).then((r) => r.data),
    enabled: Boolean(projectId) && enabled,
    staleTime: 15_000,
  });
}

export function useStorageFiles(projectId: string, env: StorageEnv, prefix: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: storageKeys.files(projectId, env, prefix),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api
        .get<FilesPage>(`/project/${projectId}/storage/files`, {
          params: { env, prefix: prefix || undefined, cursor: pageParam, limit: 50 },
        })
        .then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

/** A short-lived address for one file. Asked for when the owner clicks, never ahead of time. */
export function fetchFileUrl(projectId: string, env: StorageEnv, key: string, download: boolean): Promise<string> {
  return api
    .post<{ url: string }>(`/project/${projectId}/storage/files/url`, { env, key, download })
    .then((r) => r.data.url);
}

function useRefresh(projectId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: storageKeys.overview(projectId) });
}

export function useDeleteStorageFiles(projectId: string, env: StorageEnv) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (keys: string[]) =>
      api
        .post<{ deleted: number }>(`/project/${projectId}/storage/files/delete`, { env, keys })
        .then((r) => r.data.deleted),
    onSuccess: (deleted) => {
      toast.success(deleted === 1 ? "File deleted" : `${deleted} files deleted`);
      void refresh();
    },
    onError: (err: unknown) => toast.error(errorMessage(err, "Couldn't delete the files")),
  });
}

/** Everything in the preview environment. There is no equivalent for Live. */
export function useClearPreviewFiles(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: () =>
      api.post<{ deleted: number }>(`/project/${projectId}/storage/clear`).then((r) => r.data.deleted),
    onSuccess: (deleted) => {
      toast.success(deleted === 1 ? "1 file cleared" : `${deleted} files cleared`);
      void refresh();
    },
    onError: (err: unknown) => toast.error(errorMessage(err, "Couldn't clear the files")),
  });
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** "0 B", "840 B", "12.4 KB", "10 MB", "1.5 GB": one decimal, dropped when it is .0. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/** `users/42/avatar.png` → folder `users/42/`, name `avatar.png`. */
export function splitKey(key: string): { folder: string; name: string } {
  const i = key.lastIndexOf("/");
  return i === -1 ? { folder: "", name: key } : { folder: key.slice(0, i + 1), name: key.slice(i + 1) };
}

/** Whole percent of the allowance used, clamped to 0 to 100. */
export function usagePercent(usedBytes: number, quotaBytes: number): number {
  if (quotaBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((usedBytes / quotaBytes) * 100)));
}

/** Where the bar warns the owner and offers the upgrade. */
export const NEARLY_FULL_PERCENT = 80;

/**
 * Types the browser may show in place. The same list the server applies
 * (`isInlineSafe`): anything else, HTML and SVG included, can only be downloaded.
 */
export function canPreview(contentType: string): boolean {
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return (
    /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)$/.test(base) ||
    base === "application/pdf" ||
    base === "text/plain" ||
    base.startsWith("audio/") ||
    base.startsWith("video/")
  );
}

/** A short label for the Type column: "PNG", "PDF", or the subtype. */
export function typeLabel(contentType: string, name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (ext && ext.length <= 5) return ext.toUpperCase();
  const sub = contentType.split(";")[0]!.split("/")[1] ?? "";
  return (sub.split("+")[0] || "file").slice(0, 8).toUpperCase();
}
