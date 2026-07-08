import { useNavigate } from "react-router-dom";
import { CheckCircleIcon } from "lucide-react";

import { useUpgradeModalStore } from "./useUpgradeModalStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { UpgradeProButton } from "./UpgradeProButton";
import { MaxShimmerLabel } from "@/src/components/ui/max-shimmer-label";

const PRO_FEATURES = [
  "5,000 credits per month",
  "Unlock High & Max effort modes",
  "Priority support",
];

/** Renders feature text, swapping the word "Max" for its shimmering label. */
function renderFeatureText(text: string) {
  return text
    .split(/(Max)/)
    .map((part, i) =>
      part === "Max" ? (
        <MaxShimmerLabel key={i} className="font-semibold" />
      ) : (
        part
      ),
    );
}

/** Global "upgrade to PRO" modal — open it from anywhere via useUpgradeModalStore. */
export function UpgradeModal() {
  const open = useUpgradeModalStore((s) => s.open);
  const title = useUpgradeModalStore((s) => s.title);
  const close = useUpgradeModalStore((s) => s.close);
  const navigate = useNavigate();

  const handleUpgrade = () => {
    close();
    navigate("/billing");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border border-brand/50 bg-brand/5 p-4">
          <span className="mb-3 inline-block rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
            PRO
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold">₹999</span>
            <span className="text-sm text-muted-foreground">/month</span>
          </div>
          <ul className="mt-4 space-y-2">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-brand" />
                <span className="text-foreground/80">
                  {renderFeatureText(f)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <UpgradeProButton className="w-full" onClick={handleUpgrade}>
          Upgrade to PRO
        </UpgradeProButton>
      </DialogContent>
    </Dialog>
  );
}
