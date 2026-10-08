import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpIcon,
  CodeIcon,
  CreditCardIcon,
  ImageIcon,
  LayersIcon,
  ListChecksIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  PencilIcon,
  PlayIcon,
  PowerOffIcon,
  SquareIcon,
  SquareMousePointerIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XIcon,
  HeartIcon,
  KeyRoundIcon,
  LightbulbIcon,
  PaperclipIcon,
  SparklesIcon,
  DownloadIcon,
  GaugeIcon,
  MessagesSquareIcon,
  TypeIcon,
} from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { useFeedbackStore } from "@/src/features/feedback/useFeedbackStore";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { BuildLoaderCard } from "@/src/features/project/BuildLoaderCard";
import { PreviewStoppedCard } from "@/src/features/project/PreviewStoppedCard";
import { PreviewFailedCard } from "@/src/features/project/PreviewFailedCard";
import { GithubMark } from "@/src/components/ui/github-mark";
import { VisualStylePanel } from "@/src/features/project/VisualStylePanel";
import { VisualImagePanel } from "@/src/features/project/VisualImagePanel";
import { VisualThemePanel } from "@/src/features/project/VisualThemePanel";
import {
  computedValueFor,
  describeRefusedEdit,
  type ComputedValue,
} from "@/src/features/project/visualEditPrompt";
import { useSendMessage } from "@/src/features/project/useSendMessage";
import {
  locToPath,
  useProjectStore,
  type VisualSelection,
} from "@/src/stores/useProjectStore";
import {
  usePreviewStatus,
  useRestartPreview,
  useVisualEdit,
  type VisualEditRefusal,
} from "@/src/features/project/api";
import { previewSrc } from "@/src/features/project/previewUrl";
import { usePreviewRecovery } from "@/src/features/project/usePreviewRecovery";
import { resolvePreviewSurface, type PreviewSurface } from "@/src/features/project/previewAvailability";
import type {
  PreviewBuildError,
  PreviewRuntimeError,
} from "@/src/features/project/types";
import { ApiError } from "@/src/lib/api-client";
import { APP_BILLING } from "@/src/lib/routes";
import { useBalance } from "@/src/features/billing/api";
import { useUpgradeModalStore } from "@/src/features/billing/useUpgradeModalStore";
import {
  CREDIT_RESUME_PROMPT,
  wasInterruptedForCredits,
} from "@/src/features/project/creditResume";
import {
  activityPhrase,
  getEmptyPreviewState,
  type EmptyPreviewAction,
  type EmptyPreviewInput,
  type EmptyPreviewState,
} from "@/src/features/project/previewEmptyState";
import { GamesModal } from "@/src/features/project/GamesModal";
import { getGamesStatus } from "@/src/features/project/gamesStatus";

const DEVICE_WIDTH: Record<string, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 9999,
};

const BUILD_TIPS = [
  {
    title: "Help shape tau",
    copy: "Share feedback or a suggestion to help shape what we build next.",
    icon: HeartIcon,
    iconClass: "text-amber-400",
  },
  {
    title: "Keep your work on GitHub",
    copy: "Use the GitHub button in the top bar to connect your project and save your code there whenever you want.",
    icon: GithubMark,
    iconClass: "text-[var(--silver-900)]",
  },
  {
    title: "Check every screen size",
    copy: "Switch between desktop, tablet, and mobile in the top bar to make sure your layout works everywhere.",
    icon: MonitorSmartphoneIcon,
    iconClass: "text-sky-400",
  },
  {
    title: "Your code stays editable",
    copy: "Open the Code tab at any time to inspect files or make a quick change yourself while tau works.",
    icon: CodeIcon,
    iconClass: "text-violet-400",
  },
  {
    title: "Edit visually",
    copy: "Use the pointer tool on a live preview to select an element, then change its text, style, or image.",
    icon: SquareMousePointerIcon,
    iconClass: "text-pink-400",
  },
  {
    title: "Build in small steps",
    copy: "After the first version, ask for focused changes one at a time for faster, more predictable results.",
    icon: ListChecksIcon,
    iconClass: "text-emerald-400",
  },
  {
    title: "Pick a look",
    copy: "Choose a style for your app, or restyle it later from the project settings without rewriting your prompt.",
    icon: PaletteIcon,
    iconClass: "text-fuchsia-400",
  },
  {
    title: "Show, don't tell",
    copy: "Attach a screenshot or image to your message and tau can use it as a reference for the look.",
    icon: PaperclipIcon,
    iconClass: "text-cyan-400",
  },
  {
    title: "Set rules once",
    copy: "Write standing instructions in your build defaults and tau follows them in every project.",
    icon: SparklesIcon,
    iconClass: "text-yellow-300",
  },
  {
    title: "Be specific",
    copy: "Say who the app is for and what it should do. A clear brief beats a long one.",
    icon: LightbulbIcon,
    iconClass: "text-amber-300",
  },
  {
    title: "Bring your own words",
    copy: "Paste your real copy, prices or menu items so the first version is not full of placeholder text.",
    icon: TypeIcon,
    iconClass: "text-lime-400",
  },
  {
    title: "Ask for pictures",
    copy: "Ask for a hero image or photos. tau can search for them, and some styles can generate artwork.",
    icon: ImageIcon,
    iconClass: "text-rose-400",
  },
  {
    title: "Keep keys out of prompts",
    copy: "If your app needs an API key, tau asks for it in the chat and stores it as a secret. Never paste keys into a message.",
    icon: KeyRoundIcon,
    iconClass: "text-orange-400",
  },
  {
    title: "Long chats are fine",
    copy: "Older messages are summarised automatically, and you can clear or summarise the chat yourself at any time.",
    icon: MessagesSquareIcon,
    iconClass: "text-indigo-400",
  },
  {
    title: "Match effort to the job",
    copy: "Higher effort is slower and more careful. Use lower effort for quick tweaks and higher for a whole new app.",
    icon: GaugeIcon,
    iconClass: "text-teal-400",
  },
  {
    title: "Take your files with you",
    copy: "Download your project's files whenever you like, or keep them on GitHub.",
    icon: DownloadIcon,
    iconClass: "text-blue-400",
  },
] as const;

