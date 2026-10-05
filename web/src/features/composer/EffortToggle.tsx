import { InfoIcon } from "lucide-react";

import type { Effort } from "@/src/features/project/types";
import { MaxShimmerLabel } from "@/src/components/ui/max-shimmer-label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { cn } from "@/src/lib/utils";

const EFFORT_OPTIONS: { value: Effort; label: string; hint?: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "HIGH", label: "High" },
  {
    value: "MAX",
    label: "Max",
    hint: "For the toughest jobs. It takes longer and can use more credits.",
  },
];

/**
 * Inline segmented effort control - the storm landing page's `.effort-group`
 * pattern, rebuilt as real buttons rather than `EffortDropdown`'s menu. Same
 * small size everywhere (Home's big composer doesn't need a bigger one);
 * `compact` just drops the MAX hint icon for the project workspace's
 * narrower composer. `EffortDropdown` still exists for anywhere a menu (not
 * inline buttons) is a better fit.
 */
export function EffortToggle({
  effort,
  onChange,
  compact = false,
}: {
  effort: Effort;
  onChange: (effort: Effort) => void;
  compact?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="group"
        aria-label="How much effort Tau should use"
        data-tour="effort"
        className={cn(
          "flex items-center rounded-[9px] border border-silver-400/30",
          "gap-0.5 p-0.5",
        )}
      >
        {EFFORT_OPTIONS.map((opt) => {
          const selected = opt.value === effort;
          const button = (
            <button
              key={opt.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                selected
                  ? "bg-blue-500/20 text-blue-300"
                  : "text-silver-600 hover:bg-space-overlay hover:text-silver-900",
              )}
            >
              {opt.value === "MAX" ? (
                <MaxShimmerLabel className="text-[11px] font-semibold uppercase" />
              ) : (
                opt.label
              )}
              {opt.hint && !compact && (
                <InfoIcon className="size-3 shrink-0 text-silver-600" />
              )}
            </button>
          );

          if (!opt.hint) return button;

          return (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="top" className="max-w-56">
                {opt.hint}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
