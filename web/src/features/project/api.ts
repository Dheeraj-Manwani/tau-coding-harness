import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, isTerminalRequestError } from "@/src/lib/api-client";
import { projectGithubKeys } from "@/src/features/project/github";
import {
  locToPath,
  type VisualEditOpInput,
} from "@/src/stores/useProjectStore";
import type {
  AddMessageResponse,
  ClearChatResponse,
  Effort,
  InitProjectResponse,
  ListProjectsResponse,
  OlderMessagesResponse,
  PreviewBuildError,
  PreviewStatusResponse,
  ProjectDetail,
  ProjectFileResponse,
  ProjectTree,
  RestartPreviewResponse,
  SaveProjectFileResponse,
  SummarizeChatResponse,
  VisualMessageContext,
} from "./types";

export const projectKeys = {
  all: ["project"] as const,
  list: () => ["project", "list"] as const,
  detail: (id: string) => ["project", id] as const,
  tree: (id: string) => ["project", id, "tree"] as const,
  file: (id: string, path: string) => ["project", id, "file", path] as const,
  previewStatus: (id: string) => ["project", id, "preview-status"] as const,
  theme: (id: string) => ["project", id, "theme"] as const,
};

/** `GET /project`: the signed-in user's projects, newest first. */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: () =>
      api.get<ListProjectsResponse>("/project").then((r) => r.data.projects),
    staleTime: 30_000,
  });
}

export function useProjectsPage(search: string, cursor?: string) {
  return useQuery({
    queryKey: [...projectKeys.list(), "page", search, cursor ?? ""],
    queryFn: () => api.get<ListProjectsResponse>("/project", {
      params: { search: search || undefined, cursor, limit: 6 },
    }).then((response) => response.data),
    staleTime: 30_000,
  });
}

export function useProjectShowcase() {
  return useQuery({
    queryKey: ["project", "showcase"],
    queryFn: () => api.get<{ projects: { slug: string; url: string }[] }>("/project/showcase")
      .then((response) => response.data.projects),
    staleTime: 60_000,
  });
}

/** Load a project's persisted state (messages + latest fragment) on entry. */
export function useProject(projectId: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: projectKeys.detail(projectId ?? ""),
    queryFn: () =>
      api.get<ProjectDetail>(`/project/${projectId}`).then((r) => r.data),
    enabled: Boolean(projectId) && options.enabled !== false,
    retry: false,
    staleTime: 30_000,
    // Job phase is live state. Never restore a cached "working" snapshot on
    // re-entry and wait 30 seconds to discover that it is now waiting/finished.
    refetchOnMount: "always",
    refetchOnWindowFocus: (query) => isTerminalRequestError(query.state.error) ? false : "always",
  });
}

/** `POST /project`: create a project from the first prompt and enqueue a job. */
export function useInitProject() {
  return useMutation({
    mutationFn: (vars: {
      message: string;
      effort: Effort;
      attachmentIds?: string[];
    }) => api.post<InitProjectResponse>("/project", vars).then((r) => r.data),
  });
}

/**
 * `POST /project/:id/message`: queue a follow-up generation. The API rejects
 * with 409 ("generation in progress") if a job is already running; callers
 * surface that via the mutation's error (a typed {@link ApiError}).
 */
export function useAddMessage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      message: string;
      effort: Effort;
      attachmentIds?: string[];
      /** The element this message is about, when it was sent from the
       *  visual-edit inspector. The API turns it into a `<selected-element>`
       *  block the model reads and the transcript doesn't. */
      visualContext?: VisualMessageContext;
      /** Vite's build failure, when sent from "Fix with tau". Becomes a
       *  `<build-error>` block on the same terms. */
      buildError?: PreviewBuildError;
    }) =>
      api
        .post<AddMessageResponse>(`/project/${projectId}/message`, vars)
        .then((r) => r.data),
    onSettled: () => {
      // The new job will write messages/fragments; let the next entry refetch.
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

/**
 * `POST /project/jobs/cancel-all`: cancel every in-flight generation the user
 * owns. Used by the concurrent-job-limit toast to free the blocked slot so the
 * user can start a new generation without waiting for the running one to finish.
 */
export function cancelAllJobs(): Promise<{ cancelled: number }> {
  return api
    .post<{ cancelled: number }>("/project/jobs/cancel-all")
    .then((r) => r.data);
}

export interface UpdateProjectResponse {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
}

/** `PATCH /project/:id`: edit name, description and/or tags from the edit
 *  dialog shared by Home and the project page. */
export function useUpdateProject(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name?: string; description?: string; tags?: string[] }) =>
      api
        .patch<UpdateProjectResponse>(`/project/${projectId}`, vars)
        .then((r) => r.data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: projectKeys.list() });
      qc.setQueryData<ProjectDetail>(projectKeys.detail(projectId ?? ""), (prev) =>
        prev ? { ...prev, project: { ...prev.project, ...updated } } : prev,
      );
    },
  });
}

