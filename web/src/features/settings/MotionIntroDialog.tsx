import { useState } from "react";
import { Checkbox } from "radix-ui";
import { CheckIcon } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { useSettings } from "@/src/hooks/useSettings";

/**
 * One-time "reduce motion" offer on a user's first visit.
 *
 * A centred dialog rather than a popover on the avatar: the avatar sits in a
 * different header on every page, so an anchored card landed somewhere new
 * each time. Mounted once in AppShell; the project tours wait for it to be
 * dismissed so the two never stack.
 */
export function MotionIntroDialog() {
  const { hasSeenMotionIntro, markMotionIntroSeen } = useSettings();
  const [reduce, setReduce] = useState(false);

  return (
    <Dialog
      open={!hasSeenMotionIntro}
      onOpenChange={(open) => {
        // Any close (Continue, Esc, clicking outside) counts as "seen". One
        // write for both flags, so the choice can't be lost while the intro is
        // marked seen.
        if (!open) markMotionIntroSeen(reduce ? { reduceMotion: true } : undefined);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Make Tau comfortable for you</DialogTitle>
          <DialogDescription>
            Tau uses animated effects. If they bother you, or you just prefer a
            calmer interface, you can turn them off. Change this anytime in
            Settings.
          </DialogDescription>
        </DialogHeader>

        <label
          htmlFor="motion-intro-reduce"
          className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-silver-400/25 bg-space-surface p-3"
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-silver-900">
              Reduce motion
            </span>
            <span className="text-xs text-silver-600">
              Turn off effects like the lightning border and glitch stars.
            </span>
          </span>
          <Checkbox.Root
            id="motion-intro-reduce"
            checked={reduce}
            onCheckedChange={(v) => setReduce(v === true)}
            className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-silver-400/60 bg-space-overlay outline-none focus-visible:ring-2 focus-visible:ring-brand/60 data-[state=checked]:border-brand data-[state=checked]:bg-brand"
          >
            <Checkbox.Indicator>
              <CheckIcon className="size-3 text-white" />
            </Checkbox.Indicator>
          </Checkbox.Root>
        </label>

        <DialogClose asChild>
          <button
            type="button"
            className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
          >
            Continue
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
