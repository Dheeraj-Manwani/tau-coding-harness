import { useState } from "react";
import {
  CheckIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { cn } from "@/src/lib/utils";
import {
  useDeleteProjectSecret,
  useProjectSecrets,
  useSetProjectSecret,
  type ProjectSecretSummary,
} from "@/src/features/project/secrets";

function formatUpdated(iso: string): string {
  const ts = Date.parse(iso);
  if (!ts) return "";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return "Updated just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `Updated ${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `Updated ${hr} hour${hr === 1 ? "" : "s"} ago`;
  return `Updated ${new Date(ts).toLocaleDateString()}`;
}

/**
 * One saved key. The value is never fetched — the server doesn't send it — so
 * "edit" means "replace": the field starts empty and saving overwrites.
 */
function KeyRow({
  projectId,
  secret,
}: {
  projectId: string;
  secret: ProjectSecretSummary;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const save = useSetProjectSecret(projectId);
  const remove = useDeleteProjectSecret(projectId);

  const commit = () => {
    if (!value.trim() || save.isPending) return;
    save.mutate(
      { name: secret.name, value },
      {
        onSuccess: () => {
          setValue("");
          setEditing(false);
        },
      },
    );
  };

  return (
    <li className="rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--space-overlay)] text-[var(--silver-600)]">
          <KeyRoundIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-medium text-[var(--silver-900)]">
            {secret.name}
          </p>
          <p className="text-[11px] text-[var(--silver-600)]">
            <span aria-hidden className="font-mono tracking-widest">••••••••</span>
            <span className="mx-1.5">·</span>
            {formatUpdated(secret.updatedAt)}
          </p>
        </div>

        {!editing && !confirmingDelete && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
            >
              <PencilIcon className="size-3.5" />
              Replace
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={`Remove ${secret.name}`}
              className="flex size-7 items-center justify-center rounded-lg text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-red-400"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
        )}

        {confirmingDelete && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-xs text-[var(--silver-600)]">Remove?</span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => setConfirmingDelete(false)}
              className="h-7 rounded-lg px-2 text-xs text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(secret.name)}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-red-500/15 px-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/25 disabled:opacity-50"
            >
              {remove.isPending && <Loader2Icon className="size-3.5 animate-spin" />}
              Remove
            </button>
          </div>
        )}
      </div>

      {editing && (
        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
          className="mt-3 flex items-center gap-2"
        >
          <input
            autoFocus
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setValue("");
                setEditing(false);
              }
            }}
            disabled={save.isPending}
            placeholder={`New value for ${secret.name}`}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--silver-200)] bg-[var(--space-void)] px-3 font-mono text-xs text-[var(--silver-900)] placeholder:font-sans placeholder:text-[var(--silver-600)] focus:border-[var(--silver-400)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => {
              setValue("");
              setEditing(false);
            }}
            aria-label="Cancel"
            className="flex size-8 items-center justify-center rounded-lg text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)] disabled:opacity-50"
          >
            <XIcon className="size-4" />
          </button>
          <button
            type="submit"
            disabled={!value.trim() || save.isPending}
            aria-label="Save"
            className={cn(
              "flex size-8 items-center justify-center rounded-lg transition-colors",
              value.trim() && !save.isPending
                ? "bg-[var(--silver-900)] text-[var(--space-void)]"
                : "cursor-not-allowed bg-[var(--space-overlay)] text-[var(--silver-600)]",
            )}
          >
            {save.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <CheckIcon className="size-4" />
            )}
          </button>
        </form>
      )}
    </li>
  );
}

/** The Keys tab: third-party API keys the agent asked for with `request_secret`. */
export function KeysPane({ projectId }: { projectId: string }) {
  const { data: secrets, isLoading } = useProjectSecrets(projectId);

  return (
    <div className="h-full overflow-y-auto bg-[var(--space-void)]">
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <h2 className="text-sm font-medium text-[var(--silver-900)]">API keys</h2>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--silver-600)]">
          <LockIcon className="mt-0.5 size-3 shrink-0" />
          <span>
            Encrypted and given only to your app&apos;s server. They are never
            saved in your code, shown in the chat, or pushed to GitHub. Changes
            apply to the running app right away.
          </span>
        </p>

        {isLoading ? (
          <div className="mt-6 flex justify-center text-[var(--silver-600)]">
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        ) : (
          <ul className="mt-5 flex flex-col gap-2">
            {(secrets ?? []).map((s) => (
              <KeyRow key={s.name} projectId={projectId} secret={s} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
