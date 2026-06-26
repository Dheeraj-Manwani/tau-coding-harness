"use client";

import { useId, useMemo } from "react";
import { motion } from "motion/react";
import {
  Particles,
  ParticlesProvider,
  type ParticlesPluginRegistrar,
} from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import type { ISourceOptions, MoveDirection } from "@tsparticles/engine";

import { cn } from "@/src/lib/utils";

// The engine init callback MUST keep a stable identity across the whole app
// lifecycle — ParticlesProvider throws if it sees a different callback before
// the engine has finished loading. Defining it at module scope guarantees that.
const initEngine: ParticlesPluginRegistrar = async (engine) => {
  await loadSlim(engine);
};

// Stable empty default so `userOptions` doesn't get a fresh `{}` reference on
// every render — otherwise the memoized options change identity, which forces
// <Particles> to reload the container and snaps every star back to its start.
const EMPTY_USER_OPTIONS: Record<string, unknown> = {};

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

/** A single diagonal streak that shoots across, then waits and repeats forever. */
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
  { top: "6%", left: "8%", length: 90, duration: 1.1, delay: 2.5, repeatDelay: 18, color: "#ffffff" },
  { top: "10%", left: "70%", length: 100, duration: 1.2, delay: 9, repeatDelay: 22, color: "#bae6fd" },
];

interface SparkleParticlesProps {
  className?: string;
  maxParticleSize?: number;
  minParticleSize?: number | null;
  baseDensity?: number;
  maxSpeed?: number;
  minMoveSpeed?: number | null;
  maxOpacity?: number;
  customDirection?:
    | MoveDirection
    | "none"
    | ""
    | "bottom"
    | "bottomLeft"
    | "bottomRight"
    | "left"
    | "right"
    | "top"
    | "topLeft"
    | "topRight"; // Allow string literals for common directions
  opacityAnimationSpeed?: number;
  minParticleOpacity?: number | null;
  /**
   * Star color. Pass an array to give each star a random color from the set —
   * a cheap way to tint a few stars warm/cool among the rest.
   */
  particleColor?: string | string[];
  /** Render occasional diagonal shooting stars over the field. */
  enableShootingStars?: boolean;
  enableParallax?: boolean;
  enableHoverGrab?: boolean;
  backgroundColor?: string;
  userOptions?: Record<string, unknown>;
  zIndexLevel?: number;
  clickEffect?: boolean;
  hoverMode?: "grab" | "bubble" | "repulse";
  particleCount?: number;
  particleShape?: "circle" | "square" | "triangle" | "star" | "edge";
  enableCollisions?: boolean;
}

/**
 * tsParticles-backed star field. Renders nothing until the engine has loaded
 * (ParticlesProvider only mounts its children once `loaded` is true).
 */
function ParticlesField({
  className,
  maxParticleSize = 1.2,
  minParticleSize = null,
  baseDensity = 800,
  maxSpeed = 1.5,
  minMoveSpeed = null,
  maxOpacity = 1,
  customDirection = "",
  opacityAnimationSpeed = 3,
  minParticleOpacity = null,
  particleColor = "#e2e8f0",
  enableShootingStars = false,
  enableParallax = false,
  enableHoverGrab = false,
  backgroundColor = "transparent",
  userOptions = EMPTY_USER_OPTIONS,
  zIndexLevel = 1,
  clickEffect = true,
  hoverMode = "grab",
  particleCount = 4,
  particleShape = "circle",
  enableCollisions = false,
}: SparkleParticlesProps) {
  const instanceId = useId();

  // Depend on the color *values*, not the array reference — callers may pass an
  // inline array literal, which would otherwise change identity every render and
  // force the container to reload (resetting every star).
  const colorKey = Array.isArray(particleColor)
    ? particleColor.join("|")
    : particleColor;

  // Memoize so we don't tear down and reload the whole particle container on
  // every render (Particles reloads whenever the options reference changes).
  const options = useMemo<ISourceOptions>(
    () => ({
      background: {
        color: { value: backgroundColor },
      },
      fullScreen: {
        enable: false,
        zIndex: zIndexLevel,
      },
      fpsLimit: 120,
      interactivity: {
        events: {
          onClick: {
            enable: clickEffect,
            mode: "push",
          },
          onHover: {
            enable: enableHoverGrab,
            mode: hoverMode,
            parallax: {
              enable: enableParallax,
              force: 60,
              smooth: 10,
            },
          },
          resize: { enable: true },
        },
        modes: {
          push: { quantity: particleCount },
          repulse: { distance: 200, duration: 0.4 },
        },
      },
      particles: {
        color: { value: particleColor },
        shape: { type: particleShape },
        move: {
          enable: true,
          direction: customDirection === "" ? "none" : customDirection,
          speed: {
            min: minMoveSpeed ?? maxSpeed / 130,
            max: maxSpeed,
          },
          straight: true,
        },
        collisions: {
          enable: enableCollisions,
          mode: "bounce" as const,
          bounce: {
            horizontal: { value: 1 },
            vertical: { value: 1 },
          },
        },
        number: { value: baseDensity },
        opacity: {
          value: {
            min: minParticleOpacity ?? maxOpacity / 10,
            max: maxOpacity,
          },
          animation: {
            enable: true,
            sync: false,
            speed: opacityAnimationSpeed,
            // Twinkle forever: random phase, bounce between min/max, never
            // destroy the particle when it dims out.
            count: 0,
            startValue: "random",
            mode: "auto",
            destroy: "none",
          },
        },
        size: {
          value: {
            min: minParticleSize ?? maxParticleSize / 1.5,
            max: maxParticleSize,
          },
        },
      },
      detectRetina: true,
      ...userOptions,
    }),
    [
      backgroundColor,
      zIndexLevel,
      clickEffect,
      enableHoverGrab,
      hoverMode,
      enableParallax,
      particleCount,
      colorKey,
      particleShape,
      customDirection,
      minMoveSpeed,
      maxSpeed,
      enableCollisions,
      baseDensity,
      minParticleOpacity,
      maxOpacity,
      opacityAnimationSpeed,
      minParticleSize,
      maxParticleSize,
      userOptions,
    ],
  );

  if (!enableShootingStars) {
    return <Particles id={instanceId} options={options} className={className} />;
  }

  return (
    <div className={cn("overflow-hidden", className)}>
      <Particles id={instanceId} options={options} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {SHOOTING_STARS.map((s, i) => (
          <ShootingStar key={i} {...s} />
        ))}
      </div>
    </div>
  );
}

export function SparkleParticles(props: SparkleParticlesProps) {
  return (
    <ParticlesProvider init={initEngine}>
      <ParticlesField {...props} />
    </ParticlesProvider>
  );
}

export default SparkleParticles;
