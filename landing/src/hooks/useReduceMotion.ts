import { usePrefersReducedMotion } from "@/src/hooks/usePrefersReducedMotion";
import { useSettingsStore } from "@/src/stores/useSettingsStore";

/**
 * Effective "reduce motion" state: true if either the OS setting
 * (`prefers-reduced-motion`) or the user's in-app Settings toggle is on.
 * Decorative animations should use this to decide whether to render a calm
 * fallback.
 */
export function useReduceMotion(): boolean {
  const osReduced = usePrefersReducedMotion();
  const userReduced = useSettingsStore((s) => s.reduceMotion);
  return osReduced || userReduced;
}
