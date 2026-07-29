import { motion } from "motion/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import {
  REVEAL_VIEWPORT,
  revealVariantsFor,
  staggerVariantsFor,
} from "./variants";

type DivProps = Omit<
  ComponentPropsWithoutRef<typeof motion.div>,
  "variants" | "initial" | "whileInView" | "viewport" | "animate"
>;

interface ScrollRevealProps extends DivProps {
  children: ReactNode;
  /** Seconds to wait after the element enters view. */
  delay?: number;
  /**
   * Set when this element is a child of a `<Stagger>` — the parent then owns
   * the trigger and this one only supplies the variants.
   */
  asChildOfStagger?: boolean;
}

/**
 * Rise + unblur on entry. The default way anything appears on a public page.
 * Under reduced motion it renders its final frame immediately.
 */
export function ScrollReveal({
  children,
  delay,
  asChildOfStagger = false,
  ...props
}: ScrollRevealProps) {
  const reduceMotion = useReduceMotion();
  const variants = revealVariantsFor(reduceMotion);

  if (asChildOfStagger) {
    return (
      <motion.div variants={variants} {...props}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
      transition={delay ? { delay } : undefined}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Cascades its `ScrollReveal` children 70ms apart. Children must be passed
 * `asChildOfStagger` so they inherit the trigger instead of racing it.
 */
export function Stagger({ children, ...props }: DivProps & { children: ReactNode }) {
  const reduceMotion = useReduceMotion();

  return (
    <motion.div
      variants={staggerVariantsFor(reduceMotion)}
      initial="hidden"
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
      {...props}
    >
      {children}
    </motion.div>
  );
}
