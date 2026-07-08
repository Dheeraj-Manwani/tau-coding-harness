import { DropdownMenu } from "radix-ui";
import { CheckIcon, ChevronDownIcon, LockIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import type { Effort } from "@/src/features/project/types";
import { useUpgradeModalStore } from "@/src/features/billing/useUpgradeModalStore";
import { MaxShimmerLabel } from "@/src/components/ui/max-shimmer-label";

const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "HIGH", label: "High" },
  { value: "MAX", label: "Max" },
];

interface EffortDropdownProps {
  effort: Effort;
  onChange: (effort: Effort) => void;
  /** PRO accounts can select High/Max; FREE accounts see them locked. */
  isPro: boolean;
}

export function EffortDropdown({ effort, onChange, isPro }: EffortDropdownProps) {
  const openUpgradeModal = useUpgradeModalStore((s) => s.openModal);
  const current =
    EFFORT_OPTIONS.find((o) => o.value === effort) ?? EFFORT_OPTIONS[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Generation effort"
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
          {EFFORT_OPTIONS.map((opt) => {
            const locked = opt.value !== "LOW" && !isPro;
            const selected = opt.value === effort;
            return (
              <DropdownMenu.Item
                key={opt.value}
                onSelect={() =>
                  locked
                    ? openUpgradeModal("To use high/max mode, please upgrade")
                    : onChange(opt.value)
                }
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs outline-none select-none transition-colors data-[highlighted]:bg-[var(--space-overlay)]",
                  locked
                    ? "text-[var(--silver-600)]"
                    : "text-[var(--silver-900)]",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {opt.value === "MAX" ? (
                    <MaxShimmerLabel className="font-semibold" />
                  ) : (
                    opt.label
                  )}
                  {locked && (
                    <span className="rounded-full bg-[var(--space-overlay)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--silver-600)]">
                      Pro
                    </span>
                  )}
                </span>
                {locked ? (
                  <LockIcon className="size-3 shrink-0 text-[var(--silver-600)]" />
                ) : selected ? (
                  <CheckIcon className="size-3 shrink-0 text-[var(--silver-900)]" />
                ) : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
