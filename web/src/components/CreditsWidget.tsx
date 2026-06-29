import { useNavigate } from "react-router-dom";
import { AlertTriangleIcon, ZapIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { useBalance } from "@/src/features/billing/api";

const LOW_CREDITS = 10;

export function CreditsWidget() {
  const navigate = useNavigate();
  const { data: balance } = useBalance();

  if (!balance) return null;

  const available = balance.credits.available;
  const isLow = available < LOW_CREDITS;

  return (
    <button
      type="button"
      onClick={() => navigate("/billing")}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        isLow
          ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
          : "bg-[var(--space-overlay)] text-[var(--silver-600)] hover:text-[var(--silver-900)]",
      )}
    >
      {isLow ? (
        <AlertTriangleIcon className="size-3" />
      ) : (
        <ZapIcon className="size-3" />
      )}
      {available % 1 === 0 ? available.toFixed(0) : available.toFixed(1)} cr
    </button>
  );
}
