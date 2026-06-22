import type { ReactNode } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { motion } from "motion/react";
import { ArrowUpIcon, Loader2Icon, PaperclipIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";

// Shared layoutId so Framer morphs this card between the Home (centered) and
// ChatPanel (bottom-left) positions during the route transition.
export const COMPOSER_LAYOUT_ID = "prompt-composer";

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Custom node rendered over the textarea (e.g. animated suggestions). */
  overlay?: ReactNode;
  isSubmitting?: boolean;
  minRows?: number;
  maxRows?: number;
  autoFocus?: boolean;
  /** Tighter padding, radius, text and controls — used in the chat panel. */
  compact?: boolean;
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  overlay,
  isSubmitting = false,
  minRows = 1,
  maxRows = 4,
  autoFocus = false,
  compact = false,
}: PromptComposerProps) {
  const hasText = value.trim().length > 0;
  const canSubmit = hasText && !isSubmitting;

  return (
    <motion.div
      layoutId={COMPOSER_LAYOUT_ID}
      transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "border border-silver-400/30 bg-space-surface shadow-xl focus-within:border-brand/60 focus-within:ring-3 focus-within:ring-brand/15",
        compact ? "rounded-xl p-2" : "rounded-2xl p-3",
      )}
    >
      <div className="relative">
        <TextareaAutosize
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          placeholder={overlay ? undefined : placeholder}
          minRows={minRows}
          maxRows={maxRows}
          autoFocus={autoFocus}
          className={cn(
            "scrollbar-thin w-full resize-none bg-transparent px-2 py-1 text-left text-foreground placeholder:text-muted-foreground focus:outline-none",
            compact ? "text-sm" : "text-base",
          )}
        />
        {overlay}
      </div>

      <div className={cn("flex items-center justify-between", compact ? "mt-1" : "mt-2")}>
        <button
          type="button"
          aria-label="Attach files"
          className={cn(
            "flex items-center justify-center rounded-lg text-silver-600 transition-colors hover:bg-space-overlay hover:text-silver-900",
            compact ? "size-7" : "size-9",
          )}
        >
          <PaperclipIcon className="size-4" />
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label="Send prompt"
          className={cn(
            "flex items-center justify-center rounded-lg transition-[background-color,transform]",
            compact ? "size-7" : "size-9",
            hasText
              ? "bg-brand text-primary-foreground hover:bg-brand/90 active:scale-95"
              : "cursor-not-allowed bg-space-overlay text-silver-600",
          )}
        >
          {isSubmitting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ArrowUpIcon className="size-4" />
          )}
        </button>
      </div>
    </motion.div>
  );
}
