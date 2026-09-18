import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import type { JobStatus } from "@/src/stores/useProjectStore";
import { useSettingsStore } from "@/src/stores/useSettingsStore";

export type ReadyNotificationController = {
  supported: boolean;
  armed: boolean;
  toggle: () => Promise<void>;
};

type ReadyNotificationOptions = {
  projectId?: string;
  currentJobId: string | null;
  status: JobStatus;
};

export function browserNotificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestReadyNotificationPermission() {
  if (!browserNotificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/**
 * Owns the opt-in for one active build.
 *
 * The project page (rather than ChatPanel) owns this hook because ChatPanel is
 * remounted when a new project grows from chat-only into the full workspace.
 */
export function useReadyNotification({
  projectId,
  currentJobId,
  status,
}: ReadyNotificationOptions): ReadyNotificationController {
  const supported = browserNotificationsSupported();
  const notifyByDefault = useSettingsStore((s) => s.notifyWhenReady);
  const [runChoice, setRunChoice] = useState<{
    jobId: string;
    enabled: boolean;
  } | null>(null);
  const previousStatusRef = useRef(status);
  const armedRef = useRef(false);
  const permissionGranted =
    supported && Notification.permission === "granted";
  const armed = Boolean(
    currentJobId &&
      permissionGranted &&
      (runChoice?.jobId === currentJobId
        ? runChoice.enabled
        : notifyByDefault),
  );

  useEffect(() => {
    const wasRunning = previousStatusRef.current === "streaming";
    const wasArmed = armedRef.current;
    previousStatusRef.current = status;
    armedRef.current = armed;

    if (!wasArmed || !wasRunning) return;

    if (status === "done") {
      try {
        const notification = new Notification("Your Tau project is ready", {
          body: "Tau has finished working on your project.",
          icon: "/android-chrome-192x192.png",
          tag: `tau-project-ready-${projectId ?? "project"}`,
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch {
        // Some browsers expose the API but reject direct construction. The
        // in-app toast still makes completion visible when that happens.
        toast.success("Your project is ready");
      }
    }
  }, [armed, projectId, status]);

  const toggle = useCallback(async () => {
    if (!projectId || !currentJobId || status !== "streaming") return;

    if (armed) {
      setRunChoice({ jobId: currentJobId, enabled: false });
      toast("Ready notification turned off");
      return;
    }

    if (!browserNotificationsSupported()) {
      toast.error("Browser notifications are not supported here");
      return;
    }

    if (!(await requestReadyNotificationPermission())) {
      toast.error("Allow browser notifications to use Notify when ready");
      return;
    }

    setRunChoice({ jobId: currentJobId, enabled: true });
    toast.success("We’ll notify you when this run is ready");
  }, [armed, currentJobId, projectId, status]);

  return {
    supported,
    armed,
    toggle,
  };
}
