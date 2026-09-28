import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DropdownMenu, Popover, Checkbox } from "radix-ui";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronRightIcon,
  CompassIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ZapIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { useMe } from "@/src/features/auth/queries";
import { useLogout } from "@/src/features/auth/mutations";
import { useBalance } from "@/src/features/billing/api";
import { useSettings } from "@/src/hooks/useSettings";
import { useSettingsStore } from "@/src/stores/useSettingsStore";
import { openAdminConsole } from "@/src/features/admin/api";
import { APP_BILLING } from "@/src/lib/routes";
import { cn } from "@/src/lib/utils";
import { TOUR_IDS, TOUR_INFO } from "@/src/features/tour/tours";

const LOW_CREDITS = 10;

export function UserMenu() {
  const navigate = useNavigate();
  const { data: user } = useMe();
  const logout = useLogout();
  const { data: balance, isLoading: balanceLoading } = useBalance();

  const openSettings = useSettingsStore((s) => s.openSettings);
  const requestTour = useSettingsStore((s) => s.requestTour);
  const inProject = useLocation().pathname.startsWith("/project/");
  const { hasSeenMotionIntro, markMotionIntroSeen } = useSettings();
  const [introChecked, setIntroChecked] = useState(false);

  if (!user) return null;

  const initials = user.email.slice(0, 2).toUpperCase();

  const dismissIntro = () => {
    // One write for both flags, so the intro can't be marked seen while the
    // motion choice made in it is lost.
    markMotionIntroSeen(introChecked ? { reduceMotion: true } : undefined);
  };

  return (
    // On a user's first visit, a one-time "reduce motion" intro popover is
    // anchored to the avatar. It uses an Anchor (not a Trigger) so opening the
    // account dropdown never fights the popover's controlled open state.
    <Popover.Root
      open={!hasSeenMotionIntro}
      onOpenChange={(next) => {
        // Any close (Continue, Esc, click-away) counts as "seen".
        if (!next) dismissIntro();
      }}
    >
      <DropdownMenu.Root>
        <Popover.Anchor asChild>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              data-tour="account-menu"
              className="cursor-pointer rounded-full outline-none transition-opacity hover:opacity-90"
            >
              <Avatar>
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenu.Trigger>
        </Popover.Anchor>

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

            <DropdownMenu.Separator className="my-1 h-px bg-silver-400/20" />
            {(() => {
              const available = balance?.credits.available;
              const isLow = available !== undefined && available < LOW_CREDITS;
              return (
                <button
                  type="button"
                  onClick={() => navigate(APP_BILLING)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm outline-none transition-colors",
                    isLow
                      ? "text-amber-400 hover:bg-amber-500/10"
                      : "text-silver-600 hover:bg-space-overlay hover:text-silver-900",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {isLow ? (
                      <AlertTriangleIcon className="size-4 shrink-0" />
                    ) : (
                      <ZapIcon className="size-4 shrink-0" />
                    )}
                    Credits
                  </span>
                  {balanceLoading ? (
                    <DataSpinner label="Loading credits" />
                  ) : available !== undefined ? (
                    <span className="font-medium">
                      {available % 1 === 0
                        ? available.toFixed(0)
                        : available.toFixed(1)}{" "}
                      cr
                    </span>
                  ) : (
                    <span aria-label="Credits unavailable">-</span>
                  )}
                </button>
              );
            })()}

            <DropdownMenu.Separator className="my-1 h-px bg-silver-400/20" />

            {/* Admins only. `openAdminConsole` runs inside the click handler's
                call stack so its `window.open` survives the popup blocker. */}
            {user.role === "ADMIN" && (
              <DropdownMenu.Item
                onSelect={() => void openAdminConsole()}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay"
              >
                <ShieldCheckIcon className="size-4 text-brand" />
                Ops console
              </DropdownMenu.Item>
            )}

            {/* Tours point at the project workspace, so they're only offered there. */}
            {inProject && (
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay data-[state=open]:bg-space-overlay">
                  <CompassIcon className="size-4" />
                  Take a tour
                  <ChevronRightIcon className="ml-auto size-3.5 text-silver-600" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={6}
                    alignOffset={-4}
                    className="z-50 min-w-52 rounded-lg border border-silver-400/30 bg-space-surface p-1 text-left shadow-xl"
                  >
                    {TOUR_IDS.map((id) => (
                      <DropdownMenu.Item
                        key={id}
                        onSelect={() => requestTour(id)}
                        className="flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 outline-none select-none data-[highlighted]:bg-space-overlay"
                      >
                        <span className="text-sm text-silver-900">
                          {TOUR_INFO[id].label}
                        </span>
                        <span className="text-xs text-silver-600">
                          {TOUR_INFO[id].summary}
                        </span>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            )}

            <DropdownMenu.Item
              onSelect={() => openSettings()}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay"
            >
              <SettingsIcon className="size-4" />
              Settings
            </DropdownMenu.Item>

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

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          className="z-50 w-72 rounded-xl border border-silver-400/30 bg-space-surface p-4 text-left shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Popover.Arrow className="fill-space-surface" />

          <p className="font-heading text-sm font-medium text-silver-900">
            Make Tau comfortable for you
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-silver-600">
            If animated effects bother you or you prefer a calmer interface, turn
            on Reduce motion below. You can change this anytime in Settings.
          </p>

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-silver-900">
            <Checkbox.Root
              checked={introChecked}
              onCheckedChange={(v) => setIntroChecked(v === true)}
              className="flex size-4 items-center justify-center rounded border border-silver-400/60 bg-space-overlay outline-none data-[state=checked]:border-brand data-[state=checked]:bg-brand"
            >
              <Checkbox.Indicator>
                <CheckIcon className="size-3 text-white" />
              </Checkbox.Indicator>
            </Checkbox.Root>
            Reduce motion
          </label>

          <Popover.Close asChild>
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-brand/90"
            >
              Continue
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
