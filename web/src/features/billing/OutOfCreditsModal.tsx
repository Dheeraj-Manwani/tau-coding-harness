import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangleIcon } from "lucide-react";

import { useBillingStore } from "./useBillingStore";
import { useBalance, useRedeemCode } from "./api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { ApiError } from "@/src/lib/api-client";
import { APP_BILLING } from "@/src/lib/routes";
import { UpgradeProButton } from "./UpgradeProButton";

export function OutOfCreditsModal() {
  const open = useBillingStore((s) => s.outOfCreditsOpen);
  const close = useBillingStore((s) => s.close);
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const redeemCode = useRedeemCode();
  const { data: balance } = useBalance();
  const isFreePlan = balance?.plan === "FREE";

  const handleRedeem = () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    redeemCode.mutate(trimmed, {
      onSuccess: () => {
        close();
        setCode("");
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Invalid promo code");
      },
    });
  };

  const handleBilling = (section: "buy-credits" | "pro-plan") => {
    close();
    void navigate(`${APP_BILLING}#${section}`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-amber-400" />
            Out of credits
          </DialogTitle>
          <DialogDescription>
            You've used your credit allowance. Buy a one-time credit pack or
            redeem a promo code to keep building.
            {isFreePlan && " You can also upgrade to Pro for 5,000 credits per month."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            <label htmlFor="out-of-credits-code" className="text-sm font-medium">Redeem a code</label>
            <div className="flex gap-2">
              <Input
                id="out-of-credits-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="PROMO-CODE"
                className="font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
              />
              <Button
                variant="outline"
                onClick={handleRedeem}
                disabled={!code.trim() || redeemCode.isPending}
              >
                {redeemCode.isPending ? "…" : "Apply"}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex items-center gap-2">
            <Button className="flex-1" onClick={() => handleBilling("buy-credits")}>
              Buy credits
            </Button>
            {isFreePlan && (
              <UpgradeProButton
                wrapperClassName="flex-1"
                onClick={() => handleBilling("pro-plan")}
              />
            )}
          </div>
        </div>

        <p className="border-t border-border pt-4 text-center text-xs leading-relaxed text-muted-foreground">
          For promo codes, contact{" "}
          <a
            href="mailto:iammadfortech@gmail.com"
            className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-brand"
          >
            iammadfortech@gmail.com
          </a>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
