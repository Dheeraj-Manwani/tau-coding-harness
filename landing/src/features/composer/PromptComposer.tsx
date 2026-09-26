import { type ReactNode } from "react";
import { ArrowUpIcon, PaperclipIcon } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";

import { cn } from "@/src/lib/utils";

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  ariaLabel?: string;
  overlay?: ReactNode;
  minRows?: number;
  maxRows?: number;
  rightSlot?: ReactNode;
}

/**
 * Marketing-only composer replica. Attachments intentionally stay disabled;
 * uploading belongs to the authenticated app on app.tauai.pro.
 */
export function PromptComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  ariaLabel,
  overlay,
  minRows = 1,
  maxRows = 4,
  rightSlot,
}: PromptComposerProps) {
  const canSubmit = value.trim().length > 0;

  return (
    <div className="rounded-2xl border border-silver-400/40 bg-space-surface p-3 shadow-xl transition-colors focus-within:border-silver-600/45 focus-within:ring-3 focus-within:ring-silver-400/10">
      <div className="relative">
        <TextareaAutosize
          value={value}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          placeholder={overlay ? undefined : placeholder}
          minRows={minRows}
          maxRows={maxRows}
          className="scrollbar-thin w-full resize-none bg-transparent px-2 py-1 text-left text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {overlay}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Attachments are available after sign up"
          disabled
          className="flex size-9 cursor-not-allowed items-center justify-center rounded-lg text-silver-600 opacity-40"
        >
          <PaperclipIcon className="size-4" />
        </button>

        <div className="flex items-center gap-2">
          {rightSlot}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Continue to sign up"
            className={cn(
              "flex size-9 items-center justify-center rounded-lg transition-[background-color,transform]",
              canSubmit
                ? "bg-brand text-primary-foreground hover:bg-brand/90 active:scale-95"
                : "cursor-not-allowed bg-space-overlay text-silver-600",
            )}
          >
            <ArrowUpIcon className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
