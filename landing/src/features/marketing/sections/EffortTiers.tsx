import { useEffect, useState } from "react";

import { ElectricBorder } from "@/src/components/ui/electric-border";
import { MaxShimmerLabel } from "@/src/components/ui/max-shimmer-label";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { EFFORT_TIERS } from "@/src/features/marketing/data/effortTiers";

const TIER_SUMMARY = {
  LOW: "Fast and focused",
  HIGH: "More time for bigger ideas",
  MAX: "Tau gives it everything",
} as const;

const TIER_TEAMWORK = {
  LOW: "One task at a time",
  HIGH: "A few parts together",
  MAX: "Many parts together",
} as const;
import { ScrollReveal, Stagger } from "@/src/features/marketing/motion/ScrollReveal";
import { TiltCard } from "@/src/features/marketing/motion/TiltCard";

/**
 * §4.5: "Choose your thrust".
 *
 * The numbers here are the product's actual budgets, imported from
 * `data/effortTiers.ts`, which cites the constant behind each one. Effort is
 * the single most misunderstood control in tau, and the fix is not adjectives
 *: it is the table.
 *
 * The MAX card carries `ElectricBorder` permanently, the same component and the
 * same blue as the composer, so "the loud one" means the same thing here as it
 * does in the app. It no longer changes the shared starfield or fires lightning
 * on hover, keeping this comparison calm while the user reads it.
 */

function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = useState(0);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    // Reduced motion never runs the roll; the target is returned directly
    // below, so there is nothing to animate and nothing to set.
    if (!active || reduceMotion) return;
    let frame = 0;
    const startedAt = performance.now();
    const DURATION = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / DURATION);
      // Ease-out so the roll decelerates into its number rather than stopping.
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, reduceMotion]);

  return reduceMotion ? target : value;
}

export function EffortTiers() {
  const reduceMotion = useReduceMotion();

  const [focused, setFocused] = useState<number | null>(null);

  const activeTier = EFFORT_TIERS[focused ?? 1]!;
  const spend = useCountUp(activeTier.spendCap, focused !== null);

  return (
    <section id="effort" className="mx-auto w-full max-w-6xl px-6 py-20 md:py-24">
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          Pick the pace
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Quick and light, or all in.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-silver-600">
          Effort tells Tau how much time and attention to give your request. Every
          tier is open on every plan: you just pay for what you use.
        </p>
      </ScrollReveal>

      <Stagger className="mt-14 grid gap-6 lg:grid-cols-3">
        {EFFORT_TIERS.map((tier, index) => {
          const isMax = tier.effort === "MAX";
          const card = (
            <TiltCard
              className="h-full rounded-2xl"
              onPointerEnter={() => {
                setFocused(index);
              }}
              onPointerLeave={() => {
                setFocused(null);
              }}
            >
              <div
                className={cn(
                  "flex h-full flex-col rounded-2xl border bg-space-surface p-6",
                  isMax ? "border-transparent" : "border-silver-200",
                )}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold text-silver-900">
                    {isMax ? (
                      <MaxShimmerLabel className="text-lg font-semibold" />
                    ) : (
                      tier.label
                    )}
                  </h3>
                </div>
                <p className="mt-1 text-sm text-silver-600">
                  {TIER_SUMMARY[tier.effort]}
                </p>

                <dl className="mt-6 space-y-2.5 text-sm">
                  <Row label="Working time" value={`Up to ${tier.wallClockMinutes} min`} />
                  <Row label="How it works" value={TIER_TEAMWORK[tier.effort]} />
                  <Row
                    label="Credit limit"
                    value={`Up to ${tier.spendCap}`}
                    emphasis
                  />
                </dl>

                <p className="mt-6 border-t border-silver-200 pt-4 text-sm text-silver-600">
                  {tier.bestFor}
                </p>
              </div>
            </TiltCard>
          );

          return (
            <ScrollReveal key={tier.effort} asChildOfStagger className="h-full">
              {isMax ? (
                <ElectricBorder
                  active
                  reducedMotion={reduceMotion}
                  color="#3b82f6"
                  borderRadius={16}
                  className="h-full"
                >
                  {card}
                </ElectricBorder>
              ) : (
                card
              )}
            </ScrollReveal>
          );
        })}
      </Stagger>

      {/* The cost ticker: rolls to whichever tier's cap you're looking at. */}
      <p className="mt-10 text-center text-sm text-silver-600">
        A {activeTier.label.toLowerCase()} build can use up to{" "}
        <span className="font-mono tabular-nums text-silver-900">
          {focused === null ? activeTier.spendCap : spend}
        </span>{" "}
        credits. Tau stops before going over and lets you know.
      </p>
    </section>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string | number;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-silver-600">{label}</dt>
      <dd
        className={cn(
          "font-mono tabular-nums",
          emphasis ? "text-blue-300" : "text-silver-900",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export default EffortTiers;
