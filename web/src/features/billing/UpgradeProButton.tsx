import type { ComponentProps } from "react";

import BorderGlow from "@/src/components/ui/glow-loader";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

/**
 * "Upgrade to PRO" button with the same animated border trail as the
 * "tau is building your app…" preview loader (see PreviewPane.tsx).
 */
export function UpgradeProButton({
  className,
  wrapperClassName,
  children = "Upgrade to PRO",
  ...props
}: ComponentProps<typeof Button> & { wrapperClassName?: string }) {
  return (
    <BorderGlow
      autoAnimate
      autoAnimateDuration={3200}
      coneSpread={8}
      borderRadius={10}
      backgroundColor="transparent"
      glowColor="253 91 85"
      colors={["#8b7bff", "#f472b6", "#38bdf8"]}
      glowRadius={12}
      glowIntensity={0.7}
      fillOpacity={0.25}
      className={cn("p-[1.5px]", wrapperClassName)}
    >
      <Button
        className={cn(
          "rounded-[8.5px] !border-transparent !bg-[var(--space-surface)] !text-[var(--silver-900)] hover:!bg-[var(--space-overlay)]",
          className,
        )}
        {...props}
      >
        {children}
      </Button>
    </BorderGlow>
  );
}
