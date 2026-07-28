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

/**
 * Deliberately a mutation, not a query: revealing decrypts a live credential
 * server-side and is rate-limited, so it must never fire on render or refetch.
 */
export function useRevealApiKey() {
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ key: string }>("/account/api-key/reveal")).data,
  });
}

export function useRotateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await api.post<{
          key: string;
          previousKeyExpiresAt: string | null;
          view: ApiKeyView;
        }>("/account/api-key/rotate")
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
