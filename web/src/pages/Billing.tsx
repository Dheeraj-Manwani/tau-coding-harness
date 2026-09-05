import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { celebratePromoRedemption } from "@/src/lib/confetti";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ReceiptTextIcon,
  Wallet,
} from "lucide-react";

import { env } from "@/src/lib/env";
import { cn } from "@/src/lib/utils";
import { ApiError } from "@/src/lib/api-client";
import { useMe } from "@/src/features/auth/queries";
import {
  useBalance,
  useCancelSubscription,
  useCreateCreditOrder,
  useCreditPacks,
  useHistory,
  useRedeemCode,
  useSubscribePro,
  useSubscription,
  useVerifyCreditPayment,
  type LedgerEntry,
} from "@/src/features/billing/api";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { UpgradeProButton } from "@/src/features/billing/UpgradeProButton";
import { ApiKeyCard } from "@/src/features/account/ApiKeyCard";
import { SpendSplitCard } from "@/src/features/billing/SpendSplitCard";
import { PRO_PRICE_INR } from "@/src/features/marketing/data/effortTiers";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

/** Format a minor-unit price (e.g. INR paise) for display. */
function formatPrice(price: { amount: number; currency: string }): string {
  const major = price.amount / 100;
  if (price.currency === "INR") return `₹${major.toFixed(0)}`;
  return `${major.toFixed(2)} ${price.currency}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Day header label for grouping: "Today" / "Yesterday" / "Jul 6, 2026". */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return fmtDate(iso);
}

const LEDGER_LABELS: Record<string, string> = {
  SIGNUP_GRANT: "Signup bonus",
  DAILY_FREE_GRANT: "Daily free credits",
  PLAN_GRANT: "PRO plan grant",
  PROMO_REDEEM: "Promo code",
  PURCHASE: "Purchase",
  DEBIT: "Generation",
  // Runtime inference from a deployed app, as opposed to DEBIT's "tau built
  // something for you". Different enough that one label for both would be
  // actively misleading on a bill.
  GATEWAY_DEBIT: "App AI usage",
  REFUND: "Refund",
  EXPIRE: "Expired credits",
  ADJUSTMENT: "Adjustment",
};

const ACTIVE_STATUSES = new Set([
  "CREATED",
  "AUTHENTICATED",
  "ACTIVE",
  "PENDING",
]);

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
  if (!balance)
    return <div className="h-28 animate-pulse rounded-xl bg-muted" />;

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
        openRazorpayCheckout(data.subscriptionId, user?.email ?? "", () => {
          void refetchSub();
          void refetchBalance();
        });
      },
      onError: (err) => {
        toast.error(
          err instanceof ApiError
            ? err.message
            : "Could not start subscription",
        );
      },
    });
  };

  const handleCancel = () => {
    cancelSub.mutate(undefined, {
      onSuccess: () => {
        toast.success(
          "Subscription will cancel at the end of this billing cycle.",
        );
        setConfirmCancel(false);
      },
      onError: (err) => {
        toast.error(
          err instanceof ApiError
            ? err.message
            : "Could not cancel subscription",
        );
      },
    });
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-medium">
        PRO plan — ₹{PRO_PRICE_INR.toLocaleString("en-IN")}/month
      </h2>
      <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        {[
          "5,000 credits per month",
          "Priority generation queue",
          "Credits reset monthly",
        ].map((f) => (
          <li key={f} className="flex items-center gap-2">
            <CheckCircleIcon className="size-3.5 shrink-0 text-indigo-400" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!isActive ? (
          <UpgradeProButton
            onClick={handleUpgrade}
            disabled={subscribePro.isPending}
          >
            {subscribePro.isPending ? "Preparing checkout…" : "Upgrade to PRO"}
          </UpgradeProButton>
        ) : (
          <>
            {sub?.cancelAtCycleEnd ? (
              <p className="text-sm text-muted-foreground">
                Cancels{" "}
                {sub.currentEnd ? fmtDate(sub.currentEnd) : "at cycle end"}
              </p>
            ) : confirmCancel ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Cancel at cycle end?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleCancel}
                  disabled={cancelSub.isPending}
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmCancel(false)}
                >
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
        celebratePromoRedemption();
        toast.success(`+${fmt(data.creditsGranted)} credits added!`);
        setCode("");
      },
      onError: (err) => {
        toast.error(
          err instanceof ApiError ? err.message : "Invalid promo code",
        );
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

function TopUpSection() {
  const { data: user } = useMe();
  const { data: packs } = useCreditPacks();
  const createOrder = useCreateCreditOrder();
  const verifyPayment = useVerifyCreditPayment();
  const [pendingPack, setPendingPack] = useState<string | null>(null);

  const handleBuy = (packId: string) => {
    setPendingPack(packId);
    createOrder.mutate(packId, {
      onSuccess: (order) => {
        if (!window.Razorpay) {
          toast.error(
            "Payment library not loaded. Please refresh and try again.",
          );
          setPendingPack(null);
          return;
        }
        const rzp = new window.Razorpay({
          key: order.keyId ?? env.RAZORPAY_KEY_ID,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: "Tau",
          description: `${order.credits} credits`,
          prefill: { email: user?.email ?? "" },
          theme: { color: "#6366f1" },
          handler: (resp) => {
            verifyPayment.mutate(
              {
                orderId: resp.razorpay_order_id ?? order.orderId,
                paymentId: resp.razorpay_payment_id,
                signature: resp.razorpay_signature,
              },
              {
                onSuccess: (data) =>
                  toast.success(`+${fmt(data.creditsGranted)} credits added!`),
                // The webhook backstop will still land the credits — don't alarm.
                onError: () =>
                  toast.success("Payment received — credits will appear shortly."),
                onSettled: () => setPendingPack(null),
              },
            );
          },
          modal: { ondismiss: () => setPendingPack(null) },
        });
        rzp.open();
      },
      onError: (err) => {
        toast.error(
          err instanceof ApiError ? err.message : "Could not start checkout",
        );
        setPendingPack(null);
      },
    });
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-medium">Buy credits</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        One-time top-ups — credits never expire. Available on any plan.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {packs
          ? packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                disabled={pendingPack !== null}
                onClick={() => handleBuy(pack.id)}
                className="flex flex-col items-center rounded-lg border bg-background p-3 text-center transition-colors hover:border-indigo-400 disabled:opacity-50"
              >
                <span className="text-lg font-semibold">{pack.credits}</span>
                <span className="text-xs text-muted-foreground">credits</span>
                <span className="mt-1 text-sm font-medium">
                  {formatPrice(pack.price)}
                </span>
                {pendingPack === pack.id && (
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    Opening…
                  </span>
                )}
              </button>
            ))
          : Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
      </div>
    </div>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const isDebit = entry.credits < 0;
  const isGeneration = entry.type === "DEBIT";

  // Generations get a richer title: "Generation · <project>" (or just
  // "Generation" if the project was since deleted). Everything else uses its
  // label.
  const baseLabel = LEDGER_LABELS[entry.type] ?? entry.type;
  const title =
    isGeneration && entry.projectName
      ? `${baseLabel} · ${entry.projectName}`
      : baseLabel;

  // Secondary line: turn count for multi-turn generations, else the raw reason
  // when it adds something beyond the label.
  const detail =
    isGeneration && entry.turnCount > 1
      ? `${entry.turnCount} turns`
      : entry.reason && entry.reason !== baseLabel.toLowerCase()
        ? entry.reason
        : null;

  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {fmtTime(entry.createdAt)}
          {detail ? ` · ${detail}` : ""}
          {` · balance ${fmt(entry.balanceAfter)}`}
        </p>
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
        <p className="py-6 text-center text-sm text-muted-foreground">
          No transactions yet.
        </p>
      )}

      <div>
        {allEntries.map((e, i) => {
          const prev = allEntries[i - 1];
          const showHeader =
            !prev || dayLabel(prev.createdAt) !== dayLabel(e.createdAt);
          return (
            <div key={e.id}>
              {showHeader && (
                <p className="mt-3 pb-1 text-xs font-medium text-muted-foreground first:mt-1">
                  {dayLabel(e.createdAt)}
                </p>
              )}
              <div className="border-t border-border/50">
                <LedgerRow entry={e} />
              </div>
            </div>
          );
        })}
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
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back
      </button>

      <div className="mb-6 flex items-center gap-2">
        <Wallet />
        {/* <ZapIcon className="size-5 text-indigo-400" /> */}
        <h1 className="text-xl font-semibold">Credits &amp; Billing</h1>
      </div>

      <div className="space-y-4">
        <BalanceCard />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <PlanSection />
          </div>
          <div className="sm:col-span-2">
            <TopUpSection />
          </div>
          <div className="sm:col-span-2">
            <RedeemSection />
          </div>
          <div className="sm:col-span-2">
            <ApiKeyCard />
          </div>
          {/* Below the key card on purpose: the runtime half of this split is
              spend by apps using that key. */}
          <div className="sm:col-span-2">
            <SpendSplitCard />
          </div>
        </div>

        <HistorySection />
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        <AlertTriangleIcon className="inline size-3 align-middle" /> Free tier
        gives 200 credits once. PRO gives 5,000/month.
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Payments processed by Razorpay. No prorated refunds for partial billing
        periods. See our{" "}
        <a href="/terms" className="underline hover:text-foreground">
          Cancellation &amp; Refund Policy
        </a>{" "}
        · Questions?{" "}
        <a
          href="mailto:support@usetau.dev"
          className="underline hover:text-foreground"
        >
          support@usetau.dev
        </a>
      </p>
    </div>
  );
}
