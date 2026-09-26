import type { ReactNode } from "react";
import { AlertTriangleIcon, InfoIcon, LightbulbIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import type { CalloutKind } from "./calloutKind";

/**
 * GitHub-flavoured alerts: `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`.
 *
 * Authors already type this syntax out of habit, and it renders as a plain
 * blockquote anywhere else: on GitHub, in an editor preview: so the source
 * stays readable outside our renderer.
 */

const STYLES: Record<
  CalloutKind,
  { icon: typeof InfoIcon; label: string; border: string; text: string }
> = {
  NOTE: {
    icon: InfoIcon,
    label: "Note",
    border: "border-blue-500/40",
    text: "text-blue-300",
  },
  TIP: {
    icon: LightbulbIcon,
    label: "Tip",
    border: "border-flux/40",
    text: "text-flux",
  },
  WARNING: {
    icon: AlertTriangleIcon,
    label: "Warning",
    border: "border-amber-400/40",
    text: "text-amber-400",
  },
};

export function Callout({
  kind,
  children,
}: {
  kind: CalloutKind;
  children: ReactNode;
}) {
  const style = STYLES[kind];
  const Icon = style.icon;

  return (
    <div
      className={cn(
        "my-6 rounded-xl border bg-space-surface/60 p-4",
        style.border,
      )}
    >
      <p
        className={cn(
          "mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.12em]",
          style.text,
        )}
      >
        <Icon className="size-3.5" />
        {style.label}
      </p>
      <div className="text-sm text-silver-600 [&>p]:mb-2 [&>p:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}

export default Callout;
