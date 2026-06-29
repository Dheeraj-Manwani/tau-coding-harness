import { useNavigate } from "react-router-dom";
import { DropdownMenu } from "radix-ui";
import { AlertTriangleIcon, LogOutIcon, ZapIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import { useMe } from "@/src/features/auth/queries";
import { useLogout } from "@/src/features/auth/mutations";
import { useBalance } from "@/src/features/billing/api";
import { cn } from "@/src/lib/utils";

const LOW_CREDITS = 10;

export function UserMenu() {
  const navigate = useNavigate();
  const { data: user } = useMe();
  const logout = useLogout();
  const { data: balance } = useBalance();

  if (!user) return null;

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full outline-none transition-opacity hover:opacity-90 cursor-pointer"
        >
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-60 rounded-lg border border-silver-400/30 bg-space-surface p-1 text-left shadow-xl"
        >
          <div className="px-3 py-2.5">
            <p className="text-xs text-silver-600">Signed in as</p>
            <p className="truncate text-sm font-medium text-silver-900">
              {user.email}
            </p>
          </div>

          {balance && (() => {
            const available = balance.credits.available;
            const isLow = available < LOW_CREDITS;
            return (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-silver-400/20" />
                <button
                  type="button"
                  onClick={() => navigate("/billing")}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm outline-none transition-colors",
                    isLow
                      ? "text-amber-400 hover:bg-amber-500/10"
                      : "text-silver-600 hover:bg-space-overlay hover:text-silver-900",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {isLow
                      ? <AlertTriangleIcon className="size-4 shrink-0" />
                      : <ZapIcon className="size-4 shrink-0" />}
                    Credits
                  </span>
                  <span className="font-medium">
                    {available % 1 === 0 ? available.toFixed(0) : available.toFixed(1)} cr
                  </span>
                </button>
              </>
            );
          })()}

          <DropdownMenu.Separator className="my-1 h-px bg-silver-400/20" />

          <DropdownMenu.Item
            onSelect={() => logout.mutate()}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay"
          >
            <LogOutIcon className="size-4" />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
