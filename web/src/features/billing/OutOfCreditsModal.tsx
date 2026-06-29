import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangleIcon } from "lucide-react";

import { useBillingStore } from "./useBillingStore";
import { useRedeemCode } from "./api";
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

export function OutOfCreditsModal() {
  const open = useBillingStore((s) => s.outOfCreditsOpen);
  const close = useBillingStore((s) => s.close);
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const redeemCode = useRedeemCode();

  const handleRedeem = () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    redeemCode.mutate(trimmed, {
      onSuccess: (data) => {
        toast.success(`+${data.creditsGranted.toFixed(1)} credits added!`);
        close();
        setCode("");
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Invalid promo code");
      },
    });
  };

  const handleUpgrade = () => {
    close();
    navigate("/billing");
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
            You've used your credit allowance for this session. Redeem a promo
            code or upgrade to PRO for 5,000 credits per month.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            <p className="text-sm font-medium">Redeem a code</p>
            <div className="flex gap-2">
              <Input
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

          <Button className="w-full" onClick={handleUpgrade}>
            Upgrade to PRO — ₹999/month
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
