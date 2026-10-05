import { useRef, useState, type ReactNode } from "react";
import TextareaAutosize from "react-textarea-autosize";
import {
  ArrowUpIcon,
  Loader2Icon,
  PaperclipIcon,
  SquareIcon,
} from "lucide-react";

import { cn } from "@/src/lib/utils";
import { AttachmentRail } from "@/src/features/composer/attachments/AttachmentRail";
import {
  classifyPaste,
  filesFromDrop,
} from "@/src/features/composer/attachments/paste";
import type { AttachmentDraft } from "@/src/features/composer/attachments/types";

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /**
   * Accessible name for the textarea. Worth setting wherever the surrounding
   * heading doesn't already name the field: an animated placeholder is not an
   * accessible name, and neither is a placeholder that is about to change.
   */
  ariaLabel?: string;
  /** Custom node rendered over the textarea (e.g. animated suggestions). */
  overlay?: ReactNode;
  isSubmitting?: boolean;
  /** Hard-disable input and submit (e.g. at the free-plan project cap). */
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
  autoFocus?: boolean;
  /** Tighter padding, radius, text and controls: used in the chat panel. */
  compact?: boolean;
  /** When provided, replaces the send button with a red stop button. */
  onStop?: () => void;
  /** Extra control rendered in the bottom row, just left of the send/stop button. */
  rightSlot?: ReactNode;
  /** Text shown next to the send icon (e.g. "Build"). Icon-only when omitted. */
  submitLabel?: string;

  attachments?: AttachmentDraft[];
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (key: string) => void;
  /** Called when a paste exceeds the length threshold: becomes a chip. */
  onPasteLarge?: (text: string) => void;
  /** Blocks submit while an attachment is uploading or extracting. */
  attachmentsBusy?: boolean;
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  ariaLabel,
  overlay,
  isSubmitting = false,
  disabled = false,
  minRows = 1,
  maxRows = 4,
  autoFocus = false,
  compact = false,
  onStop,
  rightSlot,
  submitLabel,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  onPasteLarge,
  attachmentsBusy = false,
}: PromptComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Drag events fire per-child, so count depth or the state flickers off as the
  // pointer crosses onto the textarea.
  const dragDepth = useRef(0);

  const hasText = value.trim().length > 0;
  const attachmentsEnabled = Boolean(onAttach);
  // An attachment-only message is legitimate.
  const canSubmit =
    (hasText || attachments.length > 0) &&
    !isSubmitting &&
    !disabled &&
    !attachmentsBusy;

  const handleFiles = (files: File[]) => {
    if (!onAttach || disabled || files.length === 0) return;
    onAttach(files);
  };

  return (
    <div
      onDragEnter={
        attachmentsEnabled
          ? (e) => {
              e.preventDefault();
              dragDepth.current += 1;
              setIsDragging(true);
            }
          : undefined
      }
      onDragOver={attachmentsEnabled ? (e) => e.preventDefault() : undefined}
      onDragLeave={
        attachmentsEnabled
          ? () => {
              dragDepth.current -= 1;
              if (dragDepth.current <= 0) {
                dragDepth.current = 0;
                setIsDragging(false);
              }
            }
          : undefined
      }
      onDrop={
        attachmentsEnabled
          ? (e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setIsDragging(false);
              handleFiles(filesFromDrop(e.dataTransfer));
            }
          : undefined
      }
      className={cn(
        "border bg-space-surface shadow-xl transition-colors focus-within:border-silver-600/45 focus-within:ring-3 focus-within:ring-silver-400/10",
        isDragging
          ? "border-dashed border-brand/70 ring-3 ring-brand/10"
          : "border-silver-400/40",
        // Matches landing's `.storm-composer`: 14px normally, 10px compact
        // (landing's own `compact ? 10 : 14` ElectricBorder radius) - padding
        // is a notch past landing's own to carry the bigger Home title.
        compact ? "rounded-[10px] p-2" : "rounded-[14px] p-4",
      )}
    >
      {onRemoveAttachment && (
        <AttachmentRail
          attachments={attachments}
          onRemove={onRemoveAttachment}
        />
      )}

      <div className="relative">
        <TextareaAutosize
          value={value}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          onPaste={
            attachmentsEnabled
              ? (e) => {
                  const intent = classifyPaste(e.clipboardData);
                  if (intent.kind === "files") {
                    e.preventDefault();
                    handleFiles(intent.files);
                  } else if (intent.kind === "large-text" && onPasteLarge) {
                    e.preventDefault();
                    onPasteLarge(intent.text);
                  }
                }
              : undefined
          }
          placeholder={overlay ? undefined : placeholder}
          minRows={minRows}
          maxRows={maxRows}
          autoFocus={autoFocus}
          disabled={disabled}
          className={cn(
            "scrollbar-thin w-full resize-none bg-transparent px-2 py-1 text-left text-foreground placeholder:text-muted-foreground focus:outline-none",
            // Landing's 24px read too big once it was real input text rather
            // than a short placeholder - dialed back a step.
            compact ? "text-sm" : "text-lg",
            disabled && "cursor-not-allowed opacity-60",
          )}
        />
        {overlay}
      </div>

      <div
        className={cn(
          "flex items-center justify-between",
          compact ? "mt-1" : "mt-4",
        )}
      >
        <button
          type="button"
          aria-label="Attach files"
          disabled={disabled || !attachmentsEnabled}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex items-center justify-center rounded-lg text-silver-600 transition-colors hover:bg-space-overlay hover:text-silver-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
            compact ? "size-7" : "size-10",
          )}
        >
          <PaperclipIcon className={compact ? "size-4" : "size-5"} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          // Extensions as well as MIME types: browsers report `.log` as
          // octet-stream and `.ts` as video/mp2t, so a MIME-only accept list
          // greys out exactly the files a coding tool most wants.
          accept="image/*,text/*,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.epub,.csv,.json,.md,.log,.txt,.yaml,.yml,.toml,.ini,.env,.sql,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.rb,.php,.cs,.c,.h,.cpp,.sh"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files ?? []));
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
          }}
        />

        <div className="flex items-center gap-2">
          {rightSlot}

          {onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className={cn(
                "flex items-center justify-center rounded-lg bg-[var(--space-overlay)] text-[var(--silver-900)] ring-1 ring-[var(--silver-400)] transition-[background-color,transform] hover:bg-[var(--space-surface)] active:scale-95",
                compact ? "size-7" : "size-9",
              )}
            >
              <SquareIcon className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              aria-label={submitLabel ?? "Send prompt"}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg transition-[background-color,transform]",
                submitLabel
                  ? "h-10 px-3 text-base font-semibold"
                  : compact
                    ? "size-7"
                    : "size-9",
                canSubmit
                  ? "bg-brand text-primary-foreground hover:bg-brand/90 active:scale-95"
                  : "cursor-not-allowed bg-space-overlay text-silver-600",
              )}
            >
              {isSubmitting || attachmentsBusy ? (
                <Loader2Icon className="size-5 animate-spin" />
              ) : (
                <>
                  {submitLabel}
                  <ArrowUpIcon className="size-5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
