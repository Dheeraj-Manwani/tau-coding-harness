import { useLocation } from "react-router-dom";
import { Switch } from "radix-ui";
import { BellRingIcon, CompassIcon, Volume2Icon } from "lucide-react";
import toast from "react-hot-toast";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { useSettings } from "@/src/hooks/useSettings";
import { TOUR_IDS, TOUR_INFO } from "@/src/features/tour/tours";
import { useSettingsStore } from "@/src/stores/useSettingsStore";
import {
  browserNotificationsSupported,
  requestReadyNotificationPermission,
} from "@/src/features/project/useReadyNotification";
import {
  playNotificationSound,
  primeNotificationSound,
} from "@/src/features/project/notificationSound";

/** Global Settings modal: open it from anywhere via useSettingsStore.openSettings(). */
export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen);
  const close = useSettingsStore((s) => s.closeSettings);
  const requestTour = useSettingsStore((s) => s.requestTour);
  const {
    reduceMotion,
    setReduceMotion,
    notifyWhenReady,
    setNotifyWhenReady,
    notificationSound,
    setNotificationSound,
  } = useSettings();

  const changeSound = async (enabled: boolean) => {
    setNotificationSound(enabled);
    if (!enabled) return;
    // Let them hear what they just turned on, at the volume they'll hear most.
    await primeNotificationSound();
    playNotificationSound("soft");
  };
  // Tours point at the project workspace, so they can only replay there.
  const inProject = useLocation().pathname.startsWith("/project/");
  const notificationsSupported = browserNotificationsSupported();
  const notificationPermission = notificationsSupported
    ? Notification.permission
    : "denied";

  const changeReadyNotifications = async (enabled: boolean) => {
    if (!enabled) {
      setNotifyWhenReady(false);
      return;
    }

    if (!(await requestReadyNotificationPermission())) {
      toast.error("Allow browser notifications to enable this setting");
      return;
    }

    setNotifyWhenReady(true);
    toast.success("Ready notifications enabled");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Saved to your account, except notifications, which are set per
            device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label
            htmlFor="reduce-motion"
            className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-silver-900">
                Reduce motion
              </span>
              <span className="text-xs text-silver-600">
                Turn off animated effects like the lightning border and glitch
                stars for a calmer interface.
              </span>
            </span>

            <Switch.Root
              id="reduce-motion"
              checked={reduceMotion}
              onCheckedChange={setReduceMotion}
              className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full bg-space-overlay ring-1 ring-silver-400/40 outline-none transition-colors data-[state=checked]:bg-brand"
            >
              <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-silver-900 transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-zinc-950" />
            </Switch.Root>
          </label>

          <label
            htmlFor="notify-when-ready"
            className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4"
          >
            <span className="flex gap-2.5">
              <BellRingIcon className="mt-0.5 size-4 shrink-0 text-silver-600" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-silver-900">
                  Desktop notifications
                </span>
                <span className="text-xs text-silver-600">
                  Get a system notification when a build finishes or needs
                  you while Tau is in the background. Keep Tau open in a tab.
                </span>
                {!notificationsSupported && (
                  <span className="text-xs text-amber-400">
                    Browser notifications are not supported here.
                  </span>
                )}
                {notificationsSupported && notificationPermission === "denied" && (
                  <span className="text-xs text-amber-400">
                    Notifications are blocked in browser settings.
                  </span>
                )}
                {notificationsSupported &&
                  notifyWhenReady &&
                  notificationPermission === "default" && (
                    <span className="text-xs text-amber-400">
                      Browser permission needs to be granted again.
                    </span>
                  )}
              </span>
            </span>

            <Switch.Root
              id="notify-when-ready"
              checked={
                notifyWhenReady &&
                notificationsSupported &&
                notificationPermission === "granted"
              }
              disabled={!notificationsSupported}
              onCheckedChange={(enabled) =>
                void changeReadyNotifications(enabled)
              }
              className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full bg-space-overlay ring-1 ring-silver-400/40 outline-none transition-colors data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-silver-900 transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-zinc-950" />
            </Switch.Root>
          </label>

          <label
            htmlFor="notification-sound"
            className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4"
          >
            <span className="flex gap-2.5">
              <Volume2Icon className="mt-0.5 size-4 shrink-0 text-silver-600" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-silver-900">
                  Sound
                </span>
                <span className="text-xs text-silver-600">
                  A soft chime when a build finishes or needs you; louder when
                  you&rsquo;re in another tab.
                </span>
              </span>
            </span>

            <Switch.Root
              id="notification-sound"
              checked={notificationSound}
              onCheckedChange={(enabled) => void changeSound(enabled)}
              className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full bg-space-overlay ring-1 ring-silver-400/40 outline-none transition-colors data-[state=checked]:bg-brand"
            >
              <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-silver-900 transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-zinc-950" />
            </Switch.Root>
          </label>

          <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex gap-2.5">
              <CompassIcon className="mt-0.5 size-4 shrink-0 text-silver-600" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-silver-900">
                  Product tours
                </span>
                <span className="text-xs text-silver-600">
                  {inProject
                    ? "Replay a quick walkthrough of the project workspace."
                    : "Open a project to replay its walkthroughs."}
                </span>
              </span>
            </span>

            <span className="flex shrink-0 gap-1.5">
              {TOUR_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={!inProject}
                  title={TOUR_INFO[id].summary}
                  onClick={() => requestTour(id)}
                  className="rounded-md border border-silver-400/30 px-2.5 py-1.5 text-xs font-medium text-silver-700 transition-colors hover:border-silver-400/60 hover:text-silver-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {TOUR_INFO[id].short}
                </button>
              ))}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
