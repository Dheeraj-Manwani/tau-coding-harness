import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { api, isTerminalRequestError } from "@/src/lib/api-client";
import type { PreviewBuildError } from "@/src/features/project/types";

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
  /** Went live once, its files are still stored, and it is not live now. */
  canRollback: boolean;
}

/** The newest publish, when it failed. */
export interface DeployFailure {
  error: string;
  /** Tail of the build output, for "Fix with tau". */
  buildLog: string | null;
  /** The project has changed since, so the error may already be fixed. */
  changedSince: boolean;
}

export interface DeployStatus {
  slug: string | null;
  url: string | null;
  live: DeploymentSummary | null;
  deployments: DeploymentSummary[];
  inProgress: boolean;
  unpublishedChanges: number;
  serverWarning: string | null;
  /** Set when tau has taken the site down; `reason` is for the owner. */
  suspended: { reason: string | null } | null;
  lastFailure: DeployFailure | null;
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
      query.state.data?.inProgress && !isTerminalRequestError(query.state.error) ? 5_000 : false,
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

/**
 * Rolling back and taking a site offline are not jobs: the server moves one
 * pointer and answers with the panel's whole new state, so that goes straight
 * into the cache instead of waiting on a refetch.
 */
export function useRollbackDeploy(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: string) =>
      api
        .post<DeployStatus>(
          `/project/${projectId}/deployments/${deploymentId}/rollback`,
          {},
        )
        .then((r) => r.data),
    onSuccess: (status) => {
      toast.success("That version is live again");
      qc.setQueryData(deployKeys.status(projectId ?? ""), status);
      void qc.invalidateQueries({
        queryKey: deployKeys.status(projectId ?? ""),
      });
    },
    onError: (err: unknown) =>
      toast.error(errorMessage(err, "Couldn't roll back")),
  });
}

export function useUnpublish(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.delete<DeployStatus>(`/project/${projectId}/deploy`).then((r) => r.data),
    onSuccess: (status) => {
      toast.success("Your site is offline");
      qc.setQueryData(deployKeys.status(projectId ?? ""), status);
      void qc.invalidateQueries({
        queryKey: deployKeys.status(projectId ?? ""),
      });
    },
    onError: (err: unknown) =>
      toast.error(errorMessage(err, "Couldn't take the site offline")),
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
  if (status.suspended) return "Suspended";
  if (status.inProgress) return "Publishing…";
  if (!status.live) {
    // Only a build that went live is ever SUPERSEDED, so one in the history
    // with nothing live means the site was taken offline.
    return status.deployments.some((d) => d.status === "SUPERSEDED")
      ? "Offline"
      : "Not published yet";
  }
  if (status.unpublishedChanges > 0) {
    const n = status.unpublishedChanges;
    return `${n} change${n === 1 ? "" : "s"} since last publish`;
  }
  return "Up to date";
}

/** One word for a row of the history list. */
export function historyLabel(deployment: DeploymentSummary): string {
  if (deployment.isLive) return "Live";
  switch (deployment.status) {
    case "FAILED":
      return "Failed";
    case "QUEUED":
    case "BUILDING":
    case "UPLOADING":
      return "Publishing";
    default:
      // Went live and was replaced. Once its files have been cleared out it
      // stays in the list as a record, with nothing left to roll back to.
      return deployment.canRollback ? "Earlier version" : "Expired";
  }
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. Short: it shares a row. */
export function deployedAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const min = Math.floor(Math.max(0, now - then) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** The API's limits on a build error (`buildErrorSchema`). */
const BUILD_ERROR_MESSAGE_MAX = 8000;
const BUILD_ERROR_FRAME_MAX = 4000;

/**
 * What "Fix with tau" sends for a failed publish.
 *
 * The log is cut from the front, not the back: a build prints the error it
 * stopped on last, and the stored log is already a tail that can be a few
 * characters over the API's limit.
 */
export function publishFailureError(failure: DeployFailure): PreviewBuildError {
  const log = failure.buildLog?.trim();
  return {
    source: "publish",
    message: failure.error.slice(0, BUILD_ERROR_MESSAGE_MAX),
    ...(log ? { frame: log.slice(-BUILD_ERROR_FRAME_MAX) } : {}),
  };
}
