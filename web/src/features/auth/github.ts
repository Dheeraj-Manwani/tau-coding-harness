import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { api } from "@/src/lib/api-client";
import { env } from "@/src/lib/env";

/**
 * "Connect GitHub" is a per-user account link, separate from login. The status
 * query drives the button label; connecting is a full-page navigation to the
 * api (the refresh cookie authenticates it) that redirects back here with
 * `?github=connected`.
 */

export interface GithubStatus {
  connected: boolean;
  username: string | null;
}

export const githubKeys = {
  status: ["auth", "github", "status"] as const,
};

export function useGithubStatus() {
  return useQuery({
    queryKey: githubKeys.status,
    queryFn: () =>
      api.get<GithubStatus>("/auth/github/status").then((r) => r.data),
    staleTime: 60_000,
  });
}

/** Kick off the OAuth consent flow, returning to the current page afterwards. */
export function startGithubConnect(): void {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${env.API_URL}/auth/github?return_to=${returnTo}`;
}

/**
 * On returning from the OAuth round-trip the api appends `?github=<result>`.
 * Surface it as a toast, refresh the status, and strip the param from the URL so
 * a reload doesn't re-toast.
 */
export function useGithubReturnToast(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("github");
    if (!result) return;

    if (result === "connected") {
      toast.success("GitHub connected");
      qc.invalidateQueries({ queryKey: githubKeys.status });
    } else if (result === "denied") {
      toast("GitHub connection cancelled");
    } else if (result === "error") {
      toast.error("Couldn't connect GitHub. Please try again.");
    }

    params.delete("github");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [qc]);
}

export function useDisconnectGithub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/auth/github"),
    onSuccess: () => {
      qc.setQueryData<GithubStatus>(githubKeys.status, {
        connected: false,
        username: null,
      });
    },
  });
}
