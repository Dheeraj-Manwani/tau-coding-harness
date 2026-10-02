import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowUpIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/src/lib/utils";
import {
  errorMessage,
  secretKeys,
  submitSecretAnswer,
  type SecretField,
} from "@/src/features/project/secrets";

/**
 * One key field. Password-masked, and kept away from password managers (a
 * vendor API key is not the user's tau password and must not be saved as it).
 *
 * `<input>` strips line breaks from its value, which would silently corrupt a
 * PEM private key or a service-account JSON. A multi-line paste is therefore
 * captured from the clipboard and held outside the input, shown as a chip.
 */
function SecretInput({
  field,
  value,
  disabled,
  autoFocus,
  onChange,
  onEnter,
}: {
  field: SecretField;
  value: string;
  disabled: boolean;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const multiline = value.includes("\n");
  const id = `secret-${field.name}`;

  return (
    <div className="px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {field.label}
        </label>
        {field.url && (
          <a
            href={field.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Get key
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>
      {field.description && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {field.description}
        </p>
      )}

      {multiline ? (
        <div className="mt-1.5 flex h-8 items-center gap-2 rounded-lg border border-silver-400/40 bg-space-overlay px-2.5 text-xs text-muted-foreground">
          <KeyRoundIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Multi-line key pasted ({value.split("\n").length} lines)
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange("")}
            aria-label={`Clear ${field.label}`}
            className="shrink-0 transition-colors hover:text-foreground disabled:opacity-50"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative mt-1.5">
          <input
            id={id}
            autoFocus={autoFocus}
            type={revealed ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (/\r?\n/.test(text.trim())) {
                e.preventDefault();
                onChange(text.replace(/\r\n/g, "\n"));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter();
              }
            }}
            disabled={disabled}
            placeholder={`Paste ${field.name}`}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            className="h-8 w-full rounded-lg border border-silver-400/40 bg-transparent pl-2.5 pr-8 font-mono text-xs text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:border-silver-600/60 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "Hide key" : "Show key"}
            className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            {revealed ? (
              <EyeOffIcon className="size-3.5" />
            ) : (
              <EyeIcon className="size-3.5" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The composer-area form for a paused `request_secret` call.
 *
 * The values are posted to the secrets endpoint, which stores them encrypted
 * and resumes the agent. Only the server's summary ("Added Stripe secret key")
 * becomes the user's reply bubble — the chat never holds a value.
 */
export function SecretRequestPrompt({
  projectId,
  jobId,
  questionId,
  fields,
  onAnswered,
}: {
  projectId: string;
  jobId: string;
  questionId: string;
  fields: SecretField[];
  onAnswered: (answer: string) => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const filled = fields.filter((f) => (values[f.name] ?? "").trim());
  const canSave = filled.length > 0 && !submitting;

  const submit = async (skipAll: boolean) => {
    if (submitting || (!skipAll && filled.length === 0)) return;
    setSubmitting(true);
    const payload = Object.fromEntries(
      fields.map((f) => [f.name, skipAll ? "" : (values[f.name] ?? "")]),
    );
    try {
      const result = await submitSecretAnswer(projectId, jobId, questionId, payload);
      // Drop the plaintext from memory as soon as the server has it.
      setValues({});
      void qc.invalidateQueries({ queryKey: secretKeys.list(projectId) });
      onAnswered(result.answer);
    } catch (err) {
      // A late answer can still have stored the keys (see the server's
      // message), so the Keys tab may have changed either way.
      void qc.invalidateQueries({ queryKey: secretKeys.list(projectId) });
      toast.error(errorMessage(err, "Couldn't save your keys. Please try again."));
      setSubmitting(false);
    }
  };

  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      className="rounded-xl border border-silver-400/40 bg-space-surface p-2 shadow-xl focus-within:border-silver-600/45 focus-within:ring-3 focus-within:ring-silver-400/10"
    >
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">
        <LockIcon className="size-3 shrink-0" />
        <span>Encrypted and only used by your app. Never shown in the chat.</span>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {fields.map((field, i) => (
          <SecretInput
            key={field.name}
            field={field}
            value={values[field.name] ?? ""}
            disabled={submitting}
            autoFocus={i === 0}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
            onEnter={() => void submit(false)}
          />
        ))}
      </div>

      <div className="mt-1 flex items-center justify-end gap-2 px-2 pb-0.5">
        {fields.length > 1 && filled.length > 0 && filled.length < fields.length && (
          <span className="mr-auto text-[11px] text-muted-foreground">
            Empty fields will be skipped
          </span>
        )}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit(true)}
          className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-space-overlay hover:text-foreground disabled:opacity-50"
        >
          Skip
        </button>
        <button
          type="submit"
          disabled={!canSave}
          aria-label="Save keys"
          className={cn(
            "flex size-7 items-center justify-center rounded-lg transition-[background-color,transform]",
            canSave
              ? "bg-brand text-primary-foreground hover:bg-brand/90 active:scale-95"
              : "cursor-not-allowed bg-space-overlay text-silver-600",
          )}
        >
          {submitting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ArrowUpIcon className="size-4" />
          )}
        </button>
      </div>
    </form>
  );
}
