import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DropdownMenu, Popover, Checkbox } from "radix-ui";
import {
  AlertTriangleIcon,
  CheckIcon,
  LogOutIcon,
  SettingsIcon,
  ZapIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import { useMe } from "@/src/features/auth/queries";
import { useLogout } from "@/src/features/auth/mutations";
import { useBalance } from "@/src/features/billing/api";
import { useSettingsStore } from "@/src/stores/useSettingsStore";
import { cn } from "@/src/lib/utils";

const LOW_CREDITS = 10;

export function UserMenu() {
  const navigate = useNavigate();
  const { data: user } = useMe();
  const logout = useLogout();
  const { data: balance } = useBalance();

  const openSettings = useSettingsStore((s) => s.openSettings);
  const hasSeenMotionIntro = useSettingsStore((s) => s.hasSeenMotionIntro);
  const markMotionIntroSeen = useSettingsStore((s) => s.markMotionIntroSeen);
  const setReduceMotion = useSettingsStore((s) => s.setReduceMotion);
  const [introChecked, setIntroChecked] = useState(false);

  if (!user) return null;

  const initials = user.email.slice(0, 2).toUpperCase();

  const dismissIntro = () => {
    if (introChecked) setReduceMotion(true);
    markMotionIntroSeen();
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

            {balance &&
              (() => {
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
                        {isLow ? (
                          <AlertTriangleIcon className="size-4 shrink-0" />
                        ) : (
                          <ZapIcon className="size-4 shrink-0" />
                        )}
                        Credits
                      </span>
                      <span className="font-medium">
                        {available % 1 === 0
                          ? available.toFixed(0)
                          : available.toFixed(1)}{" "}
                        cr
                      </span>
                    </button>
                  </>
                );
              })()}

            <DropdownMenu.Separator className="my-1 h-px bg-silver-400/20" />

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
