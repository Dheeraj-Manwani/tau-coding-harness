import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  getInputNotificationCopy,
  getReadyNotificationCopy,
  type ReadyNotificationCopy,
} from "@/src/features/project/readyNotificationCopy";
import {
  READY_NOTIFICATION_PROMPT_DELAY_MS,
  shouldShowReadyNotificationPrompt,
} from "@/src/features/project/readyNotificationPrompt";
import type { TerminalOutcome } from "@/src/features/project/types";
import {
  playNotificationSound,
  primeNotificationSound,
  registerNotificationSoundUnlock,
} from "@/src/features/project/notificationSound";
import type { JobStatus } from "@/src/stores/useProjectStore";
import { useSettingsStore } from "@/src/stores/useSettingsStore";

export type ReadyNotificationController = {
  supported: boolean;
  armed: boolean;
  showPrompt: boolean;
  enable: () => Promise<void>;
};

type ReadyNotificationOptions = {
  projectId?: string;
  currentJobId: string | null;
  status: JobStatus;
  terminalOutcome: TerminalOutcome | null;
  pendingQuestion: { id: string; question: string } | null;
};

export function browserNotificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestReadyNotificationPermission() {
  if (!browserNotificationsSupported()) return false;
  await primeNotificationSound();
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function showBrowserNotification(
  copy: ReadyNotificationCopy,
  projectId: string | undefined,
  event: "finished" | "input",
): boolean {
  try {
    const notification = new Notification(copy.title, {
      body: copy.body,
      icon: "/android-chrome-192x192.png",
      badge: "/favicon-32x32.png",
      tag: `tau-project-${event}-${projectId ?? "project"}`,
      requireInteraction: event === "input",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

function showInAppNotification(
  copy: ReadyNotificationCopy,
  projectId: string | undefined,
  event: "finished" | "input",
) {
  toast(`${copy.title}: ${copy.body}`, {
    id: `tau-project-${event}-${projectId ?? "project"}`,
    icon: event === "input" ? "🔔" : "✓",
    duration: event === "input" ? 8_000 : 6_000,
  });
}

/** User-initiated smoke test exposed in Settings. */
export async function sendReadyNotificationTest(): Promise<void> {
  const copy = {
    title: "Tau notifications are ready",
    body: "You’ll get an alert when Tau finishes working.",
  };
  await primeNotificationSound();
  playNotificationSound();
  showInAppNotification(copy, undefined, "finished");
  if (
    browserNotificationsSupported() &&
    Notification.permission === "granted"
  ) {
    showBrowserNotification(copy, undefined, "finished");
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
  terminalOutcome,
  pendingQuestion,
}: ReadyNotificationOptions): ReadyNotificationController {
  const supported = browserNotificationsSupported();
  const notificationsEnabled = useSettingsStore((s) => s.notifyWhenReady);
  const setNotifyWhenReady = useSettingsStore((s) => s.setNotifyWhenReady);
  const [promptJobId, setPromptJobId] = useState<string | null>(null);
  const previousStatusRef = useRef(status);
  const armedRef = useRef(false);
  const notifiedQuestionRef = useRef<string | null>(null);
  const permissionGranted =
    supported && Notification.permission === "granted";
  const armed = Boolean(
    currentJobId && permissionGranted && notificationsEnabled,
  );
  const showPrompt = shouldShowReadyNotificationPrompt({
    currentJobId,
    thresholdJobId: promptJobId,
    status,
    notificationsEnabled,
    permissionGranted,
    supported,
  });

  useEffect(() => registerNotificationSoundUnlock(), []);

  // Track the five-second threshold independently from the setting. This means
  // turning notifications off after a long run has already crossed the
  // threshold reveals the bar immediately instead of starting a fresh timer.
  // The timer lives with ProjectPage rather than ChatPanel, so the chat-only →
  // workspace remount cannot restart it.
  useEffect(() => {
    if (!currentJobId || status !== "streaming" || !supported) return;
    const timer = window.setTimeout(
      () => setPromptJobId(currentJobId),
      READY_NOTIFICATION_PROMPT_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [currentJobId, status, supported]);

  useEffect(() => {
    const wasRunning = previousStatusRef.current === "streaming";
    const wasArmed = armedRef.current;
    previousStatusRef.current = status;
    armedRef.current = armed;

    if (!wasRunning) return;

    const copy = getReadyNotificationCopy(terminalOutcome, status);
    if (!copy) return;

    // The in-app toast is unconditional so a foreground tab always shows an
    // observable completion even when browser permission is off or blocked.
    showInAppNotification(copy, projectId, "finished");

    if (wasArmed) {
      playNotificationSound();
      showBrowserNotification(copy, projectId, "finished");
    }
  }, [armed, projectId, status, terminalOutcome]);

  useEffect(() => {
    if (!pendingQuestion) return;
    if (notifiedQuestionRef.current === pendingQuestion.id) return;
    notifiedQuestionRef.current = pendingQuestion.id;
    const copy = getInputNotificationCopy(pendingQuestion.question);
    showInAppNotification(copy, projectId, "input");
    if (armed) {
      playNotificationSound();
      showBrowserNotification(copy, projectId, "input");
    }
  }, [armed, pendingQuestion, projectId]);

  const enable = useCallback(async () => {
    if (!projectId || !currentJobId || status !== "streaming") return;
    if (armed) return;

    if (!browserNotificationsSupported()) {
      toast.error("Browser notifications are not supported here");
      return;
    }

    if (!(await requestReadyNotificationPermission())) {
      toast.error("Allow browser notifications to use Notify when ready");
      return;
    }

    setNotifyWhenReady(true);
    toast.success("We’ll notify you when this run is ready");
  }, [armed, currentJobId, projectId, setNotifyWhenReady, status]);

  return {
    supported,
    armed,
    showPrompt,
    enable,
  };
}
