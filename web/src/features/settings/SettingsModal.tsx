import { Switch } from "radix-ui";
import { BellRingIcon } from "lucide-react";
import toast from "react-hot-toast";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { useSettingsStore } from "@/src/stores/useSettingsStore";
import {
  browserNotificationsSupported,
  requestReadyNotificationPermission,
} from "@/src/features/project/useReadyNotification";

/** Global Settings modal — open it from anywhere via useSettingsStore.openSettings(). */
export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen);
  const close = useSettingsStore((s) => s.closeSettings);
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const setReduceMotion = useSettingsStore((s) => s.setReduceMotion);
  const notifyWhenReady = useSettingsStore((s) => s.notifyWhenReady);
  const setNotifyWhenReady = useSettingsStore((s) => s.setNotifyWhenReady);
  const notificationsSupported = browserNotificationsSupported();

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Preferences are saved on this device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label
            htmlFor="reduce-motion"
            className="flex items-start justify-between gap-4 rounded-lg border border-silver-400/25 bg-space-surface p-3"
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
              <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-silver-900 transition-transform data-[state=checked]:translate-x-[18px]" />
            </Switch.Root>
          </label>

          <label
            htmlFor="notify-when-ready"
            className="flex items-start justify-between gap-4 rounded-lg border border-silver-400/25 bg-space-surface p-3"
          >
            <span className="flex gap-2.5">
              <BellRingIcon className="mt-0.5 size-4 shrink-0 text-silver-600" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-silver-900">
                  Notify when ready
                </span>
                <span className="text-xs text-silver-600">
                  Automatically notify you when a project run finishes. Keep
                  Tau open in a browser tab.
                </span>
                {!notificationsSupported && (
                  <span className="text-xs text-amber-400">
                    Browser notifications are not supported here.
                  </span>
                )}
              </span>
            </span>

            <Switch.Root
              id="notify-when-ready"
              checked={notifyWhenReady && notificationsSupported}
              disabled={!notificationsSupported}
              onCheckedChange={(enabled) =>
                void changeReadyNotifications(enabled)
              }
              className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full bg-space-overlay ring-1 ring-silver-400/40 outline-none transition-colors data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-silver-900 transition-transform data-[state=checked]:translate-x-[18px]" />
            </Switch.Root>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