const TIP_INTERVAL_MS = 5600;

/** How many tips sit behind the feedback card at a time; shuffling swaps in others. */
const VISIBLE_TIP_COUNT = 4;

/**
 * The cards shown in one cycle: feedback (index 0) first, then a random few of
 * the tips. `avoid` is the set on screen now, so a shuffle brings in fresh ones.
 */
function tipOrder(avoid: readonly number[] = []): number[] {
  const rest = BUILD_TIPS.map((_, i) => i)
    .slice(1)
    .filter((i) => !avoid.includes(i));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [0, ...rest.slice(0, VISIBLE_TIP_COUNT)];
}

function PreviewPlaceholder({
  state,
  onAction,
  onPlay,
}: {
  state: EmptyPreviewState;
  onAction: (action: EmptyPreviewAction) => void;
  onPlay: () => void;
}) {
  const [tipIndex, setTipIndex] = useState(0);
  const [order, setOrder] = useState(() => tipOrder());
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!state.animated || reduceMotion) return;
    const timer = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % (VISIBLE_TIP_COUNT + 1));
    }, TIP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state.animated, reduceMotion]);

  const shuffleTips = () => {
    setOrder((current) => tipOrder(current));
    // Land on a tip, not back on the feedback card the user just saw.
    setTipIndex(1);
  };

  const selectTip = (index: number) => {
    setTipIndex((index + order.length) % order.length);
  };

  if (state.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <DataSpinner label={state.title} />
      </div>
    );
  }

  if (!state.animated) {
    return (
      <div className="flex h-full items-center justify-center bg-black p-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          <span
            className={cn(
              "flex size-12 items-center justify-center rounded-full bg-[var(--space-overlay)]",
              state.tone === "warning"
                ? "text-amber-400"
                : state.tone === "error"
                  ? "text-red-400"
                  : "text-[var(--silver-600)]",
            )}
          >
            {state.tone === "neutral" ? (
              <PowerOffIcon className="size-5" />
            ) : (
              <TriangleAlertIcon className="size-5" />
            )}
          </span>
          <h2 className="mt-4 text-sm font-semibold text-[var(--silver-900)]">
            {state.title}
          </h2>
          {state.description && (
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--silver-600)]">
              {state.description}
            </p>
          )}
          {state.action && state.actionLabel && (
            <button
              type="button"
              onClick={() => onAction(state.action!)}
              className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--blue-500)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              {state.action === "add_credits" ? (
                <CreditCardIcon className="size-3.5" />
              ) : state.action === "stop" ? (
                <SquareIcon className="size-3.5 fill-current" />
              ) : (
                <PlayIcon className="size-3.5 fill-current" />
              )}
              {state.actionLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  const tip = BUILD_TIPS[order[tipIndex]!]!;
  const liveActivity = activityPhrase(state.title);

  return (
    <BuildLoaderCard
      liveActivity={liveActivity}
      tip={tip}
      tipIndex={tipIndex}
      tipCount={order.length}
      onSelectTip={selectTip}
      onShuffle={shuffleTips}
      onPlay={onPlay}
      onFeedback={() =>
        useFeedbackStore
          .getState()
          .open("preview", useProjectStore.getState().projectId ?? undefined)
      }
      reduceMotion={reduceMotion}
    />
  );
}

/** Shown when the live sandbox has gone down: lets the user reboot it from the
 *  persisted project files without spending a chat turn. While the restart is
 *  in flight the button itself shows the progress (no full-pane shimmer). */
function PreviewStopped({
  mode,
  onStart,
  coverImageUrl,
}: {
  mode: Exclude<PreviewSurface, "frame" | "empty">;
  onStart: () => void;
  coverImageUrl: string | null;
}) {
  return (
    <PreviewStoppedCard mode={mode} onStart={onStart} coverImageUrl={coverImageUrl} />
  );
}

/**
 * The bridge to the visual-edit runtime inside the preview.
 *
 * The preview is served from `https://5173-<sandboxId>.e2b.app`, a different
 * origin from this app, so there is no DOM access: postMessage is the whole
 * channel. Every inbound frame is checked against the sandbox origin before it
 * is trusted: without that, any page could post a fake selection carrying an
 * arbitrary file path and we would happily open it.
 *
 * See doc/archive/VISUAL_EDIT_PLAN.md §4.
 */
function useVisualEditBridge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  previewUrl: string | null,
  previewNonce: number,
) {
  const enabled = useProjectStore((s) => s.visualEditEnabled);
  const setReady = useProjectStore((s) => s.setVisualEditReady);
  const setSelection = useProjectStore((s) => s.setVisualSelection);
  const setPreviewError = useProjectStore((s) => s.setPreviewError);

  const origin = previewUrl ? new URL(previewUrl).origin : null;

  useEffect(() => {
    if (!origin) return;

    function onMessage(e: MessageEvent) {
      if (e.origin !== origin) return;
      const d = e.data as Partial<VisualSelection> & {
        source?: string;
        type?: string;
        message?: string;
        file?: string;
        frame?: string;
      };
      if (!d || d.source !== "tau-visual-edit") return;

      if (d.type === "tau:ready") setReady(true);
      else if (d.type === "tau:deselect") setSelection(null);
      else if (d.type === "tau:error" && d.message) {
        setPreviewError({
          message: d.message,
          ...(d.file ? { file: d.file } : {}),
          ...(d.frame ? { frame: d.frame } : {}),
        });
      } else if (d.type === "tau:error-cleared") setPreviewError(null);
      else if (d.type === "tau:select" && d.loc) {
        setSelection({
          loc: d.loc,
          tagName: d.tagName ?? "",
          className: d.className ?? "",
          text: d.text ?? "",
          editableText: Boolean(d.editableText),
          siblingCount: d.siblingCount ?? 1,
          // Only sent for <img>; absent on everything else.
          ...(d.src === undefined ? {} : { src: d.src }),
          ...(d.alt === undefined ? {} : { alt: d.alt }),
        });
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, setReady, setSelection, setPreviewError]);

  // A remount gives us a brand-new runtime that has never heard of us, so the
  // old `ready` is meaningless. `previewNonce` is what remounts the iframe.
  // The error goes with it: the new document will re-report if it is still
  // broken, and showing a stale one over a working preview is worse than a
  // moment with no banner.
  useEffect(() => {
    setReady(false);
    setPreviewError(null);
  }, [previewUrl, previewNonce, setReady, setPreviewError]);

  // Drive the runtime. Re-sent whenever `ready` flips so a reload during pick
  // mode comes back in pick mode rather than silently inert.
  const ready = useProjectStore((s) => s.visualEditReady);
  useEffect(() => {
    if (!origin || !ready) return;
    iframeRef.current?.contentWindow?.postMessage(
      { source: "tau-parent", type: enabled ? "tau:enable" : "tau:disable" },
      origin,
    );
  }, [enabled, ready, origin, iframeRef]);

  /**
   * Re-highlight an element after our own edit.
   *
   * Editing writes the sandbox, Vite pushes an HMR update, and React replaces
   * the DOM node: taking the highlight with it. The element's source position
   * is unchanged (only its text child moved), so the runtime can find it again
   * by `loc`.
   *
   * Retried on a short ladder because we can't know when the new DOM lands:
   * HMR is asynchronous and there is no signal for it across the origin
   * boundary. A `tau:reselect` for an element that isn't there yet is a no-op,
   * so over-sending is harmless.
   */
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    },
    [],
  );

  const reselect = useCallback(
    (loc: string) => {
      if (!origin) return;
      for (const delay of [150, 400, 900]) {
        timers.current.push(
          setTimeout(() => {
            iframeRef.current?.contentWindow?.postMessage(
              { source: "tau-parent", type: "tau:reselect", loc },
              origin,
            );
          }, delay),
        );
      }
    },
    [origin, iframeRef],
  );

  return { reselect };
}

