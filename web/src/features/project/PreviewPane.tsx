import { motion } from "motion/react";

// Numeric px so Framer can interpolate smoothly (no unit-mixing snap). Desktop
// uses a large sentinel that the `w-full` parent caps — i.e. effectively full.
const DEVICE_WIDTH: Record<string, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 9999,
};

export function PreviewPane({ device }: { device: string }) {
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <motion.div
        animate={{ maxWidth: DEVICE_WIDTH[device] }}
        transition={{ type: "spring", stiffness: 200, damping: 26 }}
        className="relative h-full w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--silver-200)]"
        style={{
          // Faint grid pattern so the empty preview reads as a canvas.
          backgroundColor: "var(--space-surface)",
          backgroundImage:
            "linear-gradient(var(--space-overlay) 1px, transparent 1px), linear-gradient(90deg, var(--space-overlay) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="text-sm font-medium text-[var(--silver-600)]">
            Preview
          </span>
          <span className="text-xs text-[var(--silver-400)]">
            Your app renders here
          </span>
        </div>
      </motion.div>
    </div>
  );
}
