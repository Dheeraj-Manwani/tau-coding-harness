import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { useCosmos } from "./cosmos";

/**
 * A CTA that leans toward the cursor.
 *
 * Three cheap signals stacked: the control translates 0.25× of the pointer's
 * offset (so it feels attracted without ever leaving its box), a soft blue glow
 * tracks the pointer inside it, and clicking pops a particle burst out of the
 * shared starfield at the click point.
 *
 * Touch devices get none of that: there is no hover to anticipate: so they
 * get a plain press-scale, which is the affordance that actually works with a
 * finger.
 *
 * Pass `to` for navigation. It renders a real `<Link>`, because a primary CTA
 * that can't be middle-clicked or opened in a new tab is a button pretending to
 * be a link.
 */

/** Pointer displacement is multiplied by this to get the control's travel. */
const PULL = 0.25;
/** Beyond this distance outside the control's box the pull is ignored. */
const RADIUS = 60;

const MotionLink = motion.create(Link);

type CommonProps = {
  children: ReactNode;
  className?: string;
};

type MagneticButtonProps = CommonProps &
  (
    | ({ to: string } & Omit<ComponentPropsWithoutRef<typeof MotionLink>, "to" | "children" | "className">)
    | ({ to?: undefined } & Omit<ComponentPropsWithoutRef<typeof motion.button>, "children" | "className">)
  );

export function MagneticButton({
  children,
  className,
  to,
  onPointerMove,
  onPointerLeave,
  onClick,
  ...props
}: MagneticButtonProps) {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = useReduceMotion();
  const cosmos = useCosmos();

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // Glow position is kept in percentages so it survives any control size.
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(50);

  const springX = useSpring(x, { stiffness: 260, damping: 18, mass: 0.5 });
  const springY = useSpring(y, { stiffness: 260, damping: 18, mass: 0.5 });

  const glow = useTransform(
    [glowX, glowY],
    ([gx, gy]: number[]) =>
      `radial-gradient(circle at ${gx}% ${gy}%, color-mix(in oklch, #ffffff, transparent 78%), transparent 65%)`,
  );

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const element = ref.current;
    if (!element || reduceMotion || event.pointerType !== "mouse") return;
    const rect = element.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) < RADIUS + Math.max(rect.width, rect.height) / 2) {
      x.set(dx * PULL);
      y.set(dy * PULL);
    }
    glowX.set(((event.clientX - rect.left) / rect.width) * 100);
    glowY.set(((event.clientY - rect.top) / rect.height) * 100);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
    glowX.set(50);
    glowY.set(50);
  };

  const shared = {
    className: cn("relative isolate overflow-hidden", className),
    style: reduceMotion ? undefined : { x: springX, y: springY },
    whileTap: { scale: 0.97 },
  };

  const inner = (
    <>
      {!reduceMotion && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ backgroundImage: glow }}
        />
      )}
      {children}
    </>
  );

  if (to !== undefined) {
    return (
      <MotionLink
        ref={ref as React.Ref<HTMLAnchorElement>}
        to={to}
        {...shared}
        onPointerMove={(event: React.PointerEvent<HTMLAnchorElement>) => {
          (onPointerMove as ((e: React.PointerEvent<HTMLAnchorElement>) => void) | undefined)?.(event);
          handlePointerMove(event);
        }}
        onPointerLeave={(event: React.PointerEvent<HTMLAnchorElement>) => {
          (onPointerLeave as ((e: React.PointerEvent<HTMLAnchorElement>) => void) | undefined)?.(event);
          reset();
        }}
        onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
          if (!reduceMotion) cosmos.burst(event.clientX, event.clientY);
          (onClick as ((e: React.MouseEvent<HTMLAnchorElement>) => void) | undefined)?.(event);
        }}
        {...(props as Record<string, unknown>)}
      >
        {inner}
      </MotionLink>
    );
  }

  return (
    <motion.button
      ref={ref as React.Ref<HTMLButtonElement>}
      {...shared}
      onPointerMove={(event: React.PointerEvent<HTMLButtonElement>) => {
        (onPointerMove as ((e: React.PointerEvent<HTMLButtonElement>) => void) | undefined)?.(event);
        handlePointerMove(event);
      }}
      onPointerLeave={(event: React.PointerEvent<HTMLButtonElement>) => {
        (onPointerLeave as ((e: React.PointerEvent<HTMLButtonElement>) => void) | undefined)?.(event);
        reset();
      }}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        if (!reduceMotion) cosmos.burst(event.clientX, event.clientY);
        (onClick as ((e: React.MouseEvent<HTMLButtonElement>) => void) | undefined)?.(event);
      }}
      {...(props as Record<string, unknown>)}
    >
      {inner}
    </motion.button>
  );
}

export default MagneticButton;
