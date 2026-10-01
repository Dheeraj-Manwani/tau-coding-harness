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
        if (!open)
          markMotionIntroSeen(reduce ? { reduceMotion: true } : undefined);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="gap-6 border border-zinc-800 bg-zinc-950 p-6 text-zinc-100 sm:max-w-sm"
      >
        <DialogHeader className="items-center gap-3 text-center">
          {/* <div aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
            <SparklesIcon className="size-5 text-zinc-200" />
          </div> */}
          <DialogTitle className="text-lg leading-snug">
            Make tau comfortable for you
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Prefer a calmer interface? Reduce animations and visual effects.
          </DialogDescription>
        </DialogHeader>

        <label
          htmlFor="motion-intro-reduce"
          className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:bg-zinc-900 has-[[data-state=checked]]:border-zinc-500"
        >
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium text-zinc-100">
              Reduce motion
            </span>
            <span className="text-xs leading-relaxed text-zinc-400">
              Turn off lightning borders and animated stars.
            </span>
          </span>
          <Checkbox.Root
            id="motion-intro-reduce"
            checked={reduce}
            onCheckedChange={(v) => setReduce(v === true)}
            className="flex size-5 shrink-0 items-center justify-center rounded-md border border-zinc-600 bg-zinc-950 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 data-[state=checked]:border-zinc-100 data-[state=checked]:bg-zinc-100"
          >
            <Checkbox.Indicator>
              <CheckIcon className="size-3.5 text-zinc-950" />
            </Checkbox.Indicator>
          </Checkbox.Root>
        </label>

        <div className="space-y-3">
          <DialogClose asChild>
            <button
              type="button"
              className="h-11 w-full cursor-pointer rounded-lg bg-zinc-100 px-4 text-sm font-medium text-zinc-950 outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              Continue
            </button>
          </DialogClose>
          <p className="text-center text-xs leading-relaxed text-zinc-500">
            You can change this anytime in Settings.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
