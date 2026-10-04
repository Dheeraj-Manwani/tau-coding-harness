import { useState } from "react";
import {
  CheckIcon,
  InfoIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
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
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--space-overlay)] text-[var(--silver-600)]">
          <KeyRoundIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p title={secret.name} className="truncate font-mono text-xs font-medium text-[var(--silver-900)]">
            {secret.name}
          </p>
          <p className="text-[11px] text-[var(--silver-600)]">
            {formatUpdated(secret.updatedAt)}
          </p>
        </div>
        <span aria-label="Secret value hidden" className="hidden min-w-16 flex-1 rounded-lg bg-[var(--space-overlay)] px-3 py-2 font-mono text-xs tracking-widest text-[var(--silver-600)] md:block">
          ••••••••
        </span>

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
            aria-label={`New value for ${secret.name}`}
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

function NewSecretForm({
  projectId,
  existingNames,
  onClose,
}: {
  projectId: string;
  existingNames: string[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const save = useSetProjectSecret(projectId);
  const duplicate = existingNames.includes(name.trim());
  const inputClass = "h-9 w-full rounded-lg border border-[var(--silver-200)] bg-[var(--space-void)] px-3 font-mono text-xs text-[var(--silver-900)] focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

  return (
    <form
      autoComplete="off"
      className="mt-5 space-y-4 rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (duplicate || !name.trim() || !value.trim() || save.isPending) return;
        save.mutate({ name: name.trim(), value }, { onSuccess: onClose });
      }}
    >
      <h3 className="text-sm font-medium text-[var(--silver-900)]">New secret</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-xs text-[var(--silver-600)]">
          <span className="block">Name</span>
          <input
            autoFocus
            required
            pattern="[A-Z][A-Z0-9_]{1,63}"
            maxLength={64}
            title="Use 2–64 characters: uppercase letters, numbers and underscores, starting with a letter."
            placeholder="STRIPE_SECRET_KEY"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={save.isPending}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={duplicate}
            aria-describedby={duplicate ? "secret-name-error" : undefined}
            className={inputClass}
          />
        </label>
        <label className="space-y-2 text-xs text-[var(--silver-600)]">
          <span className="block">Value</span>
          <input
            required
            type="password"
            maxLength={16384}
            placeholder="Enter secret value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={save.isPending}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            className={inputClass}
          />
        </label>
      </div>
      {duplicate && (
        <p id="secret-name-error" role="alert" className="text-xs text-red-400">
          This secret already exists. Use Replace to update its value.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={save.isPending} onClick={onClose} className="h-8 rounded-lg px-3 text-xs text-[var(--silver-600)] hover:bg-[var(--space-overlay)] disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={duplicate || !name.trim() || !value.trim() || save.isPending} className="flex h-8 items-center gap-2 rounded-lg bg-[var(--blue-500)] px-3 text-xs font-medium text-white disabled:opacity-50">
          {save.isPending && <Loader2Icon className="size-3.5 animate-spin" />}
          Save secret
        </button>
      </div>
    </form>
  );
}

/** Secrets management inside the Tools workspace. Values are never fetched. */
export function KeysPane({ projectId }: { projectId: string }) {
  const { data: secrets, isLoading, isError, refetch } = useProjectSecrets(projectId);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const filteredSecrets = (secrets ?? []).filter((secret) =>
    secret.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="h-full overflow-y-auto bg-[var(--space-void)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-medium text-[var(--silver-900)]">Secrets</h2>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={adding || isLoading || isError}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--blue-500)] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <PlusIcon className="size-3.5" />
            New Secret
          </button>
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--blue-500)]/25 bg-[var(--blue-500)]/10 p-3 text-xs leading-relaxed text-[var(--silver-900)]">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--blue-500)]" />
          <span>
            Encrypted and given only to your app&apos;s server. They are never
            saved in your code, shown in the chat, or pushed to GitHub. Changes
            apply to the running app right away.
          </span>
        </p>

        {adding && (
          <NewSecretForm projectId={projectId} existingNames={(secrets ?? []).map((s) => s.name)} onClose={() => setAdding(false)} />
        )}

        <div className="relative mt-5">
          <input
            type="search"
            aria-label="Filter secrets by name"
            placeholder="Filter Secrets by name"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-full rounded-lg border border-[var(--silver-200)] bg-[var(--space-surface)] pr-10 pl-3 text-xs text-[var(--silver-900)] placeholder:text-[var(--silver-600)] focus-visible:outline-2 focus-visible:outline-ring"
          />
          <SearchIcon className="pointer-events-none absolute top-2.5 right-3 size-4 text-[var(--silver-600)]" />
        </div>

        {isLoading ? (
          <div role="status" aria-label="Loading secrets" className="mt-6 flex justify-center text-[var(--silver-600)]">
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        ) : isError ? (
          <div role="alert" className="mt-6 text-center text-xs text-[var(--silver-600)]">
            <p>Couldn&apos;t load secrets.</p>
            <button type="button" onClick={() => void refetch()} className="mt-2 text-[var(--blue-500)] hover:underline">Try again</button>
          </div>
        ) : filteredSecrets.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-[var(--silver-200)] px-4 py-10 text-center">
            <LockIcon className="mx-auto mb-3 size-6 text-[var(--silver-600)]" />
            <p className="text-sm font-medium text-[var(--silver-900)]">{secrets?.length ? "No matching secrets" : "No secrets yet"}</p>
            <p className="mt-1 text-xs text-[var(--silver-600)]">{secrets?.length ? "Try a different name." : "Add API keys and credentials for your app here."}</p>
          </div>
        ) : (
          <ul className="mt-5 flex flex-col gap-2">
            {filteredSecrets.map((s) => (
              <KeyRow key={s.name} projectId={projectId} secret={s} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
