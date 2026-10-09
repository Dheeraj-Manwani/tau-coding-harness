import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { api } from "@/src/lib/api-client";
import { deployKeys } from "@/src/features/project/deploy";

/**
 * Custom domains. Talks to `/project/:id/domains`.
 *
 * The server owns the whole life of a domain: it reads the owner's DNS, asks
 * Cloudflare, and moves the status. This side lists it, polls while anything is
 * still waiting, and sends the owner's clicks.
 */

export type DomainStatus = "PENDING_DNS" | "VERIFYING" | "ISSUING" | "ACTIVE" | "FAILED";

export interface DnsRecord {
  type: "CNAME" | "ALIAS" | "TXT";
  /** Relative to the owner's zone, as most registrars want it. */
  name: string;
  fullName: string;
  value: string;
  purpose: "route" | "verify";
}

export interface DomainView {
  id: string;
  hostname: string;
  kind: "root" | "subdomain";
  status: DomainStatus;
  isPrimary: boolean;
  error: string | null;
  records: DnsRecord[];
  /** What tau sees in DNS now. Null once active, or when it could not be told. */
  dns: { txt: boolean; pointsAtTau: boolean | null } | null;
  lastCheckedAt: string | null;
  checkUntil: string;
  createdAt: string;
}

export interface DomainsResponse {
  cnameTarget: string;
  domains: DomainView[];
}

export const domainKeys = {
  list: (projectId: string) => ["project", projectId, "domains"] as const,
};

/** Still moving, so worth polling: not done and not given up. */
export function isWaiting(status: DomainStatus): boolean {
  return status === "PENDING_DNS" || status === "VERIFYING" || status === "ISSUING";
}

/** One short phrase for a status. */
export function domainStatusLabel(status: DomainStatus): string {
  switch (status) {
    case "PENDING_DNS":
      return "Waiting for DNS";
    case "VERIFYING":
      return "Verifying";
    case "ISSUING":
      return "Issuing certificate";
    case "ACTIVE":
      return "Active";
    case "FAILED":
      return "Failed";
  }
}

/** What the live DNS answer says about one record, in words. */
export function recordCheck(record: DnsRecord, dns: DomainView["dns"]): "found" | "not found yet" | "points elsewhere" | null {
  if (!dns) return null;
  if (record.purpose === "verify") return dns.txt ? "found" : "not found yet";
  if (dns.pointsAtTau === true) return "found";
  return dns.pointsAtTau === false ? "points elsewhere" : "not found yet";
}

/** Whether the owner's records are all in place, for the headline under a waiting domain. */
export function recordsInPlace(dns: DomainView["dns"]): boolean {
  return !!dns && dns.txt && dns.pointsAtTau === true;
}

export function useDomains(projectId: string | null) {
  return useQuery({
    queryKey: domainKeys.list(projectId ?? ""),
    queryFn: () => api.get<DomainsResponse>(`/project/${projectId}/domains`).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 10_000,
    // While something is waiting the answer changes on its own, as DNS spreads.
    refetchInterval: (query) =>
      query.state.data?.domains.some((d) => isWaiting(d.status)) ? 15_000 : false,
  });
}

function messageOf(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

function useRefresh(projectId: string | null) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: domainKeys.list(projectId ?? "") });
    // The default address and the primary one are shown in the Publish panel.
    void qc.invalidateQueries({ queryKey: deployKeys.status(projectId ?? "") });
  };
}

export function useAddDomain(projectId: string | null) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (hostname: string) =>
      api.post<DomainView>(`/project/${projectId}/domains`, { hostname }).then((r) => r.data),
    onSuccess: refresh,
    onError: (err: unknown) => toast.error(messageOf(err, "Couldn't add that domain")),
  });
}

export function useCheckDomain(projectId: string | null) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (domainId: string) =>
      api.post<DomainView>(`/project/${projectId}/domains/${domainId}/check`, {}).then((r) => r.data),
    onSuccess: refresh,
    onError: (err: unknown) => toast.error(messageOf(err, "Couldn't check that domain")),
  });
}

export function useSetPrimary(projectId: string | null) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (args: { domainId: string; primary: boolean }) =>
      api
        .post<{ domains: DomainView[] }>(`/project/${projectId}/domains/${args.domainId}/primary`, { primary: args.primary })
        .then((r) => r.data),
    onSuccess: refresh,
    onError: (err: unknown) => toast.error(messageOf(err, "Couldn't change the primary domain")),
  });
}

export function useRemoveDomain(projectId: string | null) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (domainId: string) =>
      api.delete<{ domains: DomainView[] }>(`/project/${projectId}/domains/${domainId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success("Domain removed");
      refresh();
    },
    onError: (err: unknown) => toast.error(messageOf(err, "Couldn't remove that domain")),
  });
}