/**
 * The "Built with tau" badge tau shows in free-plan previews.
 *
 * Clicking it inside the editor asks us to open the upgrade modal, so the path
 * to removing it is the real checkout rather than a link out. And because the
 * sandbox only learns about a plan change on its next provision, a Pro user can
 * still be served a badge until then — so on every load we tell it to go away.
 * Both directions are checked against the sandbox origin, like the visual-edit
 * bridge.
 */
function usePreviewBadge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  previewUrl: string | null,
  isPro: boolean,
) {
  const origin = previewUrl ? new URL(previewUrl).origin : null;

  useEffect(() => {
    if (!origin) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== origin) return;
      const d = e.data as { source?: string; type?: string } | null;
      if (d?.source !== "tau-badge" || d.type !== "tau:upgrade") return;
      useUpgradeModalStore
        .getState()
        .openModal("Upgrade to Pro to remove this badge");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  const hideIfPro = useCallback(() => {
    if (!origin || !isPro) return;
    iframeRef.current?.contentWindow?.postMessage(
      { source: "tau-parent", type: "tau:badge", show: false },
      origin,
    );
  }, [origin, isPro, iframeRef]);

  // An upgrade landing mid-session hides it without a reload.
  useEffect(hideIfPro, [hideIfPro]);

  return hideIfPro;
}

/**
 * Ctrl+Z / Cmd+Z reverts the last visual edit.
 *
 * The stack holds inverse *operations*, not file contents, so an undo runs
 * through the same endpoint and the same guards as the edit it reverses. If the
 * source has moved since (the agent rewrote the file), the server's tag check
 * rejects it: at which point the rest of the stack is stale too, so we drop it
 * rather than let a later undo apply somewhere unintended.
 */
function useVisualUndo(onReselect: (loc: string) => void) {
  const projectId = useProjectStore((s) => s.projectId);
  const visualEdit = useVisualEdit(projectId ?? undefined);
  const popUndo = useProjectStore((s) => s.popVisualUndo);
  const clearUndo = useProjectStore((s) => s.clearVisualUndo);
  const setSelection = useProjectStore((s) => s.setVisualSelection);

  // Read via getState inside the handler so the listener never closes over a
  // stale mutation or a stale stack.
  const pending = visualEdit.isPending;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;

      // Never steal undo from a real text field: the inspector's own text box
      // included; there Ctrl+Z should undo typing.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable)
        return;

      if (pending) return;
      const entry = useProjectStore.getState().visualUndo.at(-1);
      if (!entry) return;

      e.preventDefault();
      popUndo();

      visualEdit.mutate(
        { loc: entry.loc, expectTag: entry.expectTag, op: entry.op },
        {
          onSuccess: (data) => {
            if (!data.applied) {
              toast.error("Couldn't undo that change.");
              return;
            }
            toast.success(`Undid ${entry.label} change`);
            onReselect(entry.loc);

            // The inspector is now showing pre-undo values. Both are known
            // exactly: a text undo restores `op.value`, and the server returns
            // the merged class list: so correct them in place rather than
            // dropping the selection and leaving the iframe highlighting an
            // element the inspector no longer describes.
            const sel = useProjectStore.getState().visualSelection;
            if (!sel || sel.loc !== entry.loc) return;
            setSelection(
              entry.op.kind === "text"
                ? { ...sel, text: entry.op.value }
                : { ...sel, className: data.className ?? sel.className },
            );
          },
          onError: () => {
            clearUndo();
            toast.error("Can't undo: the file has changed since.");
          },
        },
      );
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, popUndo, clearUndo, setSelection, visualEdit, onReselect]);
}

/**
 * Escape leaves selection mode.
 *
 * Two stages, in the order that matches what is on screen: with an element
 * picked it drops the selection, and a second press turns the picker off. Only
 * fires when focus is in the tau page: a keypress inside the preview belongs
 * to the iframe's own runtime, which handles Escape itself: so the visible
 * "Done" button, not this, is what makes the mode reliably escapable.
 */
