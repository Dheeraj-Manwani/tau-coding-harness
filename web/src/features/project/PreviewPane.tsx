import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowUpIcon,
  CodeIcon,
  ImageIcon,
  LayersIcon,
  PaletteIcon,
  PencilIcon,
  PlayIcon,
  PowerOffIcon,
  SquareMousePointerIcon,
  XIcon,
} from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import BorderGlow from "@/src/components/ui/glow-loader";
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
import { ApiError } from "@/src/lib/api-client";

const DEVICE_WIDTH: Record<string, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 9999,
};

function PreviewPlaceholder({ label }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center p-0">
      <BorderGlow
        autoAnimate
        autoAnimateDuration={3200}
        coneSpread={8}
        borderRadius={20}
        backgroundColor="var(--space-surface)"
        glowColor="253 91 85"
        colors={["#8b7bff", "#f472b6", "#38bdf8"]}
        glowRadius={32}
        glowIntensity={0.9}
        fillOpacity={0.3}
        className=" px-8 mx-0 py-5"
      >
        <div className="flex flex-col items-center gap-3">
          <span className="logo-mark size-12" role="img" aria-label="tau" />

          <div className="flex flex-col items-center  text-center">
            <span className="text-sm font-semibold text-(--silver-900)">
              {label ?? "tau is building your app…"}
            </span>
          </div>
        </div>
      </BorderGlow>
    </div>
  );
}

/** Shown when the live sandbox has gone down — lets the user reboot it from the
 *  persisted project files without spending a chat turn. While the restart is
 *  in flight the button itself shows the progress (no full-pane shimmer). */
function PreviewStopped({
  starting,
  onStart,
}: {
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-full bg-[var(--space-overlay)] text-[var(--silver-600)]">
        <PowerOffIcon className="size-4.5" />
      </span>
      <span className="text-xs text-[var(--silver-600)]">Preview stopped</span>
      <button
        type="button"
        disabled={starting}
        onClick={onStart}
        className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-brand px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-brand/90 active:scale-95 disabled:cursor-default disabled:hover:bg-brand"
      >
        {starting ? (
          <>
            <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Starting…
          </>
        ) : (
          <>
            <PlayIcon className="size-3.5" />
            Start preview
          </>
        )}
      </button>
    </div>
  );
}

/**
 * The bridge to the visual-edit runtime inside the preview.
 *
 * The preview is served from `https://5173-<sandboxId>.e2b.app`, a different
 * origin from this app, so there is no DOM access — postMessage is the whole
 * channel. Every inbound frame is checked against the sandbox origin before it
 * is trusted: without that, any page could post a fake selection carrying an
 * arbitrary file path and we would happily open it.
 *
 * See doc/VISUAL_EDIT_PLAN.md §4.
 */
