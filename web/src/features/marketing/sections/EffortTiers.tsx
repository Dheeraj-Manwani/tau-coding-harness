import { useEffect, useRef, useState } from "react";

import { ElectricBorder } from "@/src/components/ui/electric-border";
import { MaxShimmerLabel } from "@/src/components/ui/max-shimmer-label";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { EFFORT_TIERS } from "@/src/features/marketing/data/effortTiers";
import { LightningArc } from "@/src/features/marketing/motion/LightningArc";
import { ScrollReveal, Stagger } from "@/src/features/marketing/motion/ScrollReveal";
import { TiltCard } from "@/src/features/marketing/motion/TiltCard";
import { useCosmos } from "@/src/features/marketing/motion/cosmos";

/**
 * §4.5 — "Choose your thrust".
 *
 * The numbers here are the product's actual budgets, imported from
 * `data/effortTiers.ts`, which cites the constant behind each one. Effort is
 * the single most misunderstood control in tau, and the fix is not adjectives
 * — it is the table.
 *
 * The MAX card carries `ElectricBorder` permanently, the same component and the
 * same blue as the composer, so "the loud one" means the same thing here as it
 * does in the app. Hovering it cracks a bolt in from each of its neighbours and
 * packs the shared starfield tighter — the one place on the page where three
 * separate motions fire together, because it is the payoff.
 */

/** Matches the hero's MAX ramp, which mirrors MaxStarField on Home. */
const MAX_DENSITY_BOOST = 1.6;

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
  const cosmos = useCosmos();
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lowRef = useRef<HTMLDivElement | null>(null);
  const highRef = useRef<HTMLDivElement | null>(null);
  const maxRef = useRef<HTMLDivElement | null>(null);

  const [focused, setFocused] = useState<number | null>(null);
  const [maxHovered, setMaxHovered] = useState(false);

  // Hovering MAX packs the sky, exactly as arming MAX does in the composer.
  useEffect(() => {
    cosmos.setDensityBoost(maxHovered ? MAX_DENSITY_BOOST : 1);
    return () => cosmos.setDensityBoost(1);
  }, [cosmos, maxHovered]);

  const activeTier = EFFORT_TIERS[focused ?? 1]!;
  const spend = useCountUp(activeTier.spendCap, focused !== null);

  return (
    <section id="effort" className="mx-auto w-full max-w-6xl px-6 py-24">
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          Three gears
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Cheap and quick, or slow and relentless.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-silver-600">
          Effort decides which model runs, how long the agent may think, how many
          sub-agents it can spawn, and how much a single build may cost. Every
          tier is open on every plan — you just pay for what you use.
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
                if (isMax) setMaxHovered(true);
              }}
              onPointerLeave={() => {
                setFocused(null);
                if (isMax) setMaxHovered(false);
              }}
            >
              <div
                ref={(el) => {
                  cardRefs.current[index] = el;
                  if (tier.effort === "LOW") lowRef.current = el;
                  if (tier.effort === "HIGH") highRef.current = el;
                  if (isMax) maxRef.current = el;
                }}
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
                  <span className="font-mono text-xs text-silver-400">
                    {tier.modelId}
                  </span>
                </div>
                <p className="mt-1 text-sm text-silver-600">{tier.model}</p>

                <dl className="mt-6 space-y-2.5 text-sm">
                  <Row label="Agent turns" value={tier.turns} />
                  <Row label="Sub-agent turns" value={tier.subagentTurns} />
                  <Row label="Parallel sub-agents" value={tier.parallel} />
                  <Row label="Wall clock" value={`${tier.wallClockMinutes} min`} />
                  <Row
                    label="Spend cap / build"
                    value={`${tier.spendCap} credits`}
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
        A single {activeTier.label.toLowerCase()} build may spend at most{" "}
        <span className="font-mono tabular-nums text-silver-900">
          {focused === null ? activeTier.spendCap : spend}
        </span>{" "}
        credits before tau stops and tells you.
      </p>

      {/* Two bolts crack in from the quieter tiers when MAX is hovered. */}
      <LightningArc from={lowRef} to={maxRef} trigger={maxHovered} branches={1} />
      <LightningArc from={highRef} to={maxRef} trigger={maxHovered} branches={1} />
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
