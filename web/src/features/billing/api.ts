import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";

export const billingKeys = {
  balance: ["billing", "balance"] as const,
  history: (cursor?: string) => ["billing", "history", cursor ?? ""] as const,
  subscription: ["billing", "subscription"] as const,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface BalanceSummary {
  plan: "FREE" | "PRO";
  cycleEnd: string | null;
  credits: { available: number; free: number; plan: number; bonus: number; reserved: number };
  micro: { available: string; free: string; plan: string; bonus: string; reserved: string };
}

export interface LedgerEntry {
  id: string;
  type: string;
  credits: number;
  amountMicro: string;
  balanceAfter: number;
  balanceAfterMicro: string;
  reason: string | null;
  jobId: string | null;
  createdAt: string;
}

export interface SubscriptionInfo {
  id: string;
  plan: string;
  status: string;
  razorpaySubscriptionId: string;
  currentStart: string | null;
  currentEnd: string | null;
  cancelAtCycleEnd: boolean;
  createdAt: string;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useBalance() {
  return useQuery({
    queryKey: billingKeys.balance,
    queryFn: () => api.get<BalanceSummary>("/credits/balance").then((r) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useHistory(cursor?: string) {
  return useQuery({
    queryKey: billingKeys.history(cursor),
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      return api
        .get<{ entries: LedgerEntry[]; nextCursor: string | null }>(
          `/credits/history?${params}`,
        )
        .then((r) => r.data);
    },
    staleTime: 30_000,
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: billingKeys.subscription,
    queryFn: () =>
      api
        .get<{ subscription: SubscriptionInfo | null }>("/billing/subscription")
        .then((r) => r.data.subscription),
    staleTime: 30_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useRedeemCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api
        .post<{ creditsGranted: number; available: number }>("/credits/redeem", { code })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.balance });
      void qc.invalidateQueries({ queryKey: ["billing", "history"] });
    },
  });
}

export function useSubscribePro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<{ subscriptionId: string; shortUrl: string }>("/billing/subscribe")
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.subscription });
    },
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/billing/cancel").then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.subscription });
      void qc.invalidateQueries({ queryKey: billingKeys.balance });
    },
  });
}