function useVisualEditBridge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  previewUrl: string | null,
  previewNonce: number,
) {
  const enabled = useProjectStore((s) => s.visualEditEnabled);
  const setReady = useProjectStore((s) => s.setVisualEditReady);
  const setSelection = useProjectStore((s) => s.setVisualSelection);

  const origin = previewUrl ? new URL(previewUrl).origin : null;

  useEffect(() => {
    if (!origin) return;

    function onMessage(e: MessageEvent) {
      if (e.origin !== origin) return;
      const d = e.data as Partial<VisualSelection> & {
        source?: string;
        type?: string;
      };
      if (!d || d.source !== "tau-visual-edit") return;

      if (d.type === "tau:ready") setReady(true);
      else if (d.type === "tau:deselect") setSelection(null);
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
  }, [origin, setReady, setSelection]);

  // A remount gives us a brand-new runtime that has never heard of us, so the
  // old `ready` is meaningless. `previewNonce` is what remounts the iframe.
  useEffect(() => {
    setReady(false);
  }, [previewUrl, previewNonce, setReady]);

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
   * the DOM node — taking the highlight with it. The element's source position
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
 * Ctrl+Z / Cmd+Z reverts the last visual edit.
 *
 * The stack holds inverse *operations*, not file contents, so an undo runs
 * through the same endpoint and the same guards as the edit it reverses. If the
 * source has moved since (the agent rewrote the file), the server's tag check
 * rejects it — at which point the rest of the stack is stale too, so we drop it
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

      // Never steal undo from a real text field — the inspector's own text box
      // included; there Ctrl+Z should undo typing.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;

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
            // exactly — a text undo restores `op.value`, and the server returns
            // the merged class list — so correct them in place rather than
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
            toast.error("Can't undo — the file has changed since.");
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
 * fires when focus is in the tau page — a keypress inside the preview belongs
 * to the iframe's own runtime, which handles Escape itself — so the visible
 * "Done" button, not this, is what makes the mode reliably escapable.
 */
function useVisualEditEscape(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;

      // Never steal Escape from a text field — the inspector's prompt box uses
      // it to clear the selection, and its own handler has already run.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;

      const s = useProjectStore.getState();
      if (!s.visualEditEnabled) return;

      e.preventDefault();
      if (s.visualSelection) s.setVisualSelection(null);
      else s.setVisualEditEnabled(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * The "you are in selection mode" banner.
 *
 * Selection mode swallows clicks inside the preview, so a user who has
 * forgotten it is on experiences their own app as broken — and until now the
 * only way out was a 28px icon in the toolbar above, lit in a colour that
 * reads as decoration. This says what is happening and offers the way out in
 * the place the user is already looking. The toolbar toggle is unchanged and
 * still turns it off.
 */
function VisualEditBanner() {
  const setEnabled = useProjectStore((s) => s.setVisualEditEnabled);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
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
    </div>
  );
}

/**
 * Human copy for each reason the server can decline a deterministic edit.
 *
 * The three `dynamic_*` reasons are handled before they get here — each caller
 * turns them into a staged request in the prompt box instead — but the map is
 * exhaustive over `VisualEditRefusal` on purpose, so a new reason has to be
 * given copy rather than silently falling through to `undefined`.
 */
const REFUSAL_COPY: Record<VisualEditRefusal, string> = {
  dynamic_children:
    "This text comes from code — ask tau to change it in the box above.",
  empty_value: "Text can't be empty.",
  multiline_value: "Keep it to a single line.",
  bad_loc: "Couldn't locate this element — try selecting it again.",
  dynamic_classname:
    "This element's styles are set in code — ask tau in the box above.",
  invalid_class: "That style isn't supported.",
  dynamic_attribute:
    "This image's source is set in code — ask tau in the box above.",
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
 * to an element — "make this a dropdown", "center these cards" — only the agent
 * can do, and until now the selection was thrown away before it could help.
 *
 * The box is autofocused on every new selection, so the whole interaction is
 * click, type, Enter. See doc/VISUAL_EDIT_PROMPTING.md §2.
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
  // A fact about the element, not part of the request — so it travels in the
  // context rather than in what the user sees.
  const [computed, setComputed] = useState<ComputedValue | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A new element was picked — empty box, and the old refusal no longer
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
  // changed it — `scrollHeight` before the commit describes the old content.
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
    // block the model reads and the transcript never shows — so the bubble
    // stays the sentence they typed. doc/VISUAL_EDIT_PROMPTING.md §7.
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
    // holding is about to be stale — this selection and the whole undo stack
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
          // visual-edit undo — neither should fire while this box has focus.
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

  // A new element was picked — show its text, not the previous one's.
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

          // Not something we can do deterministically — write the request into
          // the prompt box directly above, where the user can edit it and hit
          // Enter, rather than leaving them at a dead end.
          if (data.reason === "dynamic_children") {
            const op = { kind: "text", value: draft } as const;
            prefillVisualPrompt(
              describeRefusedEdit(op),
              computedValueFor(op),
            );
            toast("tau can edit this — the request is ready above.", {
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
              err instanceof ApiError && err.message === "generation in progress"
                ? "Can't edit while tau is building."
                : "This element moved — select it again.",
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
 * for the session — someone doing a styling pass clicks it once, not once per
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
  // space the file manifest uses — but a file the agent has not persisted yet
  // won't be there, and opening a tab for it would render an empty editor.
  const known = Boolean(files[path]);

  return (
    <div className="absolute inset-x-0 bottom-0 bg-[var(--space-surface)]">
      {/* One source line, many rendered nodes — say so plainly rather than
          letting the user discover it by changing six cards at once. */}
      {selection.siblingCount > 1 && (
        <div className="flex items-center gap-1.5 border-t border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600">
          <LayersIcon className="size-3 shrink-0" />
          This element is rendered {selection.siblingCount} times from one place
          in the code — a change here applies to all {selection.siblingCount}.
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
              title="Applied straight to the source — no model call, no credits"
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
              title="Edit this element yourself — free and instant"
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

export function PreviewPane({ device }: { device: string }) {
  const previewUrl = useProjectStore((s) => s.previewUrl);
  const previewPath = useProjectStore((s) => s.previewPath);
  const previewNonce = useProjectStore((s) => s.previewNonce);
  const projectId = useProjectStore((s) => s.projectId);
  const status = useProjectStore((s) => s.status);
  const currentJobId = useProjectStore((s) => s.currentJobId);
  const startPreviewJob = useProjectStore((s) => s.startPreviewJob);

  const visualSelection = useProjectStore((s) => s.visualSelection);
  const visualEditEnabled = useProjectStore((s) => s.visualEditEnabled);
  const themePanelOpen = useProjectStore((s) => s.themePanelOpen);
  const setThemePanelOpen = useProjectStore((s) => s.setThemePanelOpen);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { reselect } = useVisualEditBridge(iframeRef, previewUrl, previewNonce);
  useVisualUndo(reselect);
  useVisualEditEscape();

  const isStreaming = status === "streaming";
  const restart = useRestartPreview(projectId ?? "");
  // Id of the restart job we launched; used to keep the "Starting…" state up
  // for the whole life of that job (it clears itself when currentJobId resets
  // to null on the terminal frame), without a setState-in-effect.
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);

  // Covers the click→dispatch gap and the whole streamed restart job.
  const starting =
    restart.isPending ||
    (previewJobId !== null && currentJobId === previewJobId);

  // Only probe liveness while a preview exists and nothing is actively
  // streaming (a running job means the sandbox is being managed already).
  const liveness = usePreviewStatus(projectId ?? undefined, {
    enabled: Boolean(previewUrl) && !isStreaming && !starting,
  });

  const isDown =
    Boolean(previewUrl) && !isStreaming && liveness.data?.alive === false;

  const src = previewSrc(previewUrl, previewPath);

  const handleStart = () => {
    if (!projectId || starting) return;
    restart.mutate(undefined, {
      onSuccess: ({ jobId }) => {
        setPreviewJobId(jobId);
        startPreviewJob(jobId);
      },
      onError: () => toast.error("Couldn't start the preview. Please try again."),
    });
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <motion.div
        animate={{ maxWidth: DEVICE_WIDTH[device] }}
        transition={{ type: "spring", stiffness: 200, damping: 26 }}
        className="relative h-full w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--silver-200)]"
        style={{ backgroundColor: "var(--space-void)" }}
      >
        {starting || isDown ? (
          <PreviewStopped starting={starting} onStart={handleStart} />
        ) : src ? (
          <>
            <iframe
              // The nonce is bumped by both reload and any path change, so the
              // frame remounts either way — re-entering the current path still
              // re-navigates instead of being a no-op.
              key={`${previewUrl}-${previewNonce}`}
              ref={iframeRef}
              src={src}
              title="App preview"
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
            {visualEditEnabled && <VisualEditBanner />}
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
          <PreviewPlaceholder />
        )}
      </motion.div>
    </div>
  );
}
