import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ReceiptTextIcon,
  ZapIcon,
} from "lucide-react";

import { env } from "@/src/lib/env";
import { cn } from "@/src/lib/utils";
import { ApiError } from "@/src/lib/api-client";
import { useMe } from "@/src/features/auth/queries";
import {
  useBalance,
  useCancelSubscription,
  useHistory,
  useRedeemCode,
  useSubscribePro,
  useSubscription,
  type LedgerEntry,
} from "@/src/features/billing/api";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const LEDGER_LABELS: Record<string, string> = {
  SIGNUP_GRANT: "Signup bonus",
  DAILY_FREE_GRANT: "Daily free credits",
  PLAN_GRANT: "PRO plan grant",
  PROMO_REDEEM: "Promo code",
  PURCHASE: "Purchase",
  DEBIT: "Generation",
  REFUND: "Refund",
  EXPIRE: "Expired credits",
  ADJUSTMENT: "Adjustment",
};

const ACTIVE_STATUSES = new Set(["CREATED", "AUTHENTICATED", "ACTIVE", "PENDING"]);

// ── Razorpay checkout ────────────────────────────────────────────────────────

function openRazorpayCheckout(
  subscriptionId: string,
  userEmail: string,
  onSuccess: () => void,
) {
  if (!window.Razorpay) {
    toast.error("Payment library not loaded. Please refresh and try again.");
    return;
  }
  const rzp = new window.Razorpay({
    key: env.RAZORPAY_KEY_ID,
    subscription_id: subscriptionId,
    name: "Tau",
    description: "PRO Monthly Plan",
    prefill: { email: userEmail },
    theme: { color: "#6366f1" },
    handler: () => {
      toast.success("Payment successful! Your PRO plan is being activated.");
      onSuccess();
    },
  });
  rzp.open();
}

// ── Sub-components ───────────────────────────────────────────────────────────

function BalanceCard() {
  const { data: balance } = useBalance();
  if (!balance) return <div className="h-28 animate-pulse rounded-xl bg-muted" />;

  const { credits, plan, cycleEnd } = balance;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Available credits</p>
          <p className="mt-0.5 text-3xl font-semibold tracking-tight">
            {fmt(credits.available)}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium",
            plan === "PRO"
              ? "bg-indigo-500/10 text-indigo-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {plan}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
        {[
          { label: "Free", value: credits.free },
          { label: "Plan", value: credits.plan },
          { label: "Bonus", value: credits.bonus },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-medium">{fmt(value)}</p>
          </div>
        ))}
      </div>

      {plan === "PRO" && cycleEnd && (
        <p className="mt-3 text-xs text-muted-foreground">
          Plan resets {fmtDate(cycleEnd)}
        </p>
      )}
    </div>
  );
}

function PlanSection() {
  const { data: user } = useMe();
  const { data: sub, refetch: refetchSub } = useSubscription();
  const { refetch: refetchBalance } = useBalance();
  const subscribePro = useSubscribePro();
  const cancelSub = useCancelSubscription();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const isActive = sub ? ACTIVE_STATUSES.has(sub.status) : false;

  const handleUpgrade = () => {
    subscribePro.mutate(undefined, {
      onSuccess: (data) => {
        openRazorpayCheckout(
          data.subscriptionId,
          user?.email ?? "",
          () => {
            void refetchSub();
            void refetchBalance();
          },
        );
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Could not start subscription");
      },
    });
  };

  const handleCancel = () => {
    cancelSub.mutate(undefined, {
      onSuccess: () => {
        toast.success("Subscription will cancel at the end of this billing cycle.");
        setConfirmCancel(false);
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Could not cancel subscription");
      },
    });
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-medium">PRO plan — ₹999/month</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        {["5,000 credits per month", "Priority generation queue", "Credits reset monthly"].map((f) => (
          <li key={f} className="flex items-center gap-2">
            <CheckCircleIcon className="size-3.5 shrink-0 text-indigo-400" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!isActive ? (
          <Button onClick={handleUpgrade} disabled={subscribePro.isPending}>
            {subscribePro.isPending ? "Preparing checkout…" : "Upgrade to PRO"}
          </Button>
        ) : (
          <>
            {sub?.cancelAtCycleEnd ? (
              <p className="text-sm text-muted-foreground">
                Cancels {sub.currentEnd ? fmtDate(sub.currentEnd) : "at cycle end"}
              </p>
            ) : confirmCancel ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Cancel at cycle end?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleCancel}
                  disabled={cancelSub.isPending}
                >
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                  Keep plan
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmCancel(true)}
              >
                Cancel subscription
              </Button>
            )}
          </>
        )}

        {sub && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
              sub.status === "ACTIVE"
                ? "bg-emerald-500/10 text-emerald-400"
                : sub.status === "CANCELLED" || sub.status === "EXPIRED"
                  ? "bg-red-500/10 text-red-400"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {sub.status.toLowerCase()}
          </span>
        )}
      </div>
    </div>
  );
}

