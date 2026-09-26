import { motion } from "motion/react";

import { SparkleParticles } from "@/src/components/ui/star-particles";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";

// Mirrors the ambient field's palette in Home.tsx: same regular white/silver
// stars, so this layer just adds *more* of the same rather than a new look.
const STAR_COLORS = [
  "rgba(203, 213, 225, 0.7)",
  "rgba(203, 213, 225, 0.7)",
  "rgba(203, 213, 225, 0.7)",
  "rgba(226, 232, 240, 0.75)",
  "rgba(253, 230, 138, 0.7)",
  "rgba(186, 230, 253, 0.7)",
];

/**
 * Extra star layer for MAX effort on Home. It reuses the exact same
 * SparkleParticles config as the ambient field (same white/silver stars, size,
 * twinkle and drift) and simply packs in more of them, so MAX reads as "the same
 * sky, just denser": a second layer that behaves identically to the ambient one
 * (no glitch/shake). Only the fade in/out on toggle is added. Render inside
 * <AnimatePresence> so that fade plays.
 */
export function MaxStarField() {
  const reducedMotion = useReduceMotion();

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Identical to the ambient field, just a higher density so MAX has more
          of the same regular white stars. No transform/filter here, so this
          layer drifts and twinkles exactly like the regular one. */}
      <SparkleParticles
        className="absolute inset-0"
        particleColor={STAR_COLORS}
        baseDensity={90}
        maxParticleSize={1.4}
        maxOpacity={0.7}
        minParticleOpacity={0.4}
        maxSpeed={0.5}
        opacityAnimationSpeed={reducedMotion ? 1 : 3}
      />
    </motion.div>
  );
}

export default MaxStarField;
