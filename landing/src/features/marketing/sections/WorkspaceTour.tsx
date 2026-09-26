import { useState } from "react";
import { motion } from "motion/react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { HOTSPOTS } from "@/src/features/marketing/data/workspaceHotspots";
import { ConstellationLinks } from "@/src/features/marketing/motion/ConstellationLinks";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";
import { REVEAL_VIEWPORT } from "@/src/features/marketing/motion/variants";

/**
 * §4.6: "You get the whole machine, not just the output."
 *
 * The four panels dock in from off-screen like modules mating, then six pins
 * pulse on the assembled mock. Hovering or tapping a pin opens its card.
 *
 * The mock is drawn in CSS rather than shipped as a screenshot: it stays sharp
 * at any density, costs nothing to download, and: the real reason: a
 * screenshot of the workspace goes stale the moment the workspace changes,
 * which is exactly the kind of quiet lie §9 exists to prevent.
 *
 * Pins are real buttons. They are reachable by keyboard, and the card opens on
 * focus as well as hover, so this is not a mouse-only section.
 */

/** Where each panel flies in from, and the order they land in. */
const PANELS = [
  { key: "chat", from: { x: -60, y: 0 }, delay: 0 },
  { key: "tree", from: { x: -40, y: 0 }, delay: 0.09 },
  { key: "editor", from: { x: 0, y: 60 }, delay: 0.18 },
  { key: "preview", from: { x: 60, y: 0 }, delay: 0.27 },
] as const;

export function WorkspaceTour() {
  const reduceMotion = useReduceMotion();
  const [open, setOpen] = useState<number | null>(null);
  const active = HOTSPOTS.find((hotspot) => hotspot.n === open) ?? null;

  const panelMotion = (index: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, x: PANELS[index]!.from.x, y: PANELS[index]!.from.y },
          whileInView: { opacity: 1, x: 0, y: 0 },
          viewport: REVEAL_VIEWPORT,
          transition: {
            duration: 0.7,
            delay: PANELS[index]!.delay,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          },
        };

  return (
    <section id="workspace" className="mx-auto w-full max-w-6xl px-6 py-24">
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          Nothing hidden
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Watch your idea become something real.
        </h2>
      </ScrollReveal>

      <div className="relative mt-14">
        <ConstellationLinks />

        <div className="relative grid h-[26rem] grid-cols-1 gap-2 overflow-hidden rounded-2xl border border-silver-200 bg-space-surface p-2 sm:grid-cols-[1.1fr_1.4fr_1.2fr]">
          <motion.div
            {...panelMotion(0)}
            className="hidden flex-col gap-2 rounded-xl bg-space-void p-3 sm:flex"
          >
            <MockLabel>Chat</MockLabel>
            <MockBar w="80%" />
            <MockBar w="62%" />
            <MockBar w="90%" tone="blue" />
            <MockBar w="45%" />
            <div className="mt-auto h-8 rounded-lg border border-silver-200" />
          </motion.div>

          <div className="flex min-h-0 flex-col gap-2">
            <motion.div
              {...panelMotion(1)}
              className="flex shrink-0 flex-col gap-1.5 rounded-xl bg-space-void p-3"
            >
              <MockLabel>Files</MockLabel>
              <MockBar w="55%" />
              <MockBar w="70%" />
              <MockBar w="48%" tone="blue" />
            </motion.div>
            <motion.div
              {...panelMotion(2)}
              className="flex min-h-0 flex-1 flex-col gap-1.5 rounded-xl bg-space-void p-3"
            >
              <MockLabel>Editor</MockLabel>
              <MockBar w="88%" />
              <MockBar w="64%" />
              <MockBar w="76%" />
              <MockBar w="40%" />
              <MockBar w="82%" />
            </motion.div>
          </div>

          <motion.div
            {...panelMotion(3)}
            className="hidden flex-col gap-2 rounded-xl bg-space-void p-3 sm:flex"
          >
            <MockLabel>Preview</MockLabel>
            <div className="flex-1 rounded-lg border border-silver-200 bg-gradient-to-b from-space-overlay/60 to-transparent" />
          </motion.div>

          {HOTSPOTS.map((hotspot) => (
            <button
              key={hotspot.n}
              type="button"
              aria-label={hotspot.title}
              aria-expanded={open === hotspot.n}
              onPointerEnter={() => setOpen(hotspot.n)}
              onFocus={() => setOpen(hotspot.n)}
              onClick={() => setOpen((n) => (n === hotspot.n ? null : hotspot.n))}
              className={cn(
                "absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-mono text-[0.65rem] transition-colors",
                open === hotspot.n
                  ? "border-blue-500 bg-blue-500 text-blue-900"
                  : "border-blue-500/60 bg-space-void text-blue-300 hover:border-blue-500",
                !reduceMotion && open !== hotspot.n && "hotspot-pulse",
              )}
              style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
            >
              {hotspot.n}
            </button>
          ))}
        </div>

        {/* One card below the mock rather than a floating popover: it never
            covers the thing it is describing, and it reserves its own height so
            opening a pin doesn't shove the page around. */}
        <div className="mt-6 min-h-[5.5rem] rounded-xl border border-silver-200 bg-space-surface p-5">
          {active ? (
            <>
              <h3 className="text-sm font-semibold text-silver-900">
                {active.n}. {active.title}
              </h3>
              <p className="mt-2 text-sm text-silver-600">{active.copy}</p>
            </>
          ) : (
            <p className="text-sm text-silver-600">
              Hover over a number to see how Tau keeps you in the loop.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function MockLabel({ children }: { children: string }) {
  return (
    <p className="text-[0.6rem] font-medium uppercase tracking-[0.14em] text-silver-400">
      {children}
    </p>
  );
}

function MockBar({ w, tone }: { w: string; tone?: "blue" }) {
  return (
    <div
      className={cn(
        "h-2 rounded-full",
        tone === "blue" ? "bg-blue-500/30" : "bg-space-overlay",
      )}
      style={{ width: w }}
    />
  );
}

export default WorkspaceTour;
