import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";

export const accountKeys = {
  apiKey: ["account", "api-key"] as const,
};

export interface ApiKeyView {
  exists: boolean;
  /** Never the full key — only the safe-to-display prefix. */
  prefix: string | null;
  status: "ACTIVE" | "ROTATING" | "REVOKED" | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokeAfter: string | null;
  dailyCapCredits: number;
  dailyCapIsDefault: boolean;
  spentTodayCredits: number;
}

export function useApiKey() {
  return useQuery({
    queryKey: accountKeys.apiKey,
    queryFn: async () => (await api.get<ApiKeyView>("/account/api-key")).data,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ key: string; view: ApiKeyView }>("/account/api-key"))
        .data,
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.apiKey }),
  });
}

// ── Re-auth ──────────────────────────────────────────────────────────────────
// Revealing or rotating hands out a live spend credential, so a session alone
// isn't enough. Password accounts re-enter their password; Google-only accounts
// get a code by email, because there is no password to re-enter.

export type ReauthMethod = "password" | "email_code";

export interface ReauthChallenge {
  method: ReauthMethod;
  /** Masked destination for the emailed code. Null for the password method. */
  sentTo: string | null;
}

export function useReauthMethod(enabled: boolean) {
  return useQuery({
    queryKey: ["account", "reauth-method"] as const,
    queryFn: async () =>
      (await api.get<{ method: ReauthMethod }>("/account/reauth")).data.method,
    enabled,
  });
}

export function useReauthChallenge() {
  return useMutation({
    mutationFn: async () =>
      (await api.post<ReauthChallenge>("/account/reauth/challenge")).data,
  });
}

export function useReauth() {
  return useMutation({
    mutationFn: async (input: { password?: string; code?: string }) =>
      (await api.post<{ token: string; expiresInSeconds: number }>(
        "/account/reauth",
        input,
      )).data,
  });
}

/** The header the two credential-returning endpoints check. */
function reauthHeader(token: string) {
  return { headers: { "X-Tau-Reauth": token } };
}

/**
 * Deliberately a mutation, not a query: revealing decrypts a live credential
 * server-side and is rate-limited, so it must never fire on render or refetch.
 */
export function useRevealApiKey() {
  return useMutation({
    mutationFn: async (reauthToken: string) =>
      (
        await api.post<{ key: string }>(
          "/account/api-key/reveal",
          {},
          reauthHeader(reauthToken),
        )
      ).data,
  });
}

export function useRotateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reauthToken: string) =>
      (
        await api.post<{
          key: string;
          previousKeyExpiresAt: string | null;
          view: ApiKeyView;
        }>("/account/api-key/rotate", {}, reauthHeader(reauthToken))
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.apiKey }),
  });
}

export function useRevokeApiKeys() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ revoked: number }>("/account/api-key/revoke")).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.apiKey }),
  });
}

export function useSetDailyCap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dailyCapCredits: number | null) =>
      (await api.put<ApiKeyView>("/account/api-key/cap", { dailyCapCredits }))
        .data,
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.apiKey }),
  });
}
