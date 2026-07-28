import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";

export const billingKeys = {
  balance: ["billing", "balance"] as const,
  history: (cursor?: string) => ["billing", "history", cursor ?? ""] as const,
  spend: ["billing", "spend"] as const,
  subscription: ["billing", "subscription"] as const,
  creditPacks: ["billing", "credit-packs"] as const,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface BalanceSummary {
  plan: "FREE" | "PRO";
  cycleEnd: string | null;
  effortCeilings?: { LOW: number; HIGH: number; MAX: number };
  credits: {
    available: number;
    free: number;
    plan: number;
    bonus: number;
    reserved: number;
  };
  micro: {
    available: string;
    free: string;
    plan: string;
    bonus: string;
    reserved: string;
  };
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
  /** Name of the project a generation debit paid for; null if since deleted. */
  projectName: string | null;
  /** Metered turns folded into this row (>1 only for collapsed generations). */
  turnCount: number;
  createdAt: string;
}

export interface CreditPack {
  id: string;
  credits: number;
  price: { amount: number; currency: string };
}

export interface CreditOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId?: string;
  packId: string;
  credits: number;
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
    queryFn: () =>
      api.get<BalanceSummary>("/credits/balance").then((r) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Where the credits went: building, versus apps calling AI at runtime.
 *
 * Two different things draw on one balance, and until this existed only one of
 * them was visible anywhere — a deployed app burning credits showed up as a
 * balance that dropped for no stated reason.
 */
export interface SpendSummary {
  windowDays: number;
  since: string;
  build: { credits: number; microCredits: string };
  runtime: {
    credits: number;
    microCredits: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    byModel: { alias: string; requests: number; credits: number }[];
  };
  total: { credits: number; microCredits: string };
}

export function useSpend() {
  return useQuery({
    queryKey: billingKeys.spend,
    queryFn: () => api.get<SpendSummary>("/credits/spend").then((r) => r.data),
    staleTime: 30_000,
  });
}

export function useHistory(cursor?: string) {
  return useQuery({
    queryKey: billingKeys.history(cursor),
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      return api
        .get<{
          entries: LedgerEntry[];
          nextCursor: string | null;
        }>(`/credits/history?${params}`)
        .then((r) => r.data);
    },
    staleTime: 30_000,
  });
}

export function useCreditPacks() {
  return useQuery({
    queryKey: billingKeys.creditPacks,
    queryFn: () =>
      api
        .get<{ packs: CreditPack[] }>("/billing/credits/packs")
        .then((r) => r.data.packs),
    staleTime: 5 * 60_000,
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
        .post<{
          creditsGranted: number;
          available: number;
        }>("/credits/redeem", { code })
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
        .post<{
          subscriptionId: string;
          shortUrl: string;
        }>("/billing/subscribe")
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.subscription });
    },
  });
}

export function useCreateCreditOrder() {
  return useMutation({
    mutationFn: (packId: string) =>
      api
        .post<CreditOrder>("/billing/credits/order", { packId })
        .then((r) => r.data),
  });
}

export function useVerifyCreditPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      orderId: string;
      paymentId: string;
      signature: string;
    }) =>
      api
        .post<{
          creditsGranted: number;
          available: number;
        }>("/billing/credits/verify", input)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.balance });
      void qc.invalidateQueries({ queryKey: ["billing", "history"] });
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
