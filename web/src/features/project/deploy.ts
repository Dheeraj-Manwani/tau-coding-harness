import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { api } from "@/src/lib/api-client";

/**
 * Publishing a project. Talks to `/project/:id/deploy`.
 *
 * The build itself runs as a job and streams over the normal SSE channel, so
 * there is nothing to poll here in the usual case: the store invalidates this
 * query when the `deploy_ready` frame lands. `refetchInterval` covers only the
 * case where the panel is opened while a publish started in another tab.
 */

export type DeploymentStatus =
  | "QUEUED"
  | "BUILDING"
  | "UPLOADING"
  | "READY"
  | "FAILED"
  | "SUPERSEDED";

export interface DeploymentSummary {
  id: string;
  status: DeploymentStatus;
  fileCount: number;
  sizeBytes: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  isLive: boolean;
}

export interface DeployStatus {
  slug: string | null;
  url: string | null;
  live: DeploymentSummary | null;
  deployments: DeploymentSummary[];
  inProgress: boolean;
  unpublishedChanges: number;
  serverWarning: string | null;
}

export interface PublishResult {
  jobId: string;
  deploymentId: string;
  slug: string;
  url: string;
}

export const deployKeys = {
  status: (projectId: string) => ["project", projectId, "deploy"] as const,
};

export function useDeployStatus(projectId: string | null) {
  return useQuery({
    queryKey: deployKeys.status(projectId ?? ""),
    queryFn: () =>
      api.get<DeployStatus>(`/project/${projectId}/deploy`).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 15_000,
    refetchInterval: (query) =>
      query.state.data?.inProgress ? 5_000 : false,
  });
}

export function usePublishProject(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<PublishResult>(`/project/${projectId}/deploy`, {})
        .then((r) => r.data),
    onSuccess: () => {
      toast.success("Publishing: building your app");
      void qc.invalidateQueries({
        queryKey: deployKeys.status(projectId ?? ""),
      });
    },
    onError: (err: unknown) =>
      toast.error(errorMessage(err, "Couldn't start publishing")),
  });
}

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

/** "1.2 MB" / "840 KB": sizes here are bundles, so KB is the smallest useful unit. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** What the panel says under the button. */
export function publishLabel(status: DeployStatus | undefined): string {
  if (!status) return "";
  if (status.inProgress) return "Publishing…";
  if (!status.live) return "Not published yet";
  if (status.unpublishedChanges > 0) {
    const n = status.unpublishedChanges;
    return `${n} change${n === 1 ? "" : "s"} since last publish`;
  }
  return "Up to date";
}
