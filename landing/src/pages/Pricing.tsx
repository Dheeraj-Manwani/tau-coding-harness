import { Link } from "react-router-dom";
import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { APP_BILLING, APP_HOME } from "@/src/lib/routes";
import {
  CREDIT_PACKS,
  FREE_SIGNUP_CREDITS,
  PRO_MONTHLY_CREDITS,
  PRO_PRICE_INR,
} from "@/src/features/marketing/data/effortTiers";
import {
  FREE_FEATURES,
  PACK_TAGS,
  PRO_FEATURES,
  PlanCard,
  litSegmentsFor,
} from "@/src/features/marketing/sections/Pricing";

/**
 * Public pricing.
 *
 * Re-skinned to the storm hero's bold type voice (Big Shoulders Display,
 * `.eyebrow`, `.tier-card`/`.effort-meter`) via the shared `PlanCard` in
 * `sections/Pricing.tsx`, which the home page's teaser section also renders -
 * one set of cards, one set of numbers, two places they show up.
 *
 * Only two real plans exist (Free, PRO): there is no middle paid tier and no
 * yearly billing in the product, so this does not add either just to mirror
 * a three-card reference layout. Figures come from
 * `features/marketing/data/effortTiers.ts`, which cites the constants in
 * `api/src/lib/pricing.ts` and `billing.service.ts`, so this page and the
 * landing page can never quietly disagree.
 *
 * One claim was removed in an earlier pass. The Free plan listed "Download
 * your code anytime" - not built, no ZIP export - replaced by what is
 * genuinely true: you push to a GitHub repo you own.
 *
 * Routed inside `MarketingShell` alongside `/` and `/changelog`, so it gets
 * the real storm nav/footer instead of a one-off logo link.
 */
export default function PricingPage() {
  useDocumentMeta({
    title: "Pricing",
    description:
      `Start free with ${FREE_SIGNUP_CREDITS} credits: no card. PRO is ₹${PRO_PRICE_INR} a month for ` +
      `${PRO_MONTHLY_CREDITS.toLocaleString()} credits, or top up with a credit pack any time.`,
    canonical: "/pricing",
  });

  return (
    <div className="px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <div className="mb-14 text-center">
          <p className="eyebrow">// Pricing</p>
          <h1 className="display-heading mt-3 text-5xl text-silver-900 sm:text-7xl">
            Pay per
            <br />
            <span className="text-blue-300">strike</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-silver-600">
            Every plan runs on credits. A build only spends what it uses, and
            effort caps the most any single strike can spend.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <PlanCard
            name="Free"
            description="For turning your first few ideas into real apps."
            price="₹0"
            period="forever"
            creditsLabel={FREE_SIGNUP_CREDITS.toString()}
            litSegments={litSegmentsFor(FREE_SIGNUP_CREDITS)}
            features={FREE_FEATURES}
            bestFor="For a handful of real projects"
            cta="Open Tau"
            ctaHref={APP_HOME}
          />
          <PlanCard
            name="PRO"
            badge="Most picked"
            description="For people who build often and want more room to run."
            price={`₹${PRO_PRICE_INR}`}
            period="/ month"
            creditsLabel={PRO_MONTHLY_CREDITS.toLocaleString()}
            litSegments={litSegmentsFor(PRO_MONTHLY_CREDITS)}
            features={PRO_FEATURES}
            bestFor="For builders who ship every week"
            cta="Upgrade to PRO"
            ctaHref={APP_BILLING}
            highlight
          />
        </div>

        <div className="mt-8 rounded-2xl border border-silver-200 bg-space-surface p-6">
          <h2 className="mb-1 text-base font-semibold text-silver-900">
            Top up anytime
          </h2>
          <p className="mb-5 text-sm text-silver-600">
            One-time packs, with or without a subscription. Credits never
            expire.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {CREDIT_PACKS.map((pack) => (
              <div
                key={pack.credits}
                className="rounded-xl border border-silver-200 bg-space-void p-4 text-center"
              >
                {PACK_TAGS[pack.credits] && (
                  <p className="mono mb-2 text-blue-400">
                    {PACK_TAGS[pack.credits]}
                  </p>
                )}
                <p className="display-heading text-2xl text-silver-900">
                  {pack.credits.toLocaleString()}
                </p>
                <p className="mono text-silver-600">CR · ₹{pack.inr}</p>
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
                body: "Credits pay for the work Tau does. Bigger requests and higher effort use more, and you can watch the total as Tau works.",
              },
              {
                title: "One-time free credits",
                body: `You get ${FREE_SIGNUP_CREDITS} credits when you sign up. They do not refill each day, but you can buy a pack, use a promo code, or move to PRO whenever you need more.`,
              },
              {
                title: "Monthly PRO credits",
                body: `PRO adds ${PRO_MONTHLY_CREDITS.toLocaleString()} credits on your billing date each month. Any unused monthly credits expire when the next month begins.`,
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
            <a href="mailto:iammadfortech@gmail.com" className="hover:underline">
              iammadfortech@gmail.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