/** `DELETE /project/:id`: permanently delete a project and all its data. */
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) =>
      api.delete(`/project/${projectId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

/**
 * `POST /project/:id/chat/clear`: start a fresh conversation. The server
 * writes a boundary checkpoint rather than deleting rows, but every read path
 * (messages, `loadHistory`) floors on it, so old messages are gone from both
 * the UI and the model from here on. Invalidating the detail query lets the
 * existing `hydrate(data)` effect in `useProjectBootstrap` rebuild
 * `chatMessages` from the now-filtered response — no manual store write needed.
 */
export function useClearChat(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ClearChatResponse>(`/project/${projectId}/chat/clear`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

/**
 * `POST /project/:id/chat/summarize`: manually compress the older part of the
 * conversation right now, instead of waiting for the agent loop's own
 * high-water-mark auto-summarize. Rejects with 409 while a job is running and
 * 400 when there's not enough history yet — both surfaced as the mutation's
 * error for the caller to toast.
 */
export function useSummarizeChat(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<SummarizeChatResponse>(`/project/${projectId}/chat/summarize`)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

/** `GET /project/:id/messages?before=<sequence>`: load older messages for pagination. */
export function fetchOlderMessages(
  projectId: string,
  beforeSequence: number,
  limit = 20,
): Promise<OlderMessagesResponse> {
  return api
    .get<OlderMessagesResponse>(
      `/project/${projectId}/messages?before=${beforeSequence}&limit=${limit}`,
    )
    .then((r) => r.data);
}

/** `GET /project/:id/tree`: the full file manifest with headSequence. */
export function useProjectTree(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.tree(projectId ?? ""),
    queryFn: () =>
      api.get<ProjectTree>(`/project/${projectId}/tree`).then((r) => r.data),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}

export function usePreviewStatus(
  projectId: string | undefined,
  options: { enabled: boolean; previewUrl: string | null },
) {
  return useQuery({
    queryKey: [...projectKeys.previewStatus(projectId ?? ""), options.previewUrl],
    queryFn: () =>
      api
        .get<PreviewStatusResponse>(`/project/${projectId}/preview/status`)
          .then((r) => r.data.url && r.data.url !== options.previewUrl ? { alive: false } : r.data),
    enabled: Boolean(projectId) && options.enabled,
    refetchInterval: (query) =>
      query.state.data?.alive === false || isTerminalRequestError(query.state.error) ? false : 30_000,
    refetchOnWindowFocus: (query) => !isTerminalRequestError(query.state.error),
    staleTime: 15_000,
    retry: false,
  });
}

export function useRestartPreview(projectId: string) {
  return useMutation({
    mutationFn: () =>
      api
        .post<RestartPreviewResponse>(`/project/${projectId}/preview/restart`)
        .then((r) => r.data),
  });
}

/** `POST /project/:id/jobs/:jobId/answer`: submit a user answer to a paused ask_user tool call. */
export function submitJobAnswer(
  projectId: string,
  jobId: string,
  questionId: string,
  answer: string,
): Promise<void> {
  return api
    .post(`/project/${projectId}/jobs/${jobId}/answer`, { questionId, answer })
    .then(() => undefined);
}

/** `GET /project/:id/file?path=…`: lazy-load a single file's body.
 *  Only fetches when `path` is non-empty and `enabled` is true. */
export async function downloadProjectZip(projectId: string): Promise<void> {
  const { data } = await api.get<Blob>(`/project/${projectId}/download`, { responseType: "blob" });
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `project-${projectId}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to begin consuming the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useProjectFile(
  projectId: string | undefined,
  path: string,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: projectKeys.file(projectId ?? "", path),
    queryFn: () =>
      api
        .get<ProjectFileResponse>(
          `/project/${projectId}/file?path=${encodeURIComponent(path)}`,
        )
        .then((r) => r.data),
    enabled: Boolean(projectId && path) && options.enabled,
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * `PUT /project/:id/file`: persist a manual edit.
 *
 * `baseHash` is the hash the editor loaded; the server rejects with 409 if the
 * file moved underneath it. On success we write straight into the file query's
 * cache: with `staleTime: Infinity` it would otherwise never refetch and a tab
 * round-trip would show pre-save content.
 */
/** Why a visual edit couldn't be applied without the agent. */
export type VisualEditRefusal =
  | "dynamic_children"
  | "empty_value"
  | "multiline_value"
  | "bad_loc"
  | "dynamic_classname"
  | "invalid_class"
  | "dynamic_attribute"
  | "invalid_attr_value";

export type { VisualEditOpInput } from "@/src/stores/useProjectStore";

export type VisualEditResponse =
  | {
      applied: true;
      contentHash: string;
      headSequence: number;
      /** Authoritative post-merge class list, for `classes` ops. */
      className?: string;
    }
  | { applied: false; reason: VisualEditRefusal };

/**
 * Apply a change made by clicking an element in the preview.
 *
 * Costs no credits and starts no job: the server rewrites the one JSX node
 * deterministically. A successful edit writes the sandbox, so Vite hot-reloads
 * and the preview updates on its own; there is nothing to refetch for it.
 *
 * `applied: false` is a normal response, not an error: it means the element
 * isn't safe to edit deterministically and the change needs the agent.
 */
export function useVisualEdit(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: {
      loc: string;
      expectTag: string;
      baseHash?: string;
      op: VisualEditOpInput;
    }) =>
      api
        .post<VisualEditResponse>(`/project/${projectId}/visual-edit`, vars)
        .then((r) => r.data),
    onSuccess: (data, vars) => {
      if (!data.applied) return;
      // The file's cached body is now stale: the edit happened server-side, so
      // unlike useSaveProjectFile we don't have the new content to write in.
      void qc.invalidateQueries({
        queryKey: projectKeys.file(projectId ?? "", locToPath(vars.loc)),
      });
      void qc.invalidateQueries({
        queryKey: projectGithubKeys.info(projectId ?? ""),
      });
    },
  });
}

