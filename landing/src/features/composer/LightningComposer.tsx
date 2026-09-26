import type { ReactNode } from "react";

import { ElectricBorder } from "@/src/components/ui/electric-border";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";

interface LightningComposerProps {
  /** When true, the electric border animates; otherwise it fades out. */
  active: boolean;
  children: ReactNode;
}

/**
 * Home-only wrapper that overlays the animated lightning border on the prompt
 * composer while MAX effort is selected. Kept out of `PromptComposer` itself so
 * the shared composer stays calm on the project page. Respects reduced motion
 * (static glow, no bolt).
 */
export function LightningComposer({ active, children }: LightningComposerProps) {
  const reducedMotion = useReduceMotion();

  return (
    <ElectricBorder
      active={active}
      reducedMotion={reducedMotion}
      color="#3b82f6"
      borderRadius={16}
    >
      {children}
    </ElectricBorder>
  );
}
