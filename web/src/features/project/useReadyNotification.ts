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
import {
  chooseDelivery,
  isUserAttentive,
  shouldNotifyForRun,
} from "@/src/features/project/readyNotificationRouting";
import { clearTitleBadge, showTitleBadge } from "@/src/features/project/titleBadge";
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
  /** "Not now": hide the opt-in bar on this device for a few days. */
  snooze: () => void;
};

type ReadyNotificationOptions = {
  projectId?: string;
  projectName?: string | null;
  currentJobId: string | null;
  status: JobStatus;
  /** The running job is a preview restart or deploy, not a build. */
  isPreviewJob: boolean;
  terminalOutcome: TerminalOutcome | null;
  pendingQuestion: { id: string; question: string } | null;
  /** The job this tab's user pressed Stop on. */
  userCancelledJobId: string | null;
};

type NotificationEvent = "finished" | "input";

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
  event: NotificationEvent,
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

/**
 * Alerts for the build on this project page.
 *
 * Deliberately scoped to the page: leaving the project ends the watch. How
 * loud an alert is depends on where the user's attention is (see
 * `chooseDelivery`); in short, a soft chime if they're looking at the project,
 * a system notification + title badge if they're not. Nothing is shown as an
 * in-app toast, because a user looking at the project can already see it.
 *
 * The project page (rather than ChatPanel) owns this hook because ChatPanel is
 * remounted when a new project grows from chat-only into the full workspace.
 */
export function useReadyNotification({
  projectId,
  projectName,
  currentJobId,
  status,
  isPreviewJob,
  terminalOutcome,
  pendingQuestion,
  userCancelledJobId,
}: ReadyNotificationOptions): ReadyNotificationController {
  const supported = browserNotificationsSupported();
  const notificationsEnabled = useSettingsStore((s) => s.notifyWhenReady);
  const soundEnabled = useSettingsStore((s) => s.notificationSound);
  const snoozedUntil = useSettingsStore((s) => s.notifyPromptSnoozedUntil);
  const setNotifyWhenReady = useSettingsStore((s) => s.setNotifyWhenReady);
  const snoozeNotifyPrompt = useSettingsStore((s) => s.snoozeNotifyPrompt);
  // Which job crossed the prompt threshold, and when. The time is taken in the
  // timer callback rather than during render, which must stay pure.
  const [threshold, setThreshold] = useState<{ jobId: string; at: number } | null>(
    null,
  );
  const previousStatusRef = useRef(status);
  // What was running, remembered past the terminal event: by the time a run
  // has ended the store has already cleared `currentJobId` and `isPreviewJob`.
  const runRef = useRef<{ jobId: string | null; isPreviewJob: boolean }>({
    jobId: null,
    isPreviewJob: false,
  });
  const notifiedQuestionRef = useRef<string | null>(null);
  const permissionGranted =
    supported && Notification.permission === "granted";
  const systemEnabled = permissionGranted && notificationsEnabled;
  const armed = Boolean(currentJobId && systemEnabled);
  const showPrompt = shouldShowReadyNotificationPrompt({
    currentJobId,
    thresholdJobId: threshold?.jobId ?? null,
    status,
    isPreviewJob,
    notificationsEnabled,
    permissionGranted,
    supported,
    snoozedUntil,
    now: threshold?.at ?? 0,
  });

  useEffect(() => registerNotificationSoundUnlock(), []);
  // Leaving the project ends the watch, including any "while you were away"
  // badge it put on the tab title.
  useEffect(() => clearTitleBadge, []);

  const deliver = useCallback(
    (copy: ReadyNotificationCopy, event: NotificationEvent) => {
      const delivery = chooseDelivery({
        attentive: isUserAttentive(),
        systemEnabled,
        soundEnabled,
      });
      if (delivery.sound) playNotificationSound(delivery.sound);
      if (delivery.system) showBrowserNotification(copy, projectId, event);
      if (delivery.badge) showTitleBadge(copy.title);
    },
    [projectId, soundEnabled, systemEnabled],
  );

  // Track the threshold independently from the setting. This means turning
  // notifications off after a long run has already crossed the threshold
  // reveals the bar immediately instead of starting a fresh timer. The timer
  // lives with ProjectPage rather than ChatPanel, so the chat-only → workspace
  // remount cannot restart it.
  useEffect(() => {
    if (!currentJobId || status !== "streaming" || !supported || isPreviewJob) {
      return;
    }
    const timer = window.setTimeout(
      () => setThreshold({ jobId: currentJobId, at: Date.now() }),
      READY_NOTIFICATION_PROMPT_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [currentJobId, status, supported, isPreviewJob]);

  useEffect(() => {
    const wasRunning = previousStatusRef.current === "streaming";
    previousStatusRef.current = status;

    if (status === "streaming") {
      runRef.current = { jobId: currentJobId, isPreviewJob };
      return;
    }
    if (!wasRunning) return;

    const run = runRef.current;
    const notify = shouldNotifyForRun({
      wasPreviewJob: run.isPreviewJob,
      cancelledByUser: run.jobId !== null && run.jobId === userCancelledJobId,
      outcome: terminalOutcome,
      status,
    });
    if (!notify) return;

    const copy = getReadyNotificationCopy(terminalOutcome, status, projectName);
    if (copy) deliver(copy, "finished");
  }, [
    currentJobId,
    deliver,
    isPreviewJob,
    projectName,
    status,
    terminalOutcome,
    userCancelledJobId,
  ]);

  useEffect(() => {
    if (!pendingQuestion) return;
    if (notifiedQuestionRef.current === pendingQuestion.id) return;
    notifiedQuestionRef.current = pendingQuestion.id;
    deliver(
      getInputNotificationCopy(pendingQuestion.question, projectName),
      "input",
    );
  }, [deliver, pendingQuestion, projectName]);

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
    snooze: snoozeNotifyPrompt,
  };
}
