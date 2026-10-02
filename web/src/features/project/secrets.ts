import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { api } from "@/src/lib/api-client";

/**
 * Third-party API keys for the app being built (Stripe, Resend, …). Talks to
 * `/project/:id/secrets` and `/project/:id/jobs/:jobId/secrets`.
 *
 * Values only ever leave the browser in these request bodies. They are never
 * sent as a chat message or an `ask_user` answer (both are stored in the
 * transcript), and the server never sends one back: lists carry names only.
 */

/** One field of a key request, as the agent described it. Never a value. */
export interface SecretField {
  name: string;
  label: string;
  description: string;
  url?: string;
}

export interface ProjectSecretSummary {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretAnswerResult {
  /** What the chat shows as the user's reply, e.g. "Added Stripe secret key". */
  answer: string;
  saved: string[];
  skipped: string[];
}

export const secretKeys = {
  list: (projectId: string) => ["project", projectId, "secrets"] as const,
};

export function useProjectSecrets(projectId: string | undefined) {
  return useQuery({
    queryKey: secretKeys.list(projectId ?? ""),
    queryFn: () =>
      api
        .get<{ secrets: ProjectSecretSummary[] }>(`/project/${projectId}/secrets`)
        .then((r) => r.data.secrets),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}

/** Answer a paused `request_secret` call. Empty strings are skipped keys. */
export function submitSecretAnswer(
  projectId: string,
  jobId: string,
  questionId: string,
  values: Record<string, string>,
): Promise<SecretAnswerResult> {
  return api
    .post<SecretAnswerResult>(`/project/${projectId}/jobs/${jobId}/secrets`, {
      questionId,
      values,
    })
    .then((r) => r.data);
}

export function useSetProjectSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      api
        .put(`/project/${projectId}/secrets/${name}`, { value })
        .then(() => undefined),
    onSuccess: (_data, { name }) => {
      toast.success(`${name} updated`);
      void qc.invalidateQueries({ queryKey: secretKeys.list(projectId) });
    },
    onError: (err: unknown) =>
      toast.error(errorMessage(err, "Couldn't save the key")),
  });
}

export function useDeleteProjectSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.delete(`/project/${projectId}/secrets/${name}`).then(() => undefined),
    onSuccess: (_data, name) => {
      toast.success(`${name} removed`);
      void qc.invalidateQueries({ queryKey: secretKeys.list(projectId) });
    },
    onError: (err: unknown) =>
      toast.error(errorMessage(err, "Couldn't remove the key")),
  });
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}
