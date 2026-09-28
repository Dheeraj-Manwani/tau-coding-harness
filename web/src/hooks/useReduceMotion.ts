import { usePrefersReducedMotion } from "@/src/hooks/usePrefersReducedMotion";
import { usePreferences } from "@/src/features/settings/preferences";

/**
 * Effective "reduce motion" state: true if either the OS setting
 * (`prefers-reduced-motion`) or the user's in-app Settings toggle is on.
 * Decorative animations should use this to decide whether to render a calm
 * fallback. The toggle is an account preference, so it follows the user.
 */
export function useReduceMotion(): boolean {
  const osReduced = usePrefersReducedMotion();
  const userReduced = usePreferences().reduceMotion ?? false;
  return osReduced || userReduced;
}
