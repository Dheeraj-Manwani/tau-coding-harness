import { TriangleAlertIcon } from "lucide-react";

import type { InstructionConflict } from "@/src/features/settings/instructionCheck";

/** The conflicts, under the box they came from. Nothing when there are none. */
export function InstructionConflicts({ conflicts }: { conflicts: readonly InstructionConflict[] | undefined }) {
  if (!conflicts || conflicts.length === 0) return null;
  return (
    <div
      role="status"
      className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <TriangleAlertIcon className="size-3.5 shrink-0" />
        {conflicts.some((c) => !c.overrides)
          ? "Some of these can't all be followed"
          : "This project overrides your account"}
      </p>
      <ul className="space-y-1.5">
        {conflicts.map((c, i) => (
          <li key={i} className="space-y-0.5">
            <p className="text-amber-100">{c.note}</p>
            <p className="text-amber-200/80">
              &ldquo;{c.a}&rdquo; and &ldquo;{c.b}&rdquo;
              {c.overrides ? ". tau follows the project's." : "."}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
