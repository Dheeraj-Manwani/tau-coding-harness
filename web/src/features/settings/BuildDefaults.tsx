import { useState } from "react";
import { PaletteIcon, ScrollTextIcon } from "lucide-react";
import toast from "react-hot-toast";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import {
  describeChoice,
  sameDesign,
  useDesignCatalog,
  withoutImport,
  type DesignConfig,
} from "@/src/features/design/api";
import { DesignPicker } from "@/src/features/design/DesignPicker";
import { useSettings } from "@/src/hooks/useSettings";
import { InstructionConflicts } from "@/src/features/settings/instructionConflicts";
import { useCheckInstructions } from "@/src/features/settings/instructionCheck";

/** Mirrors `MAX_USER_INSTRUCTIONS_CHARS` on the server. */
const MAX_INSTRUCTIONS = 2_000;

const CARD = "rounded-xl border border-border bg-muted/30 p-4";
const SMALL_BUTTON =
  "rounded-md border border-silver-400/30 px-2.5 py-1.5 text-xs font-medium text-silver-700 transition-colors hover:border-silver-400/60 hover:text-silver-900 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * What the user wants in everything they build, said once.
 *
 * Saved with a button, not as they type: tau reads these on every request, and
 * half a sentence is an instruction too.
 */
export function StandingInstructionsCard() {
  const { instructions, setInstructions } = useSettings();
  const [draft, setDraft] = useState(instructions);
  const changed = draft.trim() !== instructions;
  // What the check said about the text as last saved; gone as soon as it is edited.
  const check = useCheckInstructions();
  const conflicts = changed ? undefined : check.data;

  return (
    <div className={`${CARD} space-y-2.5`}>
      <label htmlFor="standing-instructions" className="flex gap-2.5">
        <ScrollTextIcon className="mt-0.5 size-4 shrink-0 text-silver-600" />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-silver-900">
            Instructions for tau
          </span>
          <span className="text-xs text-silver-600">
            What tau should keep in mind in everything you build, so you
            don&rsquo;t have to repeat it. A project can add its own under
            Edit project.
          </span>
        </span>
      </label>

      <textarea
        id="standing-instructions"
        value={draft}
        maxLength={MAX_INSTRUCTIONS}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={"e.g. Write interface copy in British English.\nI'm colour-blind: never rely on red and green alone."}
        rows={4}
        className="scrollbar-thin w-full resize-y rounded-lg border border-input bg-background p-3 text-sm outline-none transition-shadow focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/25"
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-silver-600">
          {draft.length > MAX_INSTRUCTIONS * 0.8
            ? `${draft.length.toLocaleString()} / ${MAX_INSTRUCTIONS.toLocaleString()}`
            : instructions && !changed
              ? "Saved. tau reads these with every request."
              : ""}
        </span>
        <span className="flex shrink-0 gap-1.5">
          {changed && (
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() => setDraft(instructions)}
            >
              Discard
            </button>
          )}
          <button
            type="button"
            disabled={!changed}
            className={SMALL_BUTTON}
            onClick={() => {
              setInstructions(draft);
              setDraft(draft.trim());
              if (draft.trim()) check.mutate({ account: draft.trim() });
              else check.reset();
              toast.success(
                draft.trim() ? "Instructions saved" : "Instructions cleared",
              );
            }}
          >
            Save
          </button>
        </span>
      </div>
      <InstructionConflicts conflicts={conflicts} />
    </div>
  );
}

/**
 * The look new projects start from. Chosen with the same picker the composer
 * uses, minus the DESIGN.md import: a design file is written for one app.
 *
 * Renders nothing where the server builds on the older templates, which have
 * no design step.
 */
export function DefaultLookCard() {
  const { defaultDesign, setDefaultDesign } = useSettings();
  const catalog = useDesignCatalog();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DesignConfig>({});

  if (!catalog.data?.enabled) return null;

  const parts = defaultDesign ? describeChoice(defaultDesign, catalog.data) : [];
  const keepable = withoutImport(draft);

  return (
    <>
      <div
        className={`${CARD} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}
      >
        <span className="flex gap-2.5">
          <PaletteIcon className="mt-0.5 size-4 shrink-0 text-silver-600" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-silver-900">
              Default look
            </span>
            {defaultDesign ? (
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-silver-600">
                {defaultDesign.accent && (
                  <span
                    className="size-3 shrink-0 rounded-full border border-black/20"
                    style={{ backgroundColor: defaultDesign.accent }}
                    title={defaultDesign.accent}
                  />
                )}
                {parts.length > 0 ? parts.join(" · ") : defaultDesign.accent}
              </span>
            ) : (
              <span className="text-xs text-silver-600">
                tau picks a look that suits each thing you build. Choose one
                here to start every new project from it instead.
              </span>
            )}
          </span>
        </span>

        <span className="flex shrink-0 gap-1.5">
          {defaultDesign && (
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() => {
                setDefaultDesign(null);
                toast.success("tau will pick the look for new projects");
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className={SMALL_BUTTON}
            onClick={() => {
              setDraft(defaultDesign ?? {});
              setOpen(true);
            }}
          >
            {defaultDesign ? "Change" : "Choose"}
          </button>
        </span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-5 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Your default look</DialogTitle>
            <DialogDescription>
              New projects start from this. Whatever you leave on Auto, tau
              still decides, and you can choose differently for any one project
              when you start it.
            </DialogDescription>
          </DialogHeader>

          <DesignPicker
            catalog={catalog.data}
            value={draft}
            onChange={setDraft}
            allowImport={false}
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={sameDesign(draft, defaultDesign)}
              onClick={() => {
                setDefaultDesign(keepable);
                setOpen(false);
                toast.success(
                  keepable
                    ? "New projects will start from this look"
                    : "tau will pick the look for new projects",
                );
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
