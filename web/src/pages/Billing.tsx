import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { celebrateSuccess } from "@/src/lib/confetti";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ReceiptTextIcon,
  ZapIcon,
} from "lucide-react";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
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
  type CreditPack,
  type LedgerEntry,
} from "@/src/features/billing/api";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { PageContainer } from "@/src/components/PageContainer";
import { UpgradeProButton } from "@/src/features/billing/UpgradeProButton";
import { ApiKeyCard } from "@/src/features/account/ApiKeyCard";
import { SpendSplitCard } from "@/src/features/billing/SpendSplitCard";
import { LANDING_TERMS } from "@/src/lib/routes";
import { PRO_PRICE_INR } from "@/src/lib/pricing";

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
  PLAN_GRANT: "Monthly PRO credits",
  PROMO_REDEEM: "Promo code",
  PURCHASE: "Purchase",
  DEBIT: "Tau build",
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
      celebrateSuccess("Payment successful! Your PRO plan is being activated.");
      onSuccess();
    },
  });
  rzp.on("payment.failed", toastPaymentFailed);
  rzp.open();
}

/** Checkout stays open after a failed attempt so the user can retry; just say why. */
function toastPaymentFailed(resp: RazorpayPaymentFailedResponse) {
  toast.error(resp.error.description || "Payment failed. Please try again.");
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Segments in the balance meter, lit proportionally across free/plan/bonus. */
const METER_SEGMENTS = 24;

function BalanceCard() {
  const { data: balance, isLoading } = useBalance();
  if (isLoading)
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-silver-200 bg-space-surface">
        <DataSpinner label="Loading credit balance" />
      </div>
    );
  if (!balance) return null;

  const { credits, plan, cycleEnd } = balance;
  const total = credits.free + credits.plan + credits.bonus || 1;
  const segmentsFor = (value: number) =>
    Math.round((value / total) * METER_SEGMENTS);
  const freeSegs = segmentsFor(credits.free);
  const planSegs = segmentsFor(credits.plan);
  const bonusSegs = Math.max(0, METER_SEGMENTS - freeSegs - planSegs);

  return (
    <div className="rounded-xl border border-silver-200 bg-space-surface p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Available credits</p>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
            plan === "PRO"
              ? "border-[#ff7a2e]/40 bg-[#ff7a2e]/10 text-[#ff9a5c]"
              : "border-silver-400/30 text-silver-600",
          )}
        >
          {plan} plan
        </span>
      </div>

      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="display-heading text-5xl text-silver-900">
          {fmt(credits.available)}
        </span>
        <span className="mono text-silver-600">CR</span>
      </div>

      <div className="mt-4 flex h-2.5 gap-0.5" aria-hidden="true">
        {Array.from({ length: METER_SEGMENTS }, (_, i) => {
          const kind =
            i < freeSegs ? "free" : i < freeSegs + planSegs ? "plan" : i < freeSegs + planSegs + bonusSegs ? "bonus" : "empty";
          return (
            <span
              key={i}
              className={cn(
                "h-full flex-1 rounded-[1px]",
                kind === "free" && "bg-blue-500",
                kind === "plan" && "bg-silver-900",
                kind === "bonus" && "bg-[#ff7a2e]",
                kind === "empty" && "bg-silver-200",
              )}
            />
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        {[
          { label: "Free", sub: "used first", value: credits.free, dot: "bg-blue-500" },
          { label: "Plan", sub: "resets monthly", value: credits.plan, dot: "bg-silver-900" },
          { label: "Bonus", sub: "never expires", value: credits.bonus, dot: "bg-[#ff7a2e]" },
        ].map(({ label, sub, value, dot }) => (
          <div key={label}>
            <div className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", dot)} />
              <p className="font-mono font-medium text-silver-900">{fmt(value)}</p>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {label.toUpperCase()} · {sub}
            </p>
          </div>
        ))}
      </div>

      {plan === "PRO" && cycleEnd && (
        <p className="mt-4 text-xs text-muted-foreground">
          Plan resets {fmtDate(cycleEnd)}
        </p>
      )}
    </div>
  );
}

const PRO_FEATURES = [
  "5,000 credits per month",
  "No tau badge on your previews and sites",
  "Your builds move to the front",
  "Credits reset monthly",
];

function PlanSection() {
  const { data: user } = useMe();
  const { data: sub, isLoading, refetch: refetchSub } = useSubscription();
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
    <div className="relative overflow-hidden rounded-xl border border-[#ff7a2e]/30 bg-space-surface p-5">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-[#ff7a2e] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#160700]">
          PRO
        </span>
        {!isActive && (
          <span className="mono text-silver-600">Cancel anytime</span>
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

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="display-heading text-4xl text-silver-900">
          ₹{PRO_PRICE_INR.toLocaleString("en-IN")}
        </span>
        <span className="mono text-silver-600">/ month</span>
      </div>

      <ul className="mt-4 space-y-2 text-sm">
        {PRO_FEATURES.map((f) => (
          <li key={f} className="flex items-center gap-2 text-silver-900/90">
            <ZapIcon className="size-3.5 shrink-0 fill-[#ff9a5c] text-[#ff9a5c]" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {isLoading ? (
          <DataSpinner label="Loading subscription" />
        ) : !isActive ? (
          <UpgradeProButton
            onClick={handleUpgrade}
            disabled={subscribePro.isPending}
          >
            {subscribePro.isPending ? "Preparing checkout…" : "Upgrade to PRO ↗"}
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
      onSuccess: () => {
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
    <div className="rounded-xl border border-silver-200 bg-space-surface p-5">
      <h2 className="display-heading text-lg text-silver-900">Redeem a code</h2>
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
      <p className="mt-2 text-xs text-muted-foreground">
        Codes from events and feedback rewards land as bonus credits.
      </p>
    </div>
  );
}

function PackCard({
  pack,
  tag,
  selected,
  onSelect,
}: {
  pack: CreditPack;
  tag?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative flex flex-col items-start rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-blue-500/60 bg-blue-500/5"
          : "border-silver-200 bg-space-void hover:border-silver-400/60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute right-3 top-3 flex size-4 items-center justify-center rounded-full border",
          selected ? "border-blue-400 bg-blue-500" : "border-silver-400",
        )}
      >
        {selected && <span className="size-1.5 rounded-full bg-space-void" />}
      </span>
      {tag && <span className="mono text-blue-400">{tag}</span>}
      <span className="display-heading mt-1 text-2xl text-silver-900">
        {pack.credits.toLocaleString()}
        <span className="ml-1 text-sm text-silver-600">CR</span>
      </span>
      <span className="mt-1 text-sm font-medium text-silver-900">
        {formatPrice(pack.price)}
      </span>
    </button>
  );
}

const PACK_TAGS = ["Quick fix", "Most picked", "Big ideas"];

function TopUpSection() {
  const { data: user } = useMe();
  const { data: balance } = useBalance();
  const { data: packs, isLoading } = useCreditPacks();
  const createOrder = useCreateCreditOrder();
  const verifyPayment = useVerifyCreditPayment();
  const [pendingPack, setPendingPack] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default selection: the middle pack, until the user picks one themselves
  // (derived at render instead of synced via effect - packs load exactly once).
  const effectiveId =
    selectedId ??
    (packs?.length ? packs[Math.floor(packs.length / 2)]!.id : null);
  const selected = packs?.find((p) => p.id === effectiveId) ?? null;

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
                // The webhook backstop will still land the credits: don't alarm.
                onError: () =>
                  celebrateSuccess("Payment received: credits will appear shortly."),
                onSettled: () => setPendingPack(null),
              },
            );
          },
          modal: { ondismiss: () => setPendingPack(null) },
        });
        rzp.on("payment.failed", toastPaymentFailed);
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
    <div className="rounded-xl border border-silver-200 bg-space-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display-heading text-2xl text-silver-900">Top up</h2>
        <p className="mono text-silver-600">Paid securely · UPI, cards</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        One-time packs. Credits never expire and work on any plan.
      </p>

      {isLoading ? (
        <div className="mt-4 flex min-h-20 items-center justify-center">
          <DataSpinner label="Loading credit packs" />
        </div>
      ) : packs?.length ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {packs.map((pack, i) => (
              <PackCard
                key={pack.id}
                pack={pack}
                tag={PACK_TAGS[i]}
                selected={pack.id === effectiveId}
                onSelect={() => setSelectedId(pack.id)}
              />
            ))}
          </div>

          {selected && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-silver-200 pt-4">
              <p className="text-sm text-muted-foreground">
                New balance after purchase{" "}
                <span className="font-mono font-medium text-silver-900">
                  {balance
                    ? fmt(balance.credits.available + selected.credits)
                    : "—"}{" "}
                  CR
                </span>
              </p>
              <Button
                disabled={pendingPack !== null}
                onClick={() => handleBuy(selected.id)}
              >
                {pendingPack === selected.id
                  ? "Opening…"
                  : `Buy ${selected.credits.toLocaleString()} credits · ${formatPrice(selected.price)}`}
              </Button>
            </div>
          )}
        </>
      ) : null}
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
    !isGeneration && entry.reason && entry.reason !== baseLabel.toLowerCase()
      ? entry.reason
      : null;

  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            isDebit ? "bg-space-overlay text-silver-600" : "bg-emerald-500/10 text-emerald-400",
          )}
        >
          <ZapIcon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-silver-900">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {fmtTime(entry.createdAt)}
            {detail ? ` · ${detail}` : ""}
            {` · bal ${fmt(entry.balanceAfter)}`}
          </p>
        </div>
      </div>
      <span
        className={cn(
          "ml-4 shrink-0 font-mono text-sm font-medium",
          isDebit ? "text-silver-900" : "text-emerald-400",
        )}
      >
        {isDebit ? "" : "+"}
        {fmt(entry.credits)}
      </span>
    </div>
  );
}