function useVisualEditEscape(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;

      // Never steal Escape from a text field: the inspector's prompt box uses
      // it to clear the selection, and its own handler has already run.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable)
        return;

      const s = useProjectStore.getState();
      if (!s.visualEditEnabled) return;
      // The build-error modal is on top and owns Escape while it is open.
      if (s.previewError && !s.previewErrorDismissed) return;

      e.preventDefault();
      if (s.visualSelection) s.setVisualSelection(null);
      else s.setVisualEditEnabled(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Where the sandbox keeps the app; its paths mean nothing to the user. */
const SANDBOX_APP_DIR = "/home/user/app/";

/**
 * Which file broke, for the banner's label.
 *
 * Path only, no line. Vite's `.file` line number frequently belongs to its own
 * bundle rather than to the user's source: the overlay in the report that
 * prompted this said `Hero.tsx:3661:23` for an eleven-line file: and a
 * confidently wrong line is worse than none. The agent gets the full message,
 * where the real position is.
 */
function errorLocation(error: PreviewBuildError): string | null {
  const text = `${error.message}\n${error.file ?? ""}`
    .split(SANDBOX_APP_DIR)
    .join("");
  const owned = /((?:src|public|app)\/[\w@./-]+\.\w+)/.exec(text);
  if (owned) return owned[1]!;
  const any = /([\w@./-]+\.(?:[jt]sx?|css|html))/.exec(text);
  return any ? any[1]! : null;
}

/**
 * Sending a build failure to the agent.
 *
 * Shared by the modal and the banner it collapses to, because they are two
 * presentations of one action and the interesting part: what the agent
 * actually receives: must not differ between them.
 *
 * The whole error goes in a block the model reads and the transcript doesn't
 * (`server/src/api/lib/visualContext.ts`), so the chat bubble says "Fix the
 * build error in src/components/Hero.tsx" while the model gets the caret line.
 *
 * `error` is null when the app crashed while starting and Vite had nothing to
 * say about it (`PreviewFailedCard`). Then what goes instead is `crash`: the
 * errors the monitor inside the preview recorded in this browser, on the same
 * terms: a block the model reads, behind one plain sentence in the chat. With
 * neither, tau is asked to find the error itself.
 */
function useFixWithTau(
  error: PreviewBuildError | null,
  crash: PreviewRuntimeError | null = null,
) {
  const projectId = useProjectStore((s) => s.projectId);
  const setChatOpen = useProjectStore((s) => s.setChatOpen);
  const dismiss = useProjectStore((s) => s.setPreviewErrorDismissed);
  const { send, canSend, isSending } = useSendMessage(projectId ?? undefined);

  const where = error ? errorLocation(error) : null;

  const fix = () => {
    if (!canSend) return;
    const sent = error
      ? send(
          where
            ? `Fix the build error in \`${where}\`: the preview isn't compiling.`
            : "Fix the build error: the preview isn't compiling.",
          {
            buildError: {
              message: error.message,
              ...(error.file ? { file: error.file } : {}),
              ...(error.frame ? { frame: error.frame } : {}),
            },
          },
        )
      : send(
          "The app crashes while it starts, so the preview shows nothing. Find the error and fix it.",
          crash ? { runtimeError: crash } : {},
        );
    if (!sent) return;
    setChatOpen(true);
    // Out of the way so the answer is watchable. The error itself is still
    // live, so the banner stays until the fix actually lands.
    if (error) dismiss(true);
  };

  return { fix, where, canSend, isSending };
}

/**
 * "The preview didn't build", as the only thing on screen.
 *
 * What is behind this is Vite's error overlay: a red wall of parse output,
 * absolute sandbox paths and `node_modules` stack frames. It is accurate, and
 * to the person this product is for it is a crash. A modal is the honest shape
 * for it: the app is not running, there is nothing else to do in this pane,
 * and the one useful action should not be a 100px button in a strip that reads
 * like a notification.
 *
 * Scoped to the preview rather than the whole page on purpose: the chat and the
 * code tab still work, and this must not stop someone reading either.
 */
function PreviewErrorModal({ error }: { error: PreviewBuildError }) {
  const dismiss = useProjectStore((s) => s.setPreviewErrorDismissed);
  const { fix, where, canSend, isSending } = useFixWithTau(error);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        role="alertdialog"
        aria-label="Preview build error"
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--silver-200)] bg-[var(--space-surface)] shadow-2xl"
      >
        <div className="flex items-start gap-3 px-4 pt-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <TriangleAlertIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--silver-900)]">
              Your app didn&apos;t build
            </h2>
            <p className="pt-0.5 text-xs text-[var(--silver-600)]">
              {where ? (
                <>
                  Something in{" "}
                  <span className="font-mono text-[var(--silver-900)]">
                    {where}
                  </span>{" "}
                  stops it compiling, so the preview can&apos;t run.
                </>
              ) : (
                "Something stops it compiling, so the preview can't run."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(true)}
            title="Dismiss"
            className="shrink-0 rounded-[var(--radius-md)] p-1 text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Verbatim and scrollable. It is not what most people here will read,
            but hiding it entirely would make this the one screen in the product
            that knows something and won't say what. */}
        <pre className="mx-4 mt-3 min-h-0 flex-1 overflow-auto rounded-[var(--radius-md)] border border-[var(--silver-200)] bg-[var(--space-void)] px-3 py-2 font-mono text-[10px] leading-relaxed whitespace-pre text-[var(--silver-600)]">
          {error.message}
          {error.frame ? `\n\n${error.frame}` : ""}
        </pre>

        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-[11px] text-[var(--silver-600)]">
            tau gets the full error, not just this summary.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => dismiss(true)}
              className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs font-medium text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={fix}
              disabled={!canSend}
              title={
                canSend
                  ? "Send this error to tau"
                  : "tau is already working on something"
              }
              className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-brand px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:hover:bg-brand"
            >
              {isSending ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <WrenchIcon className="size-3.5" />
              )}
              Fix with tau
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * What the modal collapses to.
 *
 * Dismissing must not mean "and now there is no way to fix it": the app is
 * still broken, and the button that repairs it has to stay somewhere. Clicking
 * the strip reopens the full dialog.
 */
