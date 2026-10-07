import { useState } from "react";
import { PaletteIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { cn } from "@/src/lib/utils";
import {
  countChoices,
  useDesignCatalog,
  type DesignConfig,
} from "@/src/features/design/api";
import { DesignPicker } from "@/src/features/design/DesignPicker";

/**
 * The composer's control for an app's look: a button that says what has been
 * chosen, and a dialog to choose it in.
 *
 * Sits beside the effort toggle and is sized like it. Nothing chosen reads
 * "Auto", which is the default and the recommended one — the button exists so
 * that someone who cares can say so, not so that everyone has to answer a
 * design question before they can build.
 *
 * Renders nothing where the server builds new projects on the older templates
 * (`catalog.enabled`): a choice there would be stored and ignored.
 */
export function DesignButton({
  value,
  onChange,
  disabled = false,
}: {
  value: DesignConfig;
  onChange: (next: DesignConfig) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const catalog = useDesignCatalog();

  if (!catalog.data?.enabled) return null;

  const chosen = countChoices(value);
  const style = catalog.data.styles.find((s) => s.key === value.style);
  const label = value.designMd
    ? "Your design"
    : (style?.name ?? (chosen > 0 ? "Custom" : "Auto"));

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`Choose how the app looks. Currently: ${label}`}
        data-tour="design"
        className={cn(
          "flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          chosen > 0
            ? "border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25"
            : "border-silver-400/30 text-silver-600 hover:bg-space-overlay hover:text-silver-900",
        )}
      >
        {value.accent ? (
          <span
            className="size-3 shrink-0 rounded-full border border-black/20"
            style={{ backgroundColor: value.accent }}
          />
        ) : (
          <PaletteIcon className="size-3.5 shrink-0" />
        )}
        <span className="text-silver-600">Style</span>
        <span className="max-w-28 truncate">{label}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-5 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>How should it look?</DialogTitle>
            <DialogDescription>
              All of this is optional. Whatever you leave on Auto, tau decides
              from what you ask it to build.
            </DialogDescription>
          </DialogHeader>

          {catalog.data ? (
            <DesignPicker catalog={catalog.data} value={value} onChange={onChange} />
          ) : (
            <DataSpinner label="Loading styles" />
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={chosen === 0}
              onClick={() => onChange({})}
            >
              Reset to auto
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
