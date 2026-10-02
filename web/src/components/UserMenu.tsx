import { useLocation, useNavigate } from "react-router-dom";
import { DropdownMenu } from "radix-ui";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CompassIcon,
  CoffeeIcon,
  LogOutIcon,
  MessageSquareIcon,
  SettingsIcon,
  ShieldCheckIcon,
  CreditCard,
} from "lucide-react";

import { UserAvatar } from "@/src/components/UserAvatar";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { useMe } from "@/src/features/auth/queries";
import { useLogout } from "@/src/features/auth/mutations";
import { useBalance } from "@/src/features/billing/api";
import { useSettingsStore } from "@/src/stores/useSettingsStore";
import { env } from "@/src/lib/env";
import { APP_ACCOUNT, APP_BILLING } from "@/src/lib/routes";
import { nameOf } from "@/src/features/account/identity";
import { TOUR_IDS, TOUR_INFO } from "@/src/features/tour/tours";
import { useFeedbackStore } from "@/src/features/feedback/useFeedbackStore";
import { useProjectStore } from "@/src/stores/useProjectStore";
import { useSupportStore } from "@/src/features/support/useSupportStore";

const LOW_CREDITS = 10;

export function UserMenu() {
  const navigate = useNavigate();
  const { data: user } = useMe();
  const logout = useLogout();
  const { data: balance, isLoading: balanceLoading } = useBalance();

  const openSettings = useSettingsStore((s) => s.openSettings);
  const requestTour = useSettingsStore((s) => s.requestTour);
  const inProject = useLocation().pathname.startsWith("/project/");
  const openFeedback = useFeedbackStore((s) => s.open);
  const openSupport = useSupportStore((s) => s.open);

  if (!user) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          data-tour="account-menu"
          className="cursor-pointer rounded-full outline-none transition-opacity hover:opacity-90"
        >
          <UserAvatar user={user} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-60 rounded-lg border border-silver-400/30 bg-space-surface p-1 text-left shadow-xl"
        >
          <DropdownMenu.Item
            onSelect={() => void navigate(APP_ACCOUNT)}
            className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 outline-none select-none data-[highlighted]:bg-space-overlay"
          >
            <UserAvatar user={user} className="size-8" fallbackClassName="text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-silver-900">
                {nameOf(user)}
              </p>
              <p className="truncate text-xs text-silver-600">{user.email}</p>
            </div>
            <ChevronRightIcon className="size-3.5 shrink-0 text-silver-600 opacity-0 transition-opacity group-data-[highlighted]:opacity-100" />
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-silver-400/20" />
          {(() => {
            const available = balance?.credits.available;
            const isLow = available !== undefined && available < LOW_CREDITS;
            return (
              <DropdownMenu.Item
                onSelect={() => void navigate(APP_BILLING)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay"
              >
                {isLow ? (
                  <AlertTriangleIcon className="size-4 shrink-0 text-amber-400" />
                ) : (
                  <CreditCard className="size-4 shrink-0" />
                )}
                Credits
                <span className="ml-auto text-xs text-silver-600 tabular-nums">
                  {balanceLoading ? (
                    <DataSpinner label="Loading credits" />
                  ) : available !== undefined ? (
                    <span>
                      {available % 1 === 0
                        ? available.toFixed(0)
                        : available.toFixed(1)}{" "}
                    </span>
                  ) : (
                    <span aria-label="Credits unavailable">-</span>
                  )}
                </span>
              </DropdownMenu.Item>
            );
          })()}

          <DropdownMenu.Separator className="my-1 h-px bg-silver-400/20" />

          {/* Admins only. Just a link: the ops console lives on its own origin
              and signs in with Google itself. The role check that matters is
              the API's, on every /admin request. */}
          {user.role === "ADMIN" && (
            <DropdownMenu.Item
              asChild
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay"
            >
              <a href={env.ADMIN_URL} target="_blank" rel="noopener noreferrer">
                <ShieldCheckIcon className="size-4 text-brand" />
                Ops console
              </a>
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
            onSelect={() =>
              openFeedback(
                "account",
                inProject
                  ? (useProjectStore.getState().projectId ?? undefined)
                  : undefined,
              )
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay"
          >
            <MessageSquareIcon className="size-4" />
            Feedback &amp; suggestions
          </DropdownMenu.Item>

          <DropdownMenu.Item
            onSelect={openSupport}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay"
          >
            <CoffeeIcon className="size-4" />
            Support tau
          </DropdownMenu.Item>

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
  );
}