// ── Theme editing (doc/archive/VISUAL_EDIT_PLAN.md §6 Phase 6) ───────────────────────

/** Which palette a token belongs to: `:root` is light, `.dark` is dark. */
export type ThemeScope = "root" | "dark";

export interface ProjectThemeResponse {
  path: string;
  contentHash: string;
  root: Record<string, string>;
  dark: Record<string, string>;
}

export type ThemeEditRefusal =
  | "no_theme_block"
  | "token_not_found"
  | "invalid_value";

export type ThemeEditResponse =
  | {
      applied: true;
      contentHash: string;
      headSequence: number;
      /** Which palette actually got written: not always the one asked for, see
       *  `applyThemeEdit`. */
      scope: ThemeScope;
    }
  | { applied: false; reason: ThemeEditRefusal };

/**
 * The project's current theme variables, read from `src/index.css`.
 *
 * Not cached for long: the agent edits this file too, and a stale palette would
 * show the user colours their app no longer has.
 */
export function useProjectTheme(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.theme(projectId ?? ""),
    queryFn: () =>
      api
        .get<ProjectThemeResponse>(`/project/${projectId}/theme`)
        .then((r) => r.data),
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 5_000,
  });
}

/**
 * Set one theme variable: the cheapest big change in the product.
 *
 * Like `useVisualEdit`: no credits, no job, and the sandbox write means Vite
 * hot-reloads the preview on its own. Unlike it, one request restyles every
 * element that uses the token rather than one node.
 */
export function useThemeEdit(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: {
      name: string;
      value: string;
      scope: ThemeScope;
      baseHash?: string;
    }) =>
      api
        .post<ThemeEditResponse>(`/project/${projectId}/theme`, vars)
        .then((r) => r.data),
    onSuccess: (data) => {
      if (!data.applied) return;
      void qc.invalidateQueries({ queryKey: projectKeys.theme(projectId ?? "") });
      void qc.invalidateQueries({
        queryKey: projectKeys.file(projectId ?? "", "src/index.css"),
      });
      void qc.invalidateQueries({
        queryKey: projectGithubKeys.info(projectId ?? ""),
      });
    },
  });
}

export type AssetImportRefusal =
  | "bad_url"
  | "blocked_host"
  | "fetch_failed"
  | "not_an_image"
  | "too_large"
  | "empty";

export type VisualAssetResponse =
  | { imported: true; path: string; src: string; sizeBytes: number }
  | { imported: false; reason: AssetImportRefusal };

/**
 * Copy a remote image into the project's `public/`.
 *
 * Deliberately does not touch the source: it returns a `src` the caller then
 * applies with a normal `attr` visual edit, so the JSX rewrite keeps going
 * through the one path that has the tag check, the stale-file check and undo.
 */
export function useImportVisualAsset(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { url: string }) =>
      api
        .post<VisualAssetResponse>(`/project/${projectId}/visual-asset`, vars)
        .then((r) => r.data),
    onSuccess: (data) => {
      if (!data.imported) return;
      // A new file exists: the tree is stale.
      void qc.invalidateQueries({ queryKey: projectKeys.tree(projectId ?? "") });
    },
  });
}

export function useSaveProjectFile(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { path: string; content: string; baseHash?: string }) =>
      api
        .put<SaveProjectFileResponse>(`/project/${projectId}/file`, vars)
        .then((r) => r.data),
    onSuccess: (data, vars) => {
      qc.setQueryData<ProjectFileResponse>(
        projectKeys.file(projectId ?? "", vars.path),
        () => ({ binary: false, content: vars.content, contentHash: data.contentHash }),
      );
      // The GitHub panel derives "N changes since last push" from headSequence,
      // which this save just bumped.
      void qc.invalidateQueries({
        queryKey: projectGithubKeys.info(projectId ?? ""),
      });
    },
  });
}