function PreviewErrorBanner({ error }: { error: PreviewBuildError }) {
  const dismiss = useProjectStore((s) => s.setPreviewErrorDismissed);
  const { fix, where, canSend, isSending } = useFixWithTau(error);

  return (
    <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-red-500/40 bg-[var(--space-surface)]/95 py-1 pl-3 pr-1 text-xs shadow-lg backdrop-blur">
      <TriangleAlertIcon className="size-3.5 shrink-0 text-red-500" />
      <button
        type="button"
        onClick={() => dismiss(false)}
        title="Show the error"
        className="min-w-0 truncate text-[var(--silver-900)] hover:underline"
      >
        Didn&apos;t build
        {where && (
          <span className="ml-1 font-mono text-[var(--silver-600)]">
            {where}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={fix}
        disabled={!canSend}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-2.5 py-1 font-medium text-primary-foreground transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:hover:bg-brand"
      >
        {isSending ? (
          <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <WrenchIcon className="size-3.5" />
        )}
        Fix with tau
      </button>
    </div>
  );
}

/**
 * The "you are in selection mode" banner.
 *
 * Selection mode swallows clicks inside the preview, so a user who has
 * forgotten it is on experiences their own app as broken: and until now the
 * only way out was a 28px icon in the toolbar above, lit in a colour that
 * reads as decoration. This says what is happening and offers the way out in
 * the place the user is already looking. The toolbar toggle is unchanged and
 * still turns it off.
 */
function VisualEditBanner() {
  const setEnabled = useProjectStore((s) => s.setVisualEditEnabled);

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--blue-500)]/40 bg-[var(--space-surface)]/95 py-1 pl-3 pr-1 text-xs shadow-lg backdrop-blur">
      <SquareMousePointerIcon className="size-3.5 shrink-0 text-[var(--blue-500)]" />
      <span className="text-[var(--silver-900)]">
        Click an element to edit it
      </span>
      <kbd className="hidden rounded border border-[var(--silver-200)] px-1 py-px font-mono text-[10px] text-[var(--silver-600)] sm:inline">
        Esc
      </kbd>
      <button
        type="button"
        onClick={() => setEnabled(false)}
        className="rounded-full bg-[var(--space-overlay)] px-2.5 py-1 font-medium text-[var(--silver-900)] transition-colors hover:bg-[var(--blue-500)] hover:text-white"
      >
        Done
      </button>
    </div>
  );
}

/**
 * Human copy for each reason the server can decline a deterministic edit.
 *
 * The three `dynamic_*` reasons are handled before they get here: each caller
 * turns them into a staged request in the prompt box instead: but the map is
 * exhaustive over `VisualEditRefusal` on purpose, so a new reason has to be
 * given copy rather than silently falling through to `undefined`.
 */
const REFUSAL_COPY: Record<VisualEditRefusal, string> = {
  dynamic_children:
    "This text comes from code: ask tau to change it in the box above.",
  empty_value: "Text can't be empty.",
  multiline_value: "Keep it to a single line.",
  bad_loc: "Couldn't locate this element: try selecting it again.",
  dynamic_classname:
    "This element's styles are set in code: ask tau in the box above.",
  invalid_class: "That style isn't supported.",
  dynamic_attribute:
    "This image's source is set in code: ask tau in the box above.",
  invalid_attr_value: "That isn't a usable image address.",
};

/** Grow a one-line prompt box with its content, up to a few lines. */
function autosize(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
}

/**
 * The primary control: say what you want done to the selected element.
 *
 * This is what a selection is *for*. The deterministic editor below covers
 * text, seven style groups and image swaps; everything else anyone wants to do
 * to an element: "make this a dropdown", "center these cards": only the agent
 * can do, and until now the selection was thrown away before it could help.
 *
 * The box is autofocused on every new selection, so the whole interaction is
 * click, type, Enter. See doc/archive/VISUAL_EDIT_PROMPTING.md §2.
 */
function ElementPrompt({ selection }: { selection: VisualSelection }) {
  const projectId = useProjectStore((s) => s.projectId);
  const setSelection = useProjectStore((s) => s.setVisualSelection);
  const clearUndo = useProjectStore((s) => s.clearVisualUndo);
  const setChatOpen = useProjectStore((s) => s.setChatOpen);
  const isStreaming = useProjectStore((s) => s.status) === "streaming";
  const { send, canSend } = useSendMessage(projectId ?? undefined);

  const [draft, setDraft] = useState("");
  // Which value the deterministic path refused, when this draft came from one.
  // A fact about the element, not part of the request: so it travels in the
  // context rather than in what the user sees.
  const [computed, setComputed] = useState<ComputedValue | undefined>(
    undefined,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A new element was picked: empty box, and the old refusal no longer
  // describes anything.
  const [lastLoc, setLastLoc] = useState(selection.loc);
  if (lastLoc !== selection.loc) {
    setLastLoc(selection.loc);
    setDraft("");
    setComputed(undefined);
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, [selection.loc]);

  // After the value has actually been written, not during the event that
  // changed it: `scrollHeight` before the commit describes the old content.
  useEffect(() => {
    autosize(inputRef.current);
  }, [draft]);

  /**
   * Adopt a request staged by the deterministic editor after it refused one.
   *
   * A store subscription rather than an effect on the value: this is a one-shot
   * handoff between siblings, not state to keep in sync, and doing the write in
   * an external-event callback is what the repo's `set-state-in-effect` rule
   * wants.
   */
  useEffect(
    () =>
      useProjectStore.subscribe((state, prev) => {
        const staged = state.visualPromptPrefill;
        if (!staged || staged === prev.visualPromptPrefill) return;
        setDraft(staged.text);
        setComputed(staged.computed);
        useProjectStore.getState().clearVisualPromptPrefill();
        inputRef.current?.focus();
      }),
    [],
  );

  const submit = () => {
    const request = draft.trim();
    if (!request || !canSend) return;

    // Only the user's own words go in the message. Everything the agent needs
    // to find the element travels beside it, and the API turns that into a
    // block the model reads and the transcript never shows: so the bubble
    // stays the sentence they typed. doc/archive/VISUAL_EDIT_PROMPTING.md §7.
    const sent = send(request, {
      visualContext: {
        loc: selection.loc,
        tagName: selection.tagName,
        ...(selection.className ? { className: selection.className } : {}),
        ...(selection.text ? { text: selection.text } : {}),
        ...(selection.src ? { src: selection.src } : {}),
        ...(selection.siblingCount > 1
          ? { siblingCount: selection.siblingCount }
          : {}),
        ...(computed ? { computed } : {}),
      },
    });
    if (!sent) return;

    setChatOpen(true);
    // The job is about to rewrite this file, so every source position we are
    // holding is about to be stale: this selection and the whole undo stack
    // alike. Same reasoning as the 409 path in VISUAL_EDIT_PLAN.md §6 Phase 4.
    clearUndo();
    setSelection(null);
  };

  return (
    <div className="flex items-end gap-1.5">
      <textarea
        ref={inputRef}
        rows={1}
        value={draft}
        disabled={isStreaming}
        placeholder={
          isStreaming
            ? "tau is working…"
            : `Ask tau to change this ${selection.tagName || "element"}…`
        }
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setSelection(null);
          }
          // The in-iframe runtime listens for Escape too, and Ctrl+Z is the
          // visual-edit undo: neither should fire while this box has focus.
          e.stopPropagation();
        }}
        aria-label="Ask tau about this element"
        className="min-h-7 min-w-0 flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--silver-200)] bg-[var(--space-void)] px-2 py-1.5 text-xs leading-snug text-[var(--silver-900)] outline-none placeholder:text-[var(--silver-600)] focus:border-[var(--blue-500)] disabled:opacity-50"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!draft.trim() || !canSend}
        title="Ask tau"
        className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-brand text-primary-foreground transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:hover:bg-brand"
      >
        <ArrowUpIcon className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * Inline text editor for the selected element.
 *
 * Only rendered when the runtime reported `editableText`, so the box is never
 * offered for content the server would refuse. Enter commits, Escape reverts.
 */
