import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";

/** Compact loading affordance for a section waiting on server data. */
export function DataSpinner({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center text-[var(--silver-600)]",
        className,
      )}
    >
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
