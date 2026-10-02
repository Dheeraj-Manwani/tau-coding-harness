import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  BadgeCheckIcon,
  ChevronRightIcon,
  LogOutIcon,
  MailIcon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import { APP_BILLING } from "@/src/lib/routes";
import { useBalance } from "@/src/features/billing/api";
import { useLogoutAll } from "@/src/features/auth/mutations";
import type { AuthUser } from "@/src/features/auth/types";

function Row({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 py-2.5">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-sm">
        {children}
      </div>
    </div>
  );
}

export function AccountDetailsCard({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  const { data: balance } = useBalance();

  return (
    <div className="rounded-xl border bg-card px-5 py-2">
      <div className="divide-y divide-border">
        <Row icon={<MailIcon className="size-4" />} label="Email">
          <span className="truncate">{user.email}</span>
          {user.emailVerifiedAt && (
            <BadgeCheckIcon
              className="size-4 shrink-0 text-[color:var(--blue-500)]"
              aria-label="Verified"
            />
          )}
        </Row>

        <Row icon={<SparklesIcon className="size-4" />} label="Plan">
          {balance && (
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                balance.plan === "PRO"
                  ? "bg-indigo-500/10 text-indigo-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {balance.plan}
            </span>
          )}
          <button
            type="button"
            onClick={() => void navigate(APP_BILLING)}
            className="flex cursor-pointer items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Billing
            <ChevronRightIcon className="size-3.5" />
          </button>
        </Row>

        <Row icon={<LogOutIcon className="size-4" />} label="Sessions">
          <LogoutEverywhere />
        </Row>
      </div>
    </div>
  );
}

/** Two clicks, no dialog: the second click is the confirmation. */
function LogoutEverywhere() {
  const navigate = useNavigate();
  const logoutAll = useLogoutAll();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={logoutAll.isPending}
      className={cn(armed && "border-destructive/50 text-destructive hover:text-destructive")}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        logoutAll.mutate(undefined, {
          onSuccess: () => {
            toast.success("Signed out everywhere. See you back in orbit.");
            void navigate("/login");
          },
          onError: () => toast.error("Couldn't sign out everywhere. Try again?"),
        });
      }}
    >
      {logoutAll.isPending
        ? "Signing out…"
        : armed
          ? "Sure? Every device"
          : "Log out everywhere"}
    </Button>
  );
}
