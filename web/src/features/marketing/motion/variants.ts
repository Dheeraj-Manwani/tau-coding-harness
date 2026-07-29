import type { Transition, Variants } from "motion/react";

/**
 * The one reveal in the design system.
 *
 * Every band on the landing page and every docs section enters the same way —
 * rise, unblur, fade — so scrolling reads as one continuous motion rather than
 * a dozen components each showing off. If a section needs something different,
 * that is a design decision, not a local override.
 */

/** Fast-out, long-settle. The house easing curve. */
export const EASE_OUT_EXPO: [number, number, number, number] = [
  0.16, 1, 0.3, 1,
];

export const REVEAL_DURATION = 0.6;
export const STAGGER_CHILDREN = 0.07;

/** `whileInView` config: reveal once, when a quarter of the element is on screen. */
export const REVEAL_VIEWPORT = { once: true, amount: 0.25 } as const;

const revealTransition: Transition = {
  duration: REVEAL_DURATION,
  ease: EASE_OUT_EXPO,
};

export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: revealTransition,
  },
};

/** Parent of several `revealVariants` children — cascades them 70ms apart. */
export const staggerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: STAGGER_CHILDREN } },
};

/**
 * The reduced-motion substitute. Not "no animation" — the composed final frame,
 * applied instantly, so a reduced-motion visitor sees a finished page rather
 * than a page that never arrived.
 */
export const staticVariants: Variants = {
  hidden: { opacity: 1, y: 0, filter: "blur(0px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0 } },
};

export function revealVariantsFor(reduceMotion: boolean): Variants {
  return reduceMotion ? staticVariants : revealVariants;
}

export function staggerVariantsFor(reduceMotion: boolean): Variants {
  return reduceMotion ? staticVariants : staggerVariants;
}