function RedeemSection() {
  const [code, setCode] = useState("");
  const redeemCode = useRedeemCode();

  const handleSubmit = () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    redeemCode.mutate(trimmed, {
      onSuccess: (data) => {
        toast.success(`+${fmt(data.creditsGranted)} credits added!`);
        setCode("");
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Invalid promo code");
      },
    });
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-medium">Redeem a promo code</h2>
      <div className="mt-3 flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="PROMO-CODE"
          className="font-mono"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        <Button
          onClick={handleSubmit}
          variant="outline"
          disabled={!code.trim() || redeemCode.isPending}
        >
          {redeemCode.isPending ? "Applying…" : "Apply"}
        </Button>
      </div>
    </div>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const isDebit = entry.credits < 0;
  const label = LEDGER_LABELS[entry.type] ?? entry.type;
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{label}</p>
        {entry.reason && entry.reason !== label.toLowerCase() && (
          <p className="truncate text-xs text-muted-foreground">{entry.reason}</p>
        )}
        <p className="text-xs text-muted-foreground">{fmtDate(entry.createdAt)}</p>
      </div>
      <span
        className={cn(
          "ml-4 shrink-0 font-mono text-sm font-medium",
          isDebit ? "text-red-400" : "text-emerald-400",
        )}
      >
        {isDebit ? "" : "+"}
        {fmt(entry.credits)}
      </span>
    </div>
  );
}

function HistorySection() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [allEntries, setAllEntries] = useState<LedgerEntry[]>([]);
  const { data, isFetching } = useHistory(cursor);
  const nextCursor = data?.nextCursor ?? null;

  useEffect(() => {
    if (!data?.entries.length) return;
    setAllEntries((prev) => {
      const ids = new Set(prev.map((e) => e.id));
      const fresh = data.entries.filter((e) => !ids.has(e.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, [data]);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <ReceiptTextIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Credit history</h2>
      </div>

      {allEntries.length === 0 && !isFetching && (
        <p className="py-6 text-center text-sm text-muted-foreground">No transactions yet.</p>
      )}

      <div className="divide-y">
        {allEntries.map((e) => (
          <LedgerRow key={e.id} entry={e} />
        ))}
      </div>

      {isFetching && (
        <div className="flex justify-center py-4">
          <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}

      {nextCursor && !isFetching && (
        <button
          type="button"
          onClick={() => setCursor(nextCursor)}
          className="mt-2 flex w-full items-center justify-center gap-1 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDownIcon className="size-3" />
          Load more
        </button>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back
      </button>

      <div className="mb-6 flex items-center gap-2">
        <ZapIcon className="size-5 text-indigo-400" />
        <h1 className="text-xl font-semibold">Credits &amp; Billing</h1>
      </div>

      <div className="space-y-4">
        <BalanceCard />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <PlanSection />
          </div>
          <div className="sm:col-span-2">
            <RedeemSection />
          </div>
        </div>

        <HistorySection />
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        <AlertTriangleIcon className="inline size-3 align-middle" /> Free tier gives 50 credits/day. PRO gives 5,000/month.
      </p>
    </div>
  );
}
