import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  DownloadIcon,
  EyeIcon,
  FolderIcon,
  HardDriveIcon,
  InfoIcon,
  Loader2Icon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { APP_BILLING } from "@/src/lib/routes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/src/components/ui/alert-dialog";
import { errorMessage } from "@/src/features/project/secrets";
import {
  NEARLY_FULL_PERCENT,
  canPreview,
  fetchFileUrl,
  formatSize,
  splitKey,
  typeLabel,
  useClearPreviewFiles,
  useDeleteStorageFiles,
  useProjectStorage,
  useStorageFiles,
  usagePercent,
  type StorageEnv,
  type StoredFile,
} from "@/src/features/project/storage";

function formatDate(iso: string): string {
  const ts = Date.parse(iso);
  return ts ? new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

/** Debounce a value, so typing a prefix does not ask the server per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function UsageBar({ used, quota, maxFile }: { used: number; quota: number; maxFile: number }) {
  const navigate = useNavigate();
  const pct = usagePercent(used, quota);
  const nearlyFull = pct >= NEARLY_FULL_PERCENT;
  return (
    <div className="mt-4 rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-[var(--silver-900)]">
          {formatSize(used)} <span className="font-normal text-[var(--silver-600)]">of {formatSize(quota)} used</span>
        </p>
        <p className="text-[11px] text-[var(--silver-600)]">
          Across all your apps · largest file {formatSize(maxFile)}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--space-overlay)]"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", nearlyFull ? "bg-red-400" : "bg-[var(--blue-500)]")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {nearlyFull && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-[var(--silver-600)]">
          {pct >= 100 ? "Your storage is full, so new uploads are refused." : "Your storage is nearly full."}
          <button
            type="button"
            onClick={() => navigate(APP_BILLING)}
            className="text-[var(--blue-500)] hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Get more room
          </button>
        </p>
      )}
    </div>
  );
}

/** Open a file in a new tab (pictures, PDF, text) or save it, through a fresh signed address. */
async function openFile(projectId: string, env: StorageEnv, file: StoredFile, download: boolean) {
  // A tab opened after an await is treated as a pop-up and blocked, so open it first.
  const tab = download ? null : window.open("", "_blank");
  try {
    const url = await fetchFileUrl(projectId, env, file.key, download);
    if (download) {
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else if (tab) {
      tab.opener = null;
      tab.location.href = url;
    }
  } catch (err) {
    tab?.close();
    toast.error(errorMessage(err, "Couldn't open the file"));
  }
}

function FileRow({
  file,
  projectId,
  env,
  selected,
  onToggle,
  onDelete,
  deleting,
}: {
  file: StoredFile;
  projectId: string;
  env: StorageEnv;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { folder, name } = splitKey(file.key);
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_4rem_5rem_7rem_6.5rem]">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${name}`}
        className="size-4 accent-[var(--blue-500)]"
      />
      <div className="min-w-0">
        <p title={file.key} className="truncate text-xs font-medium text-[var(--silver-900)]">
          {name}
        </p>
        {folder && (
          <p className="inline-flex max-w-full items-center gap-1 truncate font-mono text-[11px] text-[var(--silver-600)]">
            <FolderIcon className="size-3 shrink-0" />
            <span className="truncate">{folder}</span>
          </p>
        )}
        <p className="truncate text-[11px] text-[var(--silver-600)] sm:hidden">
          {formatSize(file.size)} · {formatDate(file.createdAt)}
        </p>
      </div>
      <span className="hidden text-[11px] text-[var(--silver-600)] sm:block">{typeLabel(file.contentType, name)}</span>
      <span className="hidden text-right text-xs tabular-nums text-[var(--silver-600)] sm:block">{formatSize(file.size)}</span>
      <span className="hidden text-xs text-[var(--silver-600)] sm:block">{formatDate(file.createdAt)}</span>

      {confirming ? (
        <div className="flex shrink-0 items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="h-7 rounded-lg px-2 text-xs text-[var(--silver-600)] hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="flex h-7 items-center gap-1.5 rounded-lg bg-red-500/15 px-2 text-xs font-medium text-red-400 hover:bg-red-500/25 disabled:opacity-50"
          >
            {deleting && <Loader2Icon className="size-3.5 animate-spin" />}
            Delete
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-end gap-0.5">
          {canPreview(file.contentType) && (
            <button
              type="button"
              onClick={() => void openFile(projectId, env, file, false)}
              aria-label={`Preview ${name}`}
              className="flex size-8 items-center justify-center rounded-lg text-[var(--silver-600)] hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
            >
              <EyeIcon className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void openFile(projectId, env, file, true)}
            aria-label={`Download ${name}`}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--silver-600)] hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
          >
            <DownloadIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${name}`}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--silver-600)] hover:bg-[var(--space-overlay)] hover:text-red-400"
          >
            <Trash2Icon className="size-4" />
          </button>
        </div>
      )}
    </li>
  );
}

function ClearPreviewDialog({
  count,
  open,
  onOpenChange,
  projectId,
}: {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const clear = useClearPreviewFiles(projectId);
  const handle = (event: MouseEvent) => {
    event.preventDefault();
    clear.mutate(undefined, { onSettled: () => onOpenChange(false) });
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm" className="border-silver-200 bg-space-surface">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-red-500/10 text-red-400">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-silver-900">Clear preview files?</AlertDialogTitle>
          <AlertDialogDescription className="text-silver-600">
            {count === 1 ? "The 1 file" : `All ${count} files`} uploaded while testing the app in the preview will be
            permanently deleted. Files on your published app are not touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="border-t border-border pt-4">
          <AlertDialogCancel variant="outline" className="border-silver-200 bg-transparent text-silver-600 hover:bg-space-overlay hover:text-silver-900">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={handle} disabled={clear.isPending} className="bg-red-500/15 text-red-400 hover:bg-red-500/25">
            {clear.isPending ? "Clearing…" : "Clear files"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const EMPTY_KEYS: Set<string> = new Set();
const ENV_LABEL: Record<StorageEnv, string> = { PREVIEW: "Preview", LIVE: "Live" };

/** Tools → Storage: the files this app has stored, with usage against the allowance. */
export function StoragePane({ projectId }: { projectId: string }) {
  const overview = useProjectStorage(projectId);
  const [env, setEnv] = useState<StorageEnv>("PREVIEW");
  const [search, setSearch] = useState("");
  const prefix = useDebounced(search.trim(), 300);
  // What is picked belongs to one list; another environment or search is another list.
  const scope = `${env}|${prefix}`;
  const [pick, setPick] = useState<{ scope: string; keys: Set<string> }>({ scope: "", keys: new Set() });
  const selected = pick.scope === scope ? pick.keys : EMPTY_KEYS;
  const setSelected = (update: (s: Set<string>) => Set<string>) =>
    setPick((p) => ({ scope, keys: update(p.scope === scope ? p.keys : EMPTY_KEYS) }));
  const [clearing, setClearing] = useState(false);
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());

  const data = overview.data;
  const hasFiles = (data?.environments ?? []).some((e) => e.fileCount > 0);
  // Nothing to browse until the app has turned storage on or has stored something.
  const showFiles = Boolean(data && (data.enabled || hasFiles));
  const files = useStorageFiles(projectId, env, prefix, showFiles);
  const del = useDeleteStorageFiles(projectId, env);

  const rows = useMemo(() => files.data?.pages.flatMap((p) => p.files) ?? [], [files.data]);
  const current = data?.environments.find((e) => e.env === env);
  const previewCount = data?.environments.find((e) => e.env === "PREVIEW")?.fileCount ?? 0;

  const remove = (keys: string[]) => {
    setDeletingKeys(new Set(keys));
    del.mutate(keys, {
      onSuccess: () => {
        setSelected((s) => new Set([...s].filter((k) => !keys.includes(k))));
      },
      onSettled: () => setDeletingKeys(new Set()),
    });
  };

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));

  return (
    <div className="h-full overflow-y-auto bg-[var(--space-void)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-medium text-[var(--silver-900)]">Storage</h2>
          {env === "PREVIEW" && previewCount > 0 && (
            <button
              type="button"
              onClick={() => setClearing(true)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-red-400"
            >
              <Trash2Icon className="size-3.5" />
              Clear preview files
            </button>
          )}
        </div>

        {overview.isLoading ? (
          <div role="status" aria-label="Loading storage" className="mt-8 flex justify-center text-[var(--silver-600)]">
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        ) : overview.isError || !data ? (
          <div role="alert" className="mt-8 text-center text-xs text-[var(--silver-600)]">
            <p>Couldn&apos;t load storage.</p>
            <button type="button" onClick={() => void overview.refetch()} className="mt-2 text-[var(--blue-500)] hover:underline">
              Try again
            </button>
          </div>
        ) : (
          <>
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--blue-500)]/25 bg-[var(--blue-500)]/10 p-3 text-xs leading-relaxed text-[var(--silver-900)]">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--blue-500)]" />
              <span>
                Files your app keeps for its users. They stay when the preview is rebuilt, and only your app&apos;s
                server can read them. Files uploaded while testing in the preview are separate from the ones on your
                published app.
              </span>
            </p>

            {data.suspended && (
              <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs leading-relaxed text-[var(--silver-900)]">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                <span>
                  Storage for this app has been suspended by tau. Your files are kept, but nothing can be uploaded or
                  opened until it is lifted.
                </span>
              </p>
            )}

            <UsageBar used={data.usage.usedBytes} quota={data.usage.quotaBytes} maxFile={data.usage.maxFileBytes} />

            {!showFiles ? (
              <div className="mt-6 rounded-xl border border-dashed border-[var(--silver-200)] px-4 py-10 text-center">
                <HardDriveIcon className="mx-auto mb-3 size-6 text-[var(--silver-600)]" />
                <p className="text-sm font-medium text-[var(--silver-900)]">This app doesn&apos;t store files</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--silver-600)]">
                  To let people upload pictures or documents, ask tau for it in the chat, for example &ldquo;let users
                  upload a profile picture&rdquo;.
                </p>
              </div>
            ) : (
              <>
                {data.environments.length > 1 && (
                  <div role="tablist" aria-label="Environment" className="mt-5 flex gap-1">
                    {data.environments.map((e) => (
                      <button
                        key={e.env}
                        type="button"
                        role="tab"
                        aria-selected={env === e.env}
                        onClick={() => setEnv(e.env)}
                        className={cn(
                          "h-8 rounded-lg px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring",
                          env === e.env
                            ? "bg-[var(--space-overlay)] text-[var(--silver-900)]"
                            : "text-[var(--silver-600)] hover:bg-[var(--space-overlay)]/60 hover:text-[var(--silver-900)]",
                        )}
                      >
                        {ENV_LABEL[e.env]} · {e.fileCount}
                      </button>
                    ))}
                  </div>
                )}

                <div className="relative mt-5">
                  <input
                    type="search"
                    aria-label="Filter files by folder or name prefix"
                    placeholder="Filter by folder, e.g. users/42/"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[var(--silver-200)] bg-[var(--space-surface)] pr-10 pl-3 text-xs text-[var(--silver-900)] placeholder:text-[var(--silver-600)] focus-visible:outline-2 focus-visible:outline-ring"
                  />
                  <SearchIcon className="pointer-events-none absolute top-2.5 right-3 size-4 text-[var(--silver-600)]" />
                </div>

                {selected.size > 0 && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-[var(--space-overlay)] px-3 py-2">
                    <span className="text-xs text-[var(--silver-900)]">{selected.size} selected</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelected(() => new Set())}
                        className="h-7 rounded-lg px-2 text-xs text-[var(--silver-600)] hover:text-[var(--silver-900)]"
                      >
                        Clear selection
                      </button>
                      <button
                        type="button"
                        disabled={del.isPending}
                        onClick={() => remove([...selected])}
                        className="flex h-7 items-center gap-1.5 rounded-lg bg-red-500/15 px-2 text-xs font-medium text-red-400 hover:bg-red-500/25 disabled:opacity-50"
                      >
                        {del.isPending && <Loader2Icon className="size-3.5 animate-spin" />}
                        Delete selected
                      </button>
                    </div>
                  </div>
                )}

                {files.isLoading ? (
                  <div role="status" aria-label="Loading files" className="mt-6 flex justify-center text-[var(--silver-600)]">
                    <Loader2Icon className="size-4 animate-spin" />
                  </div>
                ) : files.isError ? (
                  <div role="alert" className="mt-6 text-center text-xs text-[var(--silver-600)]">
                    <p>Couldn&apos;t load the files.</p>
                    <button type="button" onClick={() => void files.refetch()} className="mt-2 text-[var(--blue-500)] hover:underline">
                      Try again
                    </button>
                  </div>
                ) : rows.length === 0 ? (
                  <div className="mt-6 rounded-xl border border-dashed border-[var(--silver-200)] px-4 py-10 text-center">
                    <HardDriveIcon className="mx-auto mb-3 size-6 text-[var(--silver-600)]" />
                    <p className="text-sm font-medium text-[var(--silver-900)]">{prefix ? "No matching files" : "No files yet"}</p>
                    <p className="mt-1 text-xs text-[var(--silver-600)]">
                      {prefix
                        ? "Try a different folder."
                        : env === "PREVIEW"
                          ? "Files uploaded while you test the app will show up here."
                          : "Files uploaded on your published app will show up here."}
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 overflow-hidden rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)]">
                    <div className="hidden grid-cols-[auto_minmax(0,1fr)_4rem_5rem_7rem_6.5rem] items-center gap-x-3 border-b border-[var(--silver-200)] px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-[var(--silver-600)] sm:grid">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => setSelected(() => (allSelected ? new Set() : new Set(rows.map((r) => r.key))))}
                        aria-label="Select all files shown"
                        className="size-4 accent-[var(--blue-500)]"
                      />
                      <span>File</span>
                      <span>Type</span>
                      <span className="text-right">Size</span>
                      <span>Uploaded</span>
                      <span />
                    </div>
                    <ul className="divide-y divide-[var(--silver-200)]">
                      {rows.map((f) => (
                        <FileRow
                          key={f.id}
                          file={f}
                          projectId={projectId}
                          env={env}
                          selected={selected.has(f.key)}
                          onToggle={() => toggle(f.key)}
                          onDelete={() => remove([f.key])}
                          deleting={del.isPending && deletingKeys.has(f.key)}
                        />
                      ))}
                    </ul>
                    {files.hasNextPage && (
                      <div className="border-t border-[var(--silver-200)] p-3 text-center">
                        <button
                          type="button"
                          disabled={files.isFetchingNextPage}
                          onClick={() => void files.fetchNextPage()}
                          className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs text-[var(--silver-600)] hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)] disabled:opacity-50"
                        >
                          {files.isFetchingNextPage && <Loader2Icon className="size-3.5 animate-spin" />}
                          Show more
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {current && rows.length > 0 && (
                  <p className="mt-3 text-[11px] text-[var(--silver-600)]">
                    {current.fileCount} {current.fileCount === 1 ? "file" : "files"} · {formatSize(current.usedBytes)} in{" "}
                    {ENV_LABEL[env].toLowerCase()}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
      <ClearPreviewDialog count={previewCount} open={clearing} onOpenChange={setClearing} projectId={projectId} />
    </div>
  );
}