function TextEditor({
  selection,
  onReselect,
}: {
  selection: VisualSelection;
  onReselect: (loc: string) => void;
}) {
  const projectId = useProjectStore((s) => s.projectId);
  const visualEdit = useVisualEdit(projectId ?? undefined);
  const setSelection = useProjectStore((s) => s.setVisualSelection);
  const pushUndo = useProjectStore((s) => s.pushVisualUndo);
  const prefillVisualPrompt = useProjectStore((s) => s.prefillVisualPrompt);

  const [draft, setDraft] = useState(selection.text);

  // A new element was picked: show its text, not the previous one's.
  const [lastLoc, setLastLoc] = useState(selection.loc);
  if (lastLoc !== selection.loc) {
    setLastLoc(selection.loc);
    setDraft(selection.text);
  }

  const dirty = draft !== selection.text;

  const commit = () => {
    if (!dirty || visualEdit.isPending) return;
    visualEdit.mutate(
      {
        loc: selection.loc,
        expectTag: selection.tagName,
        op: { kind: "text", value: draft },
      },
      {
        onSuccess: (data) => {
          if (data.applied) {
            // The sandbox write already happened, so Vite is hot-reloading the
            // preview as this resolves. Keep the selection: the user usually
            // wants another go at the same element.
            setSelection({ ...selection, text: draft });
            pushUndo({
              loc: selection.loc,
              expectTag: selection.tagName,
              op: { kind: "text", value: selection.text },
              label: "text",
            });
            // …and re-highlight it once HMR has swapped the DOM node.
            onReselect(selection.loc);
            return;
          }

          setDraft(selection.text);

          // Not something we can do deterministically: write the request into
          // the prompt box directly above, where the user can edit it and hit
          // Enter, rather than leaving them at a dead end.
          if (data.reason === "dynamic_children") {
            const op = { kind: "text", value: draft } as const;
            prefillVisualPrompt(describeRefusedEdit(op), computedValueFor(op));
            toast("tau can edit this: the request is ready above.", {
              icon: "💬",
            });
            return;
          }
          toast.error(REFUSAL_COPY[data.reason]);
        },
        onError: (err) => {
          const status = err instanceof ApiError ? err.status : 0;
          if (status === 409) {
            toast.error(
              err instanceof ApiError &&
                err.message === "generation in progress"
                ? "Can't edit while tau is building."
                : "This element moved: select it again.",
            );
            setSelection(null);
          } else {
            toast.error("Couldn't apply that change.");
            setDraft(selection.text);
          }
        },
      },
    );
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        value={draft}
        spellCheck={false}
        disabled={visualEdit.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(selection.text);
          }
          // The runtime is listening for Escape too; don't let it also clear
          // the selection out from under an edit in progress.
          e.stopPropagation();
        }}
        onBlur={commit}
        aria-label="Element text"
        className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--silver-200)] bg-[var(--space-void)] px-2 py-1 text-xs text-[var(--silver-900)] outline-none focus:border-[var(--blue-500)] disabled:opacity-50"
      />
      {visualEdit.isPending ? (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--silver-600)] border-t-transparent" />
      ) : (
        dirty && (
          <button
            type="button"
            onClick={commit}
            className="shrink-0 rounded-[var(--radius-md)] bg-brand px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-brand/90"
          >
            Save
          </button>
        )
      )}
    </div>
  );
}

/**
 * The strip under the preview describing the picked element.
 *
 * Ranked deliberately: the prompt box is the primary control and the
 * deterministic editor is behind `✎ Edit`. Most of what people want to do to an
 * element was never in the editor's vocabulary, so offering it first sent them
 * to a dead end for everything except a colour swap.
 *
 * `manualPanelOpen` lives in the store rather than here because it is sticky
 * for the session: someone doing a styling pass clicks it once, not once per
 * element.
 */
