import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { ApiError } from "@/src/lib/api-client";
import { useVisualEdit } from "@/src/features/project/api";
import { buildFallbackPrompt } from "@/src/features/project/visualEditPrompt";
import {
  STYLE_GROUPS,
  activeOption,
  type StyleGroup,
  type StyleOption,
} from "@/src/features/project/visualStyleVocabulary";
import {
  useProjectStore,
  type VisualSelection,
} from "@/src/stores/useProjectStore";

/**
 * Style controls for the selected element.
 *
 * Every click is one request and one commit — there is no drag state to
 * coalesce, because the vocabulary is stepped rather than continuous. That
 * keeps "one save per change" true without a debounce.
 *
 * The selection's `className` is updated optimistically from the server's own
 * merge rules being predictable: clicking an option adds its class, and the
 * server drops whatever conflicts. If the request fails we restore.
 */
export function VisualStylePanel({
  selection,
  onReselect,
}: {
  selection: VisualSelection;
  onReselect: (loc: string) => void;
}) {
  const projectId = useProjectStore((s) => s.projectId);
  const setSelection = useProjectStore((s) => s.setVisualSelection);
  const pushUndo = useProjectStore((s) => s.pushVisualUndo);
  const prefillComposer = useProjectStore((s) => s.prefillComposer);
  const visualEdit = useVisualEdit(projectId ?? undefined);

  const apply = (group: StyleGroup, option: StyleOption) => {
    if (visualEdit.isPending) return;

    const current = activeOption(group, selection.className);
    const isActive = current?.className === option.className;

    // Clicking the active option turns it off rather than re-applying it.
    const add = isActive ? [] : [option.className];
    const remove = isActive
      ? [option.className]
      : current
        ? [current.className]
        : [];

    visualEdit.mutate(
      {
        loc: selection.loc,
        expectTag: selection.tagName,
        op: { kind: "classes", add, remove },
      },
      {
        onSuccess: (data) => {
          if (!data.applied) {
            if (data.reason === "dynamic_classname") {
              // `cn(...)` or a template literal — there's no literal to edit,
              // so hand it to the agent with the intent already written out.
              prefillComposer(
                buildFallbackPrompt(selection, { kind: "classes", add, remove }),
              );
              toast("tau can do this — the message is ready in the chat.", {
                icon: "💬",
              });
            } else {
              toast.error("Couldn't apply that style.");
            }
            return;
          }

          const before = selection.className;
          // Use the server's merged list rather than guessing: adding `p-6` to
          // `px-4 py-2` drops both, and only tailwind-merge knows that.
          const after = data.className ?? before;
          setSelection({ ...selection, className: after });

          // Diff the two authoritative class lists to build the inverse. Doing
          // it this way (rather than inverting add/remove) also restores classes
          // that tailwind-merge dropped implicitly — `px-4 py-2` losing to `p-6`.
          const beforeSet = new Set(before.split(/\s+/).filter(Boolean));
          const afterSet = new Set(after.split(/\s+/).filter(Boolean));
          const undoAdd = [...beforeSet].filter((c) => !afterSet.has(c));
          const undoRemove = [...afterSet].filter((c) => !beforeSet.has(c));
          if (undoAdd.length || undoRemove.length) {
            pushUndo({
              loc: selection.loc,
              expectTag: selection.tagName,
              op: { kind: "classes", add: undoAdd, remove: undoRemove },
              label: group.label.toLowerCase(),
            });
          }

          onReselect(selection.loc);
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
            toast.error("Couldn't apply that style.");
          }
        },
      },
    );
  };

  return (
    <div
      className={cn(
        "max-h-64 overflow-y-auto border-t border-[var(--silver-200)] bg-[var(--space-surface)] px-3 py-2",
        visualEdit.isPending && "opacity-60",
      )}
    >
      {STYLE_GROUPS.map((group) => {
        const current = activeOption(group, selection.className);
        return (
          <div key={group.id} className="flex items-start gap-2 py-1">
            <span className="w-20 shrink-0 pt-1 text-[11px] text-[var(--silver-600)]">
              {group.label}
            </span>
            <div className="flex flex-wrap gap-1">
              {group.options.map((option) => {
                const isActive = current?.className === option.className;
                return (
                  <button
                    key={option.className}
                    type="button"
                    disabled={visualEdit.isPending}
                    onClick={() => apply(group, option)}
                    title={option.className}
                    aria-pressed={isActive}
                    className={cn(
                      "flex items-center gap-1 rounded-[var(--radius-md)] border px-1.5 py-0.5 text-[11px] transition-colors disabled:cursor-default",
                      isActive
                        ? "border-[var(--blue-500)] text-[var(--silver-900)]"
                        : "border-[var(--silver-200)] text-[var(--silver-600)] hover:text-[var(--silver-900)]",
                    )}
                  >
                    {group.swatches && (
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-[2px] border border-[var(--silver-200)]"
                        // Theme tokens resolve inside the generated app, not
                        // here, so only literal colours get a real swatch.
                        style={
                          option.swatch
                            ? { backgroundColor: option.swatch }
                            : undefined
                        }
                      />
                    )}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
