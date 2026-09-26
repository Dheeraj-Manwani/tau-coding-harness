import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";

/**
 * A card that tips toward the cursor, with a specular sheen tracking it.
 *
 * ±6° is the whole budget. Past that the text starts to keystone visibly and
 * the card reads as a gimmick rather than as a physical object.
 *
 * Under reduced motion the card is simply a card: flat, no sheen, no listener
 * attached at all.
 */

const MAX_TILT_DEG = 6;

type MotionDivProps = ComponentPropsWithoutRef<typeof motion.div>;

interface TiltCardProps extends MotionDivProps {
  children: ReactNode;
  /** Disable the sheen when the card's own content is already busy. */
  sheen?: boolean;
}

export function TiltCard({
  children,
  className,
  sheen = true,
  onPointerMove,
  onPointerLeave,
  ...props
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReduceMotion();

  // -0.5 … 0.5 across the card in each axis.
  const px = useMotionValue(0);
  const py = useMotionValue(0);

  const springConfig = { stiffness: 200, damping: 20, mass: 0.6 };
  const rotateX = useSpring(
    useTransform(py, [-0.5, 0.5], [MAX_TILT_DEG, -MAX_TILT_DEG]),
    springConfig,
  );
  const rotateY = useSpring(
    useTransform(px, [-0.5, 0.5], [-MAX_TILT_DEG, MAX_TILT_DEG]),
    springConfig,
  );

  const sheenBackground = useTransform(
    [px, py],
    ([sx, sy]: number[]) =>
      `radial-gradient(circle at ${(sx + 0.5) * 100}% ${(sy + 0.5) * 100}%, rgba(226,232,240,0.14), transparent 55%)`,
  );

  if (reduceMotion) {
    return (
      <div className={cn("relative", className)}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={cn("relative", className)}
      style={{ perspective: 1000, transformStyle: "preserve-3d", rotateX, rotateY }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        const element = ref.current;
        if (!element || event.pointerType !== "mouse") return;
        const rect = element.getBoundingClientRect();
        px.set((event.clientX - rect.left) / rect.width - 0.5);
        py.set((event.clientY - rect.top) / rect.height - 0.5);
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        px.set(0);
        py.set(0);
      }}
      {...props}
    >
      {children}
      {sheen && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 hover:opacity-100"
          style={{ backgroundImage: sheenBackground }}
        />
      )}
    </motion.div>
  );
}

export default TiltCard;
