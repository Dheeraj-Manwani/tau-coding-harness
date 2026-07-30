import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";
import { projectGithubKeys } from "@/src/features/project/github";
import {
  locToPath,
  type VisualEditOpInput,
} from "@/src/stores/useProjectStore";
import type {
  AddMessageResponse,
  Effort,
  InitProjectResponse,
  ListProjectsResponse,
  OlderMessagesResponse,
  PreviewStatusResponse,
  ProjectDetail,
  ProjectFileResponse,
  ProjectTree,
  RestartPreviewResponse,
  SaveProjectFileResponse,
} from "./types";

export const projectKeys = {
  all: ["project"] as const,
  list: () => ["project", "list"] as const,
  detail: (id: string) => ["project", id] as const,
  tree: (id: string) => ["project", id, "tree"] as const,
  file: (id: string, path: string) => ["project", id, "file", path] as const,
  previewStatus: (id: string) => ["project", id, "preview-status"] as const,
};

/** `GET /project` — the signed-in user's projects, newest first. */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: () =>
      api.get<ListProjectsResponse>("/project").then((r) => r.data.projects),
    staleTime: 30_000,
  });
}

/** Load a project's persisted state (messages + latest fragment) on entry. */
export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.detail(projectId ?? ""),
    queryFn: () =>
      api.get<ProjectDetail>(`/project/${projectId}`).then((r) => r.data),
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
}

/** `POST /project` — create a project from the first prompt and enqueue a job. */
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
 * `POST /project/:id/message` — queue a follow-up generation. The API rejects
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
 * `POST /project/jobs/cancel-all` — cancel every in-flight generation the user
 * owns. Used by the concurrent-job-limit toast to free the blocked slot so the
 * user can start a new generation without waiting for the running one to finish.
 */
export function cancelAllJobs(): Promise<{ cancelled: number }> {
  return api
    .post<{ cancelled: number }>("/project/jobs/cancel-all")
    .then((r) => r.data);
}

/** `DELETE /project/:id` — permanently delete a project and all its data. */
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

/** `GET /project/:id/messages?before=<sequence>` — load older messages for pagination. */
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

/** `GET /project/:id/tree` — the full file manifest with headSequence. */
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
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: projectKeys.previewStatus(projectId ?? ""),
    queryFn: () =>
      api
        .get<PreviewStatusResponse>(`/project/${projectId}/preview/status`)
        .then((r) => r.data),
    enabled: Boolean(projectId) && options.enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
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

/** `POST /project/:id/jobs/:jobId/answer` — submit a user answer to a paused ask_user tool call. */
export function submitJobAnswer(
  projectId: string,
  jobId: string,
  answer: string,
): Promise<void> {
  return api
    .post(`/project/${projectId}/jobs/${jobId}/answer`, { answer })
    .then(() => undefined);
}

/** `GET /project/:id/file?path=…` — lazy-load a single file's body.
 *  Only fetches when `path` is non-empty and `enabled` is true. */
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
 * `PUT /project/:id/file` — persist a manual edit.
 *
 * `baseHash` is the hash the editor loaded; the server rejects with 409 if the
 * file moved underneath it. On success we write straight into the file query's
 * cache — with `staleTime: Infinity` it would otherwise never refetch and a tab
 * round-trip would show pre-save content.
 */
/** Why a visual edit couldn't be applied without the agent. */
export type VisualEditRefusal =
  | "dynamic_children"
  | "empty_value"
  | "multiline_value"
  | "bad_loc"
  | "dynamic_classname"
  | "invalid_class";

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
 * Costs no credits and starts no job — the server rewrites the one JSX node
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
      // The file's cached body is now stale — the edit happened server-side, so
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
        { content: vars.content, contentHash: data.contentHash },
      );
      // The GitHub panel derives "N changes since last push" from headSequence,
      // which this save just bumped.
      void qc.invalidateQueries({
        queryKey: projectGithubKeys.info(projectId ?? ""),
      });
    },
  });
}