const HISTORY_FILTERS = ["All", "Spent", "Added"] as const;
type HistoryFilter = (typeof HISTORY_FILTERS)[number];

function HistorySection() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [allEntries, setAllEntries] = useState<LedgerEntry[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>("All");
  const { data, isFetching } = useHistory(cursor);
  const nextCursor = data?.nextCursor ?? null;

  useEffect(() => {
    if (!data?.entries.length) return;
    // Each cursor response is a new server page that must be appended locally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAllEntries((prev) => {
      const ids = new Set(prev.map((e) => e.id));
      const fresh = data.entries.filter((e) => !ids.has(e.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, [data]);

  const entries = useMemo(() => {
    if (filter === "All") return allEntries;
    return allEntries.filter((e) =>
      filter === "Spent" ? e.credits < 0 : e.credits > 0,
    );
  }, [allEntries, filter]);

  return (
    <div className="rounded-xl border border-silver-200 bg-space-surface p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ReceiptTextIcon className="size-4 text-muted-foreground" />
          <h2 className="display-heading text-xl text-silver-900">
            Credit history
          </h2>
        </div>
        <div className="flex gap-1 rounded-lg border border-silver-400/30 p-0.5">
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium uppercase tracking-wide transition-colors",
                filter === f
                  ? "bg-space-overlay text-silver-900"
                  : "text-silver-600 hover:text-silver-900",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 && !isFetching && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No transactions yet.
        </p>
      )}

      <div>
        {entries.map((e, i) => {
          const prev = entries[i - 1];
          const showHeader =
            !prev || dayLabel(prev.createdAt) !== dayLabel(e.createdAt);
          return (
            <div key={e.id}>
              {showHeader && (
                <p className="eyebrow mt-3 pb-1 first:mt-1">
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
          <DataSpinner label="Loading credit history" />
        </div>
      )}

      {nextCursor && !isFetching && (
        <button
          type="button"
          onClick={() => setCursor(nextCursor)}
          className="mt-2 flex w-full items-center justify-center gap-1 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDownIcon className="size-3" />
          Load older
        </button>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  useDocumentMeta({ title: "Billing", noIndex: true });

  const navigate = useNavigate();
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === "#buy-credits" || hash === "#pro-plan") {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
    }
  }, [hash]);

  return (
    <PageContainer className="max-w-4xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="eyebrow mb-6 flex items-center gap-1.5 cursor-pointer transition-colors hover:text-blue-300"
      >
        <ArrowLeftIcon className="size-3" />
        Back to building
      </button>

      <h1 className="display-heading mb-6 text-4xl text-silver-900 sm:text-5xl">
        Credits &amp; <span className="text-cosmic">billing</span>
      </h1>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <BalanceCard />
          <div id="pro-plan" className="scroll-mt-4">
            <PlanSection />
          </div>
        </div>

        <div id="buy-credits" className="scroll-mt-4">
          <TopUpSection />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <RedeemSection />
          <ApiKeyCard />
        </div>

        {/* Below the key card on purpose: the runtime half of this split is
            spend by apps using that key. */}
        <SpendSplitCard />

        <HistorySection />
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        <AlertTriangleIcon className="inline size-3 align-middle" /> Free tier
        gives 300 credits once. PRO gives 5,000/month.
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Payments processed by Razorpay. No prorated refunds for partial billing
        periods. See our{" "}
        <a href={LANDING_TERMS} className="underline hover:text-foreground">
          Cancellation &amp; Refund Policy
        </a>{" "}
        · Questions?{" "}
        <a
          href="mailto:iammadfortech@gmail.com"
          className="underline hover:text-foreground"
        >
          iammadfortech@gmail.com
        </a>
      </p>
    </PageContainer>
  );
}
