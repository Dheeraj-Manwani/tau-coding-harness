import { AnimatePresence, motion } from "motion/react";
import type { ComponentType, SVGProps } from "react";

import { cn } from "@/src/lib/utils";
import { BuildWeatherCanvas } from "@/src/features/project/BuildWeatherCanvas";

/**
 * The "tau is building" card, restyled to match the storm voice (bold
 * display heading, mono eyebrow, a real rain-and-lightning canvas confined to
 * the card) used across landing/ and the rest of web/. Pure presentation -
 * `PreviewPane.tsx`'s `PreviewPlaceholder` keeps the tip-rotation timer,
 * reduced-motion handling and feedback-store wiring; this just renders one
 * tip.
 *
 * No animated border trail here on purpose: a chasing conic-gradient border
 * sized for a small button looked wrong stretched around a card this size,
 * fighting the content instead of framing it. A quiet static border plus the
 * weather canvas reads calmer and closer to the reference design.
 */
export function BuildLoaderCard({
  liveActivity,
  tip,
  tipIndex,
  tipCount,
  onSelectTip,
  onFeedback,
  reduceMotion,
}: {
  liveActivity: string;
  tip: {
    title: string;
    copy: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    iconClass: string;
  };
  tipIndex: number;
  tipCount: number;
  onSelectTip: (index: number) => void;
  onFeedback: () => void;
  reduceMotion: boolean | null;
}) {
  const TipIcon = tip.icon;

  return (
    <div className="flex h-full items-center justify-center bg-black p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-blue-500/20 bg-[#060608] shadow-2xl shadow-black/40">
        <BuildWeatherCanvas />

        <div className="relative px-6 py-7 sm:px-8">
          <div className="relative flex flex-col items-center text-center">
            <div
              className="flex min-h-7 w-full items-center justify-center gap-2 overflow-hidden"
              aria-live="polite"
            >
              <span
                className="logo-mark relative block size-4 shrink-0"
                role="img"
                aria-label="tau"
              />
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={liveActivity}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.22 }}
                  className="text-sm font-semibold leading-snug text-silver-900"
                >
                  is {liveActivity}
                </motion.p>
              </AnimatePresence>
            </div>

            <div className="mt-5 w-full">
              <div className="relative min-h-36 overflow-hidden">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={tipIndex}
                    initial={reduceMotion ? false : { opacity: 0, x: 18 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, x: -18 }}
                    transition={{ duration: 0.28, ease: "easeOut" }}
                    className="flex flex-col items-center"
                  >
                    <span className="mb-3 flex size-9 items-center justify-center rounded-lg border border-silver-400/30 bg-space-overlay">
                      <TipIcon className={cn("size-4", tip.iconClass)} />
                    </span>
                    <p className="display-heading text-xl text-silver-900">
                      {tip.title}
                    </p>
                    <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-silver-600">
                      {tip.copy}
                    </p>
                    {tipIndex === 0 && (
                      <button
                        type="button"
                        onClick={onFeedback}
                        className="mt-2 rounded-md px-3 py-1.5 text-xs font-medium text-amber-300 underline underline-offset-4 hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        Give feedback
                      </button>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="mt-2 flex items-center justify-center">
                <div
                  role="group"
                  className="flex items-center gap-1"
                  aria-label={`Tip ${tipIndex + 1} of ${tipCount}`}
                >
                  {Array.from({ length: tipCount }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => onSelectTip(index)}
                      aria-label={`Show tip ${index + 1}`}
                      aria-current={index === tipIndex ? "true" : undefined}
                      className="flex size-6 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
                    >
                      <span
                        className={cn(
                          "block h-1.5 rounded-full transition-[width,background-color,opacity]",
                          index === tipIndex
                            ? "w-4 bg-blue-500"
                            : "w-1.5 bg-silver-600 opacity-80 ring-1 ring-silver-400 hover:opacity-100",
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BuildLoaderCard;
