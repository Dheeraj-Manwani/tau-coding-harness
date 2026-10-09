import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { api, isTerminalRequestError } from "@/src/lib/api-client";
import { billingKeys } from "@/src/features/billing/api";
import { projectKeys } from "@/src/features/project/api";
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
  /** The address offered before the first publish; null once it is fixed. */
  suggestedName: string | null;
  /** `bytauai.pro`, or null where sites are served by path. */
  domain: string | null;
  live: DeploymentSummary | null;
  deployments: DeploymentSummary[];
  inProgress: boolean;
  unpublishedChanges: number;
  serverWarning: string | null;
  /** Set when tau has taken the site down; `reason` is for the owner. */
  suspended: { reason: string | null } | null;
  lastFailure: DeployFailure | null;
  /** First publish of a project costs `credits`; `due` is false once paid. */
  publishFee: { credits: number; due: boolean };
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
    // `name` is the address, chosen once, on a project's first publish.
    mutationFn: (name?: string) =>
      api
        .post<PublishResult>(`/project/${projectId}/deploy`, name ? { name } : {})
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

export interface NameCheck {
  name: string;
  available: boolean;
  /** The project already has its address. */
  locked: boolean;
  problem: "invalid" | "reserved" | "taken" | null;
  message: string | null;
}

/** The live check behind the address field. Pass null to stay idle. */
export function useNameCheck(projectId: string | null, name: string | null) {
  return useQuery({
    queryKey: ["project", projectId ?? "", "name-check", name ?? ""],
    queryFn: () =>
      api
        .get<NameCheck>(`/project/${projectId}/deploy/name-available`, { params: { name } })
        .then((r) => r.data),
    enabled: !!projectId && !!name,
    staleTime: 10_000,
  });
}

/** Lowercase letters, numbers and hyphens, as typed: what an address can hold. */
export function cleanAddressInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-").slice(0, 40);
}

// ── Name and logo ────────────────────────────────────────────────────────────

export interface IdentityView {
  title: string | null;
  description: string | null;
  /** `default` is tau's mark, `custom` an uploaded or generated logo. */
  icon: "default" | "custom" | "other" | null;
  /** What to prefill the name with while the page still has the scaffold's title. */
  projectName: string;
  plan: "FREE" | "PRO";
  /** In credits. The numbers live on the server; nothing here repeats them. */
  prices: { publishFee: number; logoUpload: number; logoGeneration: number };
  canGenerate: boolean;
  generationsLeftToday: number;
}

export interface SaveIdentityInput {
  title?: string;
  description?: string;
  logo?: { favicon: string; icon512: string; generationId?: string };
}

export interface GeneratedLogo {
  generationId: string;
  mimeType: string;
  /** Base64, no `data:` prefix. */
  image: string;
  /** Balance after the charge, in credits. */
  balance: number;
  generationsLeftToday: number;
}

/**
 * Whether a page's title is still whatever the scaffold wrote. Then the Name
 * field opens on the project's name instead, which is what the owner would type.
 */
export function isScaffoldTitle(title: string | null): boolean {
  return !title || /^(vite|react|tau|my app|untitled)(?![a-z0-9])/i.test(title.trim()) || /^vite-/i.test(title);
}

export function initialTitle(identity: Pick<IdentityView, "title" | "projectName">): string {
  return isScaffoldTitle(identity.title) ? identity.projectName : (identity.title as string);
}

export const identityKeys = {
  get: (projectId: string) => ["project", projectId, "identity"] as const,
};

export function useIdentity(projectId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: identityKeys.get(projectId ?? ""),
    queryFn: () =>
      api.get<IdentityView>(`/project/${projectId}/identity`).then((r) => r.data),
    enabled: !!projectId && enabled,
    staleTime: 15_000,
  });
}

/** What a save or a generation changes: the page, the files, the balance, and "unpublished changes". */
function refreshAfterIdentityChange(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string | null,
) {
  const id = projectId ?? "";
  void qc.invalidateQueries({ queryKey: identityKeys.get(id) });
  void qc.invalidateQueries({ queryKey: deployKeys.status(id) });
  void qc.invalidateQueries({ queryKey: projectKeys.tree(id) });
  void qc.invalidateQueries({ queryKey: billingKeys.balance });
}

export function useSaveIdentity(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveIdentityInput) =>
      api.put(`/project/${projectId}/identity`, input).then((r) => r.data),
    onSuccess: () => {
      toast.success("Saved");
      refreshAfterIdentityChange(qc, projectId);
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, "Couldn't save"));
      // A 402 or a refusal after a charge still moves the balance shown.
      void qc.invalidateQueries({ queryKey: billingKeys.balance });
    },
  });
}

export function useGenerateLogo(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<GeneratedLogo>(`/project/${projectId}/identity/logo/generate`, {})
        .then((r) => r.data),
    onSuccess: () => refreshAfterIdentityChange(qc, projectId),
    onError: (err: unknown) =>
      toast.error(errorMessage(err, "Couldn't make a logo")),
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
