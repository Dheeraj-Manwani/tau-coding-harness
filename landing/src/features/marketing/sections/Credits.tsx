import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { APP_BILLING } from "@/src/lib/routes";
import {
  CREDIT_PACKS,
  FREE_MAX_PROJECTS,
  FREE_SIGNUP_CREDITS,
  PRO_MONTHLY_CREDITS,
  PRO_PRICE_INR,
} from "@/src/features/marketing/data/effortTiers";
import { ScrollReveal, Stagger } from "@/src/features/marketing/motion/ScrollReveal";
import { useIsVisible } from "@/src/features/marketing/motion/useRafLoop";

/**
 * §4.9 — "You pay for work done, not seats."
 *
 * Numbers come from `data/effortTiers.ts`, which cites the constants in
 * `api/src/lib/pricing.ts` and `billing.service.ts`. The one soft figure on the
 * page explains that credits meter model work and vary with token usage, and is worded as
 * an estimate because that is what it is — unlike every other number here,
 * there is no constant behind it.
 *
 * The fuel gauge counts to the free grant on view; the split bar below it is
 * the section's real argument, that build spend and runtime spend are two
 * different things and tau shows them apart.
 */

const CREDIT_ESTIMATE = "5–15";

export function Credits() {
  const sectionRef = useRef<HTMLElement>(null);
  const visible = useIsVisible(sectionRef, "-15%");
  const reduceMotion = useReduceMotion();
  const [counted, setCounted] = useState(0);
  // Reduced motion shows the full gauge outright rather than animating to it.
  const filled = reduceMotion ? FREE_SIGNUP_CREDITS : counted;

  useEffect(() => {
    if (!visible || reduceMotion) return;
    let frame = 0;
    const startedAt = performance.now();
    const DURATION = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / DURATION);
      setCounted(Math.round(FREE_SIGNUP_CREDITS * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, reduceMotion]);

  return (
    <section
      id="credits"
      ref={sectionRef}
      className="mx-auto w-full max-w-6xl px-6 py-24"
    >
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          Fuel
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          You pay for work done, not seats.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-silver-600">
          A credit is one unit of agent work. A small landing page runs roughly{" "}
          {CREDIT_ESTIMATE} credits.
        </p>
      </ScrollReveal>

      {/* The fuel gauge. */}
      <ScrollReveal className="mx-auto mt-12 max-w-xl">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-silver-600">Free on signup</span>
          <span className="font-mono tabular-nums text-silver-900">
            {filled} credits
          </span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-space-overlay">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-[var(--chart-5)] transition-[width] duration-150"
            style={{ width: `${(filled / FREE_SIGNUP_CREDITS) * 100}%` }}
          />
        </div>

        {/* Two kinds of spend, shown apart — the point of the whole band. */}
        <div className="mt-8">
          <p className="text-sm text-silver-600">
            Spend is metered in two buckets, and shown separately:
          </p>
          <div className="mt-3 flex gap-1.5">
            <div className="h-2 flex-[3] rounded-full bg-blue-500" />
            <div className="h-2 flex-1 rounded-full bg-[var(--chart-5)]" />
          </div>
          <div className="mt-2 flex justify-between text-xs text-silver-600">
            <span>
              <span className="text-blue-300">Build</span> — the agent working
            </span>
            <span>
              <span className="text-[var(--chart-5)]">Runtime</span> — your app
              calling the gateway
            </span>
          </div>
        </div>
      </ScrollReveal>

      <Stagger className="mt-14 grid gap-6 md:grid-cols-3">
        <ScrollReveal asChildOfStagger>
          <PlanCard
            name="Free"
            price="₹0"
            lines={[
              `${FREE_SIGNUP_CREDITS} credits at signup, one time`,
              `Up to ${FREE_MAX_PROJECTS} projects`,
              "Every effort tier available",
            ]}
          />
        </ScrollReveal>
        <ScrollReveal asChildOfStagger>
          <PlanCard
            name="PRO"
            price={`₹${PRO_PRICE_INR}`}
            period="/month"
            highlight
            lines={[
              `${PRO_MONTHLY_CREDITS.toLocaleString()} credits per cycle`,
              "Unlimited projects",
              "Priority support",
            ]}
          />
        </ScrollReveal>
        <ScrollReveal asChildOfStagger>
          <PlanCard
            name="Credit packs"
            price={`from ₹${CREDIT_PACKS[0]!.inr}`}
            lines={CREDIT_PACKS.map(
              (pack) => `${pack.credits.toLocaleString()} credits — ₹${pack.inr}`,
            ).concat("Top up any time, no subscription")}
          />
        </ScrollReveal>
      </Stagger>

      <ScrollReveal className="mt-10 text-center">
        <p className="text-sm text-silver-600">
          Caps that protect you: a per-build spend ceiling by tier, a limit on
          concurrent builds, and a daily cap on your gateway key.
        </p>
        <Link
          to="/pricing"
          className="mt-4 inline-block text-sm text-blue-500 hover:underline"
        >
          See full pricing →
        </Link>
      </ScrollReveal>
    </section>
  );
}

function PlanCard({
  name,
  price,
  period,
  lines,
  highlight,
}: {
  name: string;
  price: string;
  period?: string;
  lines: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-2xl border bg-space-surface p-6",
        highlight ? "border-blue-500/40 conic-sheen" : "border-silver-200",
      )}
    >
      <h3 className="text-sm font-medium uppercase tracking-[0.14em] text-silver-400">
        {name}
      </h3>
      <p className="mt-3 text-3xl font-semibold text-silver-900">
        {price}
        {period && (
          <span className="text-base font-normal text-silver-600">{period}</span>
        )}
      </p>
      <ul className="mt-5 space-y-2 text-sm text-silver-600">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {highlight && (
        <Link
          to={APP_BILLING}
          className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Upgrade to PRO
        </Link>
      )}
    </div>
  );
}

export default Credits;
