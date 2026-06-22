import * as React from "react";
import {
  type HTMLMotionProps,
  motion,
  useMotionValue,
  useSpring,
  type SpringOptions,
  type Transition,
} from "motion/react";

import { cn } from "@/src/lib/utils";

type StarLayerProps = HTMLMotionProps<"div"> & {
  count: number;
  size: number;
  transition: Transition;
  starColor: string;
};

function generateStars(count: number, starColor: string) {
  const shadows: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * 4000) - 2000;
    const y = Math.floor(Math.random() * 4000) - 2000;
    shadows.push(`${x}px ${y}px ${starColor}`);
  }
  return shadows.join(", ");
}

function StarLayer({
  count = 1000,
  size = 1,
  transition = { repeat: Infinity, duration: 50, ease: "linear" },
  starColor = "#fff",
  className,
  ...props
}: StarLayerProps) {
  const [boxShadow, setBoxShadow] = React.useState<string>("");

  React.useEffect(() => {
    setBoxShadow(generateStars(count, starColor));
  }, [count, starColor]);

  return (
    <motion.div
      data-slot="star-layer"
      animate={{ y: [0, -2000] }}
      transition={transition}
      className={cn("absolute top-0 left-0 w-full h-[2000px]", className)}
      {...props}
    >
      <div
        className="absolute bg-transparent rounded-full"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          boxShadow: boxShadow,
        }}
      />
      <div
        className="absolute bg-transparent rounded-full top-[2000px]"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          boxShadow: boxShadow,
        }}
      />
    </motion.div>
  );
}

type ShootingStarConfig = {
  top: string;
  left: string;
  /** Tail length in px. */
  length: number;
  /** Time to cross, in seconds. */
  duration: number;
  /** Initial offset before the first run. */
  delay: number;
  /** Idle time between runs. */
  repeatDelay: number;
  color: string;
};

/** A single diagonal streak that shoots across the screen, then waits and repeats. */
function ShootingStar({
  top,
  left,
  length,
  duration,
  delay,
  repeatDelay,
  color,
}: ShootingStarConfig) {
  return (
    <motion.span
      data-slot="shooting-star"
      className="absolute h-px rounded-full"
      style={{
        top,
        left,
        width: length,
        rotate: "45deg",
        background: `linear-gradient(90deg, ${color}, transparent)`,
        boxShadow: `0 0 6px ${color}`,
      }}
      initial={{ x: 0, y: 0, opacity: 0 }}
      animate={{ x: [0, 600], y: [0, 600], opacity: [0, 1, 1, 0] }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        repeatDelay,
        ease: "easeIn",
      }}
    />
  );
}

/** A handful of sporadic shooting stars at fixed-but-scattered positions. */
const SHOOTING_STARS: ShootingStarConfig[] = [
  {
    top: "6%",
    left: "8%",
    length: 90,
    duration: 1.1,
    delay: 1.5,
    repeatDelay: 9,
    color: "#ffffff",
  },
  {
    top: "12%",
    left: "62%",
    length: 70,
    duration: 1.4,
    delay: 5,
    repeatDelay: 13,
    color: "#fde68a",
  },
  {
    top: "4%",
    left: "78%",
    length: 110,
    duration: 1.0,
    delay: 8,
    repeatDelay: 11,
    color: "#ffffff",
  },
  {
    top: "26%",
    left: "30%",
    length: 80,
    duration: 1.3,
    delay: 3,
    repeatDelay: 16,
    color: "#ffffff",
  },
];

type StarsBackgroundProps = React.ComponentProps<"div"> & {
  factor?: number;
  speed?: number;
  transition?: SpringOptions;
  starColor?: string;
  pointerEvents?: boolean;
};

function StarsBackground({
  children,
  className,
  factor = 0.05,
  speed = 50,
  transition = { stiffness: 50, damping: 20 },
  starColor = "#fff",
  pointerEvents = true,
  ...props
}: StarsBackgroundProps) {
  const offsetX = useMotionValue(1);
  const offsetY = useMotionValue(1);

  const springX = useSpring(offsetX, transition);
  const springY = useSpring(offsetY, transition);

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const newOffsetX = -(e.clientX - centerX) * factor;
      const newOffsetY = -(e.clientY - centerY) * factor;
      offsetX.set(newOffsetX);
      offsetY.set(newOffsetY);
    },
    [offsetX, offsetY, factor],
  );

  return (
    <div
      data-slot="stars-background"
      className={cn(
        "relative size-full overflow-hidden bg-[radial-gradient(ellipse_at_bottom,_#262626_0%,_#000_100%)]",
        className,
      )}
      onMouseMove={handleMouseMove}
      {...props}
    >
      <motion.div
        style={{ x: springX, y: springY }}
        className={cn({ "pointer-events-none": !pointerEvents })}
      >
        <StarLayer
          count={1400}
          size={1}
          transition={{ repeat: Infinity, duration: speed, ease: "linear" }}
          starColor={starColor}
        />
        <StarLayer
          count={600}
          size={2}
          transition={{
            repeat: Infinity,
            duration: speed * 2,
            ease: "linear",
          }}
          starColor={starColor}
        />
        <StarLayer
          count={250}
          size={3}
          transition={{
            repeat: Infinity,
            duration: speed * 3,
            ease: "linear",
          }}
          starColor={starColor}
        />
        <StarLayer
          count={50}
          size={5}
          transition={{
            repeat: Infinity,
            duration: speed * 3,
            ease: "linear",
          }}
          starColor={starColor}
        />
      </motion.div>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {SHOOTING_STARS.map((s, i) => (
          <ShootingStar key={i} {...s} />
        ))}
      </div>

      {children}
    </div>
  );
}

export {
  StarLayer,
  StarsBackground,
  type StarLayerProps,
  type StarsBackgroundProps,
};
