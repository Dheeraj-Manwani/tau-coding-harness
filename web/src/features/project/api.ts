import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";
import type {
  AddMessageResponse,
  InitProjectResponse,
  ProjectDetail,
} from "./types";

export const projectKeys = {
  all: ["project"] as const,
  detail: (id: string) => ["project", id] as const,
};

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
