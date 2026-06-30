import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";
import type {
  AddMessageResponse,
  InitProjectResponse,
  ListProjectsResponse,
  OlderMessagesResponse,
  ProjectDetail,
  ProjectFileResponse,
  ProjectTree,
} from "./types";

export const projectKeys = {
  all: ["project"] as const,
  list: () => ["project", "list"] as const,
  detail: (id: string) => ["project", id] as const,
  tree: (id: string) => ["project", id, "tree"] as const,
  file: (id: string, path: string) => ["project", id, "file", path] as const,
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
      api
        .get<ProjectDetail>(`/project/${projectId}`)
        .then((r) => r.data),
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
}

/** `POST /project` — create a project from the first prompt and enqueue a job. */
export function useInitProject() {
  return useMutation({
    mutationFn: (message: string) =>
      api
        .post<InitProjectResponse>("/project", { message })
        .then((r) => r.data),
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
    mutationFn: (message: string) =>
      api
        .post<AddMessageResponse>(`/project/${projectId}/message`, { message })
        .then((r) => r.data),
    onSettled: () => {
      // The new job will write messages/fragments; let the next entry refetch.
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
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
      api
        .get<ProjectTree>(`/project/${projectId}/tree`)
        .then((r) => r.data),
    enabled: Boolean(projectId),
    staleTime: 30_000,
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