function VisualInspector({
  selection,
  onReselect,
}: {
  selection: VisualSelection;
  onReselect: (loc: string) => void;
}) {
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const openFile = useProjectStore((s) => s.openFile);
  const setSelection = useProjectStore((s) => s.setVisualSelection);
  const files = useProjectStore((s) => s.files);
  const manualOpen = useProjectStore((s) => s.manualPanelOpen);
  const setManualOpen = useProjectStore((s) => s.setManualPanelOpen);
  // One panel at a time: both are tall, and stacking them would push the
  // element the user is editing off the top of the preview.
  const [panel, setPanel] = useState<"styles" | "image" | null>(null);
  const isImage = selection.tagName === "img";

  const path = locToPath(selection.loc);
  // The tagger emits paths relative to the app root, which is the same key
  // space the file manifest uses: but a file the agent has not persisted yet
  // won't be there, and opening a tab for it would render an empty editor.
  const known = Boolean(files[path]);

  return (
    <div className="absolute inset-x-0 bottom-0 bg-[var(--space-surface)]">
      {/* One source line, many rendered nodes: say so plainly rather than
          letting the user discover it by changing six cards at once. */}
      {selection.siblingCount > 1 && (
        <div className="flex items-center gap-1.5 border-t border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600">
          <LayersIcon className="size-3 shrink-0" />
          This element is rendered {selection.siblingCount} times from one place
          in the code: a change here applies to all {selection.siblingCount}.
        </div>
      )}

      {manualOpen && (
        <>
          {panel === "styles" && (
            <VisualStylePanel selection={selection} onReselect={onReselect} />
          )}
          {panel === "image" && (
            <VisualImagePanel selection={selection} onReselect={onReselect} />
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--silver-200)] px-3 py-1.5 text-xs">
            <span
              className="shrink-0 text-[11px] text-[var(--silver-600)]"
              title="Changed instantly, with no credits used"
            >
              Edit directly · free
            </span>

            {selection.editableText ? (
              <TextEditor selection={selection} onReselect={onReselect} />
            ) : (
              selection.className && (
                <span
                  className="max-w-[40%] truncate font-mono text-[var(--silver-600)]"
                  title={selection.className}
                >
                  {selection.className}
                </span>
              )
            )}

            <div className="ml-auto flex items-center gap-1">
              {isImage && (
                <button
                  type="button"
                  onClick={() =>
                    setPanel((p) => (p === "image" ? null : "image"))
                  }
                  aria-pressed={panel === "image"}
                  title="Replace this image"
                  className={cn(
                    "flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 font-medium transition-colors hover:bg-[var(--space-overlay)]",
                    panel === "image"
                      ? "text-[var(--blue-500)]"
                      : "text-[var(--silver-900)]",
                  )}
                >
                  <ImageIcon className="size-3.5" />
                  Image
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setPanel((p) => (p === "styles" ? null : "styles"))
                }
                aria-pressed={panel === "styles"}
                title="Style this element"
                className={cn(
                  "flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 font-medium transition-colors hover:bg-[var(--space-overlay)]",
                  panel === "styles"
                    ? "text-[var(--blue-500)]"
                    : "text-[var(--silver-900)]",
                )}
              >
                <PaletteIcon className="size-3.5" />
                Style
              </button>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5 border-t border-[var(--silver-200)] px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono font-semibold text-[var(--silver-900)]">
            &lt;{selection.tagName}&gt;
          </span>

          <span className="font-mono text-[var(--silver-600)]">
            {selection.loc}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setManualOpen(!manualOpen)}
              aria-pressed={manualOpen}
              title="Edit this element yourself: free and instant"
              className={cn(
                "flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 font-medium transition-colors hover:bg-[var(--space-overlay)]",
                manualOpen
                  ? "text-[var(--blue-500)]"
                  : "text-[var(--silver-900)]",
              )}
            >
              <PencilIcon className="size-3.5" />
              Edit
            </button>
            <button
              type="button"
              disabled={!known}
              onClick={() => {
                openFile(path);
                setActiveTab("code");
              }}
              title={
                known ? `Open ${path}` : `${path} isn't in the file tree yet`
              }
              className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 font-medium text-[var(--silver-900)] transition-colors hover:bg-[var(--space-overlay)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <CodeIcon className="size-3.5" />
              Open in code
            </button>
            <button
              type="button"
              onClick={() => setSelection(null)}
              title="Clear selection"
              className="rounded-[var(--radius-md)] p-1 text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        </div>

        <ElementPrompt selection={selection} />
      </div>
    </div>
  );
}

export function PreviewPane({
  device,
  active = true,
}: {
  device: string;
  active?: boolean;
}) {
  const navigate = useNavigate();
  const previewUrl = useProjectStore((s) => s.previewUrl);
  const previewImageUrl = useProjectStore((s) => s.previewImageUrl);
  const previewPath = useProjectStore((s) => s.previewPath);
  const previewNonce = useProjectStore((s) => s.previewNonce);
  const previewHealthExpected = useProjectStore((s) => s.previewHealthExpected);
  const previewRestoring = useProjectStore((s) => s.previewRestoring);
  const previewRestoreFailed = useProjectStore((s) => s.previewRestoreFailed);
  const reloadPreview = useProjectStore((s) => s.reloadPreview);
  const projectId = useProjectStore((s) => s.projectId);
  const status = useProjectStore((s) => s.status);
  const hydrated = useProjectStore((s) => s.hydrated);
  const activity = useProjectStore((s) => s.activity);
  const isStalled = useProjectStore((s) => s.isStalled);
  const pendingQuestion = useProjectStore((s) => s.pendingQuestion);
  const messages = useProjectStore((s) => s.chatMessages);
  const cancelStream = useProjectStore((s) => s.cancelStream);
  const startPreviewJob = useProjectStore((s) => s.startPreviewJob);
  const { data: balance } = useBalance();
  const { send } = useSendMessage(projectId ?? undefined);

  const visualSelection = useProjectStore((s) => s.visualSelection);
  const visualEditEnabled = useProjectStore((s) => s.visualEditEnabled);
  const previewError = useProjectStore((s) => s.previewError);
  const previewErrorDismissed = useProjectStore((s) => s.previewErrorDismissed);
  const themePanelOpen = useProjectStore((s) => s.themePanelOpen);
  const setThemePanelOpen = useProjectStore((s) => s.setThemePanelOpen);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { reselect } = useVisualEditBridge(iframeRef, previewUrl, previewNonce);
  const hideBadgeIfPro = usePreviewBadge(
    iframeRef,
    previewUrl,
    balance?.plan === "PRO",
  );
  useVisualUndo(reselect);
  useVisualEditEscape();

  const isStreaming = status === "streaming";
  const restart = useRestartPreview(projectId ?? "");
  const starting = restart.isPending;

  // Validate persisted URLs even if a chat starts before the first check.
  // The pane stays mounted behind the Code tab to preserve its loaded iframe,
  // but hidden previews should not create background liveness traffic.
  const liveness = usePreviewStatus(projectId ?? undefined, {
    previewUrl,
    enabled: active && Boolean(previewUrl) && !previewRestoring && !starting,
  });
  const surface = resolvePreviewSurface({
    hasUrl: Boolean(previewUrl), alive: liveness.data?.alive,
    streaming: isStreaming, restoring: previewRestoring,
    restoreFailed: previewRestoreFailed, starting, checkFailed: liveness.isError,
  });

  const src = previewSrc(previewUrl, previewPath);
  const frameKey = src ? `${src}-${previewNonce}` : null;
  const recovery = usePreviewRecovery(iframeRef, surface === "frame" ? src : null, surface === "frame" ? frameKey : null, previewHealthExpected);
  // A frame that never came up. When Vite reported why, tau is sent that; when
  // the app compiled and then crashed, what this browser saw of the crash;
  // with neither, it is asked to find the error.
  const startupFix = useFixWithTau(previewError, recovery.runtimeError);
  const previewLoaded = frameKey !== null && recovery.phase === "loaded";
  const emptyInput: EmptyPreviewInput = {
    status,
    hydrated,
    activity,
    isStalled,
    waitingForAnswer: pendingQuestion !== null,
    interruptedForCredits: wasInterruptedForCredits(messages),
    availableCredits: balance?.credits.available,
  };
  const emptyState = getEmptyPreviewState(emptyInput);
  const [gamesOpen, setGamesOpen] = useState(false);

  const handleEmptyAction = (action: EmptyPreviewAction) => {
    if (action === "add_credits") {
      void navigate(APP_BILLING);
    } else if (action === "continue") {
      void send(CREDIT_RESUME_PROMPT);
    } else {
      cancelStream?.();
    }
  };

  const handleStart = () => {
    if (!projectId || starting) return;
    restart.mutate(undefined, {
      onSuccess: ({ jobId }) => {
        startPreviewJob(jobId);
      },
      onError: () =>
        toast.error("Couldn't start the preview. Please try again."),
    });
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-[var(--space-surface)] p-2">
      <motion.div
        animate={{ maxWidth: DEVICE_WIDTH[device] }}
        transition={{ type: "spring", stiffness: 200, damping: 26 }}
        className="relative h-full w-full overflow-hidden rounded-xl border border-[var(--silver-200)] bg-black shadow-xl shadow-black/20"
      >
        {surface !== "frame" && surface !== "empty" ? (
          <PreviewStopped
            mode={surface}
            onStart={handleStart}
            coverImageUrl={previewImageUrl}
          />
        ) : surface === "frame" && src ? (
          <>
            <iframe
              // The nonce is bumped by both reload and any path change, so the
              // frame remounts either way: re-entering the current path still
              // re-navigates instead of being a no-op.
              key={`${previewUrl}-${previewNonce}-${recovery.attempt}`}
              ref={iframeRef}
              src={src}
              title="App preview"
              onLoad={(event) => {
                if (event.currentTarget !== iframeRef.current) return;
                hideBadgeIfPro();
                recovery.onLoad();
              }}
              className={cn(
                "h-full w-full border-0 bg-black transition-opacity duration-200",
                previewLoaded ? "visible opacity-100" : "invisible opacity-0",
              )}
              style={{ colorScheme: "dark", backgroundColor: "black" }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
            {!previewLoaded && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
                {previewImageUrl && (
                  <>
                    <img src={previewImageUrl} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover object-top opacity-45 blur-md" />
                    <div className="absolute inset-0 bg-black/80" />
                  </>
                )}
                {recovery.phase === "failed" && (
                  <div aria-hidden="true" className="rain-streaks" />
                )}
                {recovery.phase === "failed" ? (
                  <PreviewFailedCard
                    appError={recovery.appError}
                    onFix={startupFix.fix}
                    onReload={reloadPreview}
                    canFix={startupFix.canSend}
                    isSending={startupFix.isSending}
                  />
                ) : (
                  <div className="relative"><DataSpinner label={recovery.attempt ? "Reconnecting preview" : "Loading preview"} /></div>
                )}
              </div>
            )}
            {/* One stack, so a dismissed build error and selection mode can
                both be announced without either hiding the other. */}
            {((previewError && previewErrorDismissed) || visualEditEnabled) && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 p-3">
                {previewError && previewErrorDismissed && (
                  <PreviewErrorBanner error={previewError} />
                )}
                {visualEditEnabled && <VisualEditBanner />}
              </div>
            )}
            {previewError && !previewErrorDismissed && (
              <PreviewErrorModal error={previewError} />
            )}
            {/* The theme panel wins the bottom strip: it is global, so it isn't
                describing the selected element and stacking the two would hide
                whichever ended up underneath. */}
            {themePanelOpen ? (
              <VisualThemePanel onClose={() => setThemePanelOpen(false)} />
            ) : (
              visualSelection && (
                <VisualInspector
                  selection={visualSelection}
                  onReselect={reselect}
                />
              )
            )}
          </>
        ) : (
          <PreviewPlaceholder
            state={emptyState}
            onAction={handleEmptyAction}
            onPlay={() => setGamesOpen(true)}
          />
        )}
      </motion.div>
      {/* Out here, not in the placeholder that opens it: it has to outlive the
          placeholder to report that the preview replaced it. */}
      <GamesModal
        open={gamesOpen}
        onOpenChange={setGamesOpen}
        status={getGamesStatus({
          ...emptyInput,
          hasPreview: surface === "frame",
        })}
      />
    </div>
  );
}
