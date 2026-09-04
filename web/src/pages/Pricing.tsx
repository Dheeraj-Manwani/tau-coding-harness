import { Link } from "react-router-dom";
import { CheckCircleIcon } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { APP_BILLING } from "@/src/lib/routes";
import { cn } from "@/src/lib/utils";
import {
  CREDIT_PACKS,
  FREE_MAX_PROJECTS,
  FREE_SIGNUP_CREDITS,
  PRO_MONTHLY_CREDITS,
  PRO_PRICE_INR,
} from "@/src/features/marketing/data/effortTiers";

/**
 * Public pricing.
 *
 * Re-skinned to the space palette: this page predated the theme and was still
 * carrying `indigo-*` and a `ZapIcon` standing in for the τ mark, which made it
 * read as a different product to anyone arriving from the landing page.
 *
 * One claim was also removed. The Free plan listed "Download your code
 * anytime", which §9 of the landing plan flags as **live today but not built** —
 * there is no ZIP export. It has been replaced by what is genuinely true: you
 * push to a GitHub repo you own. Restore a download line only when export
 * actually exists.
 *
 * Figures come from `features/marketing/data/effortTiers.ts`, which cites the
 * constants in `api/src/lib/pricing.ts` and `billing.service.ts`, so this page
 * and the landing page can never quietly disagree.
 */

const FREE_FEATURES = [
  `${FREE_SIGNUP_CREDITS} free credits (one-time, on signup)`,
  `Up to ${FREE_MAX_PROJECTS} projects`,
  "Every effort tier, including Max",
  "Live preview in a secure sandbox",
  "Push your code to your own GitHub repo",
];

const PRO_FEATURES = [
  `${PRO_MONTHLY_CREDITS.toLocaleString()} credits per month`,
  "Everything in Free",
  "Unlimited projects",
  "Credits reset monthly with your billing cycle",
  "Priority support",
];

function PlanCard({
  name,
  price,
  period,
  features,
  cta,
  ctaHref,
  highlight,
  description,
}: {
  name: string;
  price: string;
  period?: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlight?: boolean;
  description: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border p-6",
        highlight
          ? "border-blue-500/40 bg-blue-500/5"
          : "border-silver-200 bg-space-surface",
      )}
    >
      {highlight && (
        <span className="mb-3 self-start rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-300">
          Most popular
        </span>
      )}
      <h3 className="text-lg font-semibold text-silver-900">{name}</h3>
      <p className="mt-1 text-sm text-silver-600">{description}</p>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-semibold text-silver-900">{price}</span>
        {period && <span className="text-sm text-silver-600">/{period}</span>}
      </div>

      <ul className="mt-6 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-blue-500" />
            <span className="text-silver-900/80">{f}</span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        className="mt-8"
        variant={highlight ? "default" : "outline"}
      >
        <Link to={ctaHref}>{cta}</Link>
      </Button>
    </div>
  );
}

export default function PricingPage() {
  useDocumentMeta({
    title: "Pricing",
    description:
      `Start free with ${FREE_SIGNUP_CREDITS} credits — no card. PRO is ₹${PRO_PRICE_INR} a month for ` +
      `${PRO_MONTHLY_CREDITS.toLocaleString()} credits, or top up with a credit pack any time.`,
    canonical: "/pricing",
  });

  return (
    <div className="min-h-[100svh] px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex justify-center">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
            <span className="logo-mark size-5" role="img" aria-hidden="true" />
            <span className="text-silver-900">tau</span>
          </Link>
        </div>

        <div className="mb-12 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-3 text-silver-600">
            Start for free. Upgrade when you need more.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <PlanCard
            name="Free"
            price="₹0"
            description="For individuals exploring AI-powered app building."
            features={FREE_FEATURES}
            cta="Get started free"
            ctaHref="/signup"
          />
          <PlanCard
            name="PRO"
            price={`₹${PRO_PRICE_INR}`}
            period="month"
            description="For power users who build frequently."
            features={PRO_FEATURES}
            cta="Upgrade to PRO"
            ctaHref={APP_BILLING}
            highlight
          />
        </div>

        <div className="mt-8 rounded-2xl border border-silver-200 bg-space-surface p-6">
          <h2 className="mb-4 text-base font-semibold text-silver-900">
            Credit packs
          </h2>
          <p className="mb-4 text-sm text-silver-600">
            Top up any time, with or without a subscription. Packs never expire.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {CREDIT_PACKS.map((pack) => (
              <div
                key={pack.credits}
                className="rounded-xl border border-silver-200 p-4"
              >
                <p className="font-mono text-lg text-silver-900">
                  {pack.credits.toLocaleString()}
                </p>
                <p className="text-xs text-silver-600">
                  credits · ₹{pack.inr}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-silver-200 bg-space-surface p-6">
          <h2 className="mb-4 text-base font-semibold text-silver-900">
            How credits work
          </h2>
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            {[
              {
                title: "What is a credit?",
                body: "One metered unit of model work. The total depends on input, output, and effort, and is shown live while a build runs.",
              },
              {
                title: "One-time free credits",
                body: `Free-tier users receive ${FREE_SIGNUP_CREDITS} credits once, when they sign up. There is no daily refill — when they run out, they can buy a pack, redeem a promo code, or upgrade to PRO.`,
              },
              {
                title: "PRO monthly grant",
                body: `PRO users receive ${PRO_MONTHLY_CREDITS.toLocaleString()} credits on their billing date each month. Unused plan credits expire at the end of the billing cycle.`,
              },
            ].map(({ title, body }) => (
              <div key={title}>
                <p className="mb-1 font-medium text-silver-900">{title}</p>
                <p className="text-silver-600">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-silver-600">
          <p>
            All prices are in Indian Rupees (INR) inclusive of applicable taxes.
            Payments are processed securely by{" "}
            <span className="font-medium text-silver-900">Razorpay</span>.
          </p>
          <p className="mt-2">
            <Link to="/terms" className="hover:underline">
              Terms &amp; Cancellation Policy
            </Link>{" "}
            ·{" "}
            <Link to="/privacy" className="hover:underline">
              Privacy Policy
            </Link>{" "}
            · Questions?{" "}
            <a href="mailto:support@usetau.dev" className="hover:underline">
              support@usetau.dev
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
