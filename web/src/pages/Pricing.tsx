import { Link } from "react-router-dom";
import { CheckCircleIcon, ZapIcon } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

const FREE_FEATURES = [
  "50 credits per day (resets at midnight UTC)",
  "Unlimited projects",
  "AI-powered code generation",
  "Live preview in secure sandbox",
  "Download your code anytime",
];

const PRO_FEATURES = [
  "5,000 credits per month",
  "Everything in Free",
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
          ? "border-indigo-500/50 bg-indigo-500/5"
          : "border-border bg-card",
      )}
    >
      {highlight && (
        <span className="mb-3 self-start rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-medium text-indigo-400">
          Most popular
        </span>
      )}
      <h3 className="text-lg font-semibold">{name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-bold">{price}</span>
        {period && (
          <span className="text-sm text-muted-foreground">/{period}</span>
        )}
      </div>

      <ul className="mt-6 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-indigo-400" />
            <span className="text-foreground/80">{f}</span>
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
  return (
    <div className="min-h-[100svh] px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex justify-center">
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <ZapIcon className="size-5 text-indigo-400" />
            tau
          </Link>
        </div>

        <div className="mb-12 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-3 text-muted-foreground">
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
            price="₹999"
            period="month"
            description="For power users who build frequently."
            features={PRO_FEATURES}
            cta="Upgrade to PRO"
            ctaHref="/billing"
            highlight
          />
        </div>

        <div className="mt-12 rounded-xl border bg-card p-6">
          <h2 className="mb-4 text-base font-semibold">How credits work</h2>
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            {[
              {
                title: "What is a credit?",
                body: "Each AI generation consumes credits based on the amount of code produced. Generating a simple landing page costs roughly 5–15 credits.",
              },
              {
                title: "Free daily refill",
                body: "Free-tier users receive 50 credits at midnight UTC every day. Unused free credits expire — they don't roll over.",
              },
              {
                title: "PRO monthly grant",
                body: "PRO users receive 5,000 credits on their billing date each month. Unused plan credits expire at the end of the billing cycle.",
              },
            ].map(({ title, body }) => (
              <div key={title}>
                <p className="mb-1 font-medium">{title}</p>
                <p className="text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            All prices are in Indian Rupees (INR) inclusive of applicable taxes.
            Payments are processed securely by{" "}
            <span className="font-medium text-foreground">Razorpay</span>.
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
            <a
              href="mailto:support@usetau.dev"
              className="hover:underline"
            >
              support@usetau.dev
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
