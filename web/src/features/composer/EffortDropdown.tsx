import { DropdownMenu } from "radix-ui";
import { CheckIcon, ChevronDownIcon, InfoIcon } from "lucide-react";

import type { Effort } from "@/src/features/project/types";
import { MaxShimmerLabel } from "@/src/components/ui/max-shimmer-label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";

const EFFORT_OPTIONS: { value: Effort; label: string; hint?: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "HIGH", label: "High" },
  {
    value: "MAX",
    label: "Max",
    hint: "For the toughest jobs. It takes longer and can use more credits.",
  },
];

interface EffortDropdownProps {
  effort: Effort;
  onChange: (effort: Effort) => void;
  /** Max spend per message (display credits) per tier: shown as a cost hint. */
  ceilings?: Partial<Record<Effort, number>>;
}

export function EffortDropdown({
  effort,
  onChange,
}: EffortDropdownProps) {
  const current =
    EFFORT_OPTIONS.find((o) => o.value === effort) ?? EFFORT_OPTIONS[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="How much effort Tau should use"
          data-tour="effort"
          className="group flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--silver-900)] outline-none transition-colors hover:bg-[var(--space-overlay)]"
        >
          <span className="text-[var(--silver-600)]">Effort:</span>
          {current.value === "MAX" ? (
            <MaxShimmerLabel className="font-semibold" />
          ) : (
            current.label
          )}
          <ChevronDownIcon className="size-3 shrink-0 text-[var(--silver-600)] transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-32 rounded-lg border border-[var(--silver-200)] bg-[var(--space-surface)] p-1 shadow-2xl"
        >
          <TooltipProvider delayDuration={150}>
            {EFFORT_OPTIONS.map((opt) => {
              const selected = opt.value === effort;
              const item = (
                <DropdownMenu.Item
                  key={opt.value}
                  onSelect={() => onChange(opt.value)}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--silver-900)] outline-none select-none transition-colors data-[highlighted]:bg-[var(--space-overlay)]"
                >
                  <span className="flex items-center gap-1.5">
                    {opt.value === "MAX" ? (
                      <MaxShimmerLabel className="font-semibold" />
                    ) : (
                      opt.label
                    )}
                    {opt.hint ? (
                      <InfoIcon className="size-3 shrink-0 text-[var(--silver-600)]" />
                    ) : null}
                  </span>
                  {selected ? (
                    <CheckIcon className="size-3 shrink-0 text-[var(--silver-900)]" />
                  ) : null}
                </DropdownMenu.Item>
              );

              if (!opt.hint) {
                return item;
              }

              return (
                <Tooltip key={opt.value}>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent side="left" className="max-w-56">
                    {opt.hint}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
