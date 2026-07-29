import { useMemo, useState, type MouseEvent } from "react";
import { motion } from "motion/react";
import { Popover } from "radix-ui";
import {
  CircleDotIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  Link2Icon,
  LoaderCircleIcon,
  LockIcon,
  GlobeIcon,
  SearchIcon,
  Unlink2Icon,
  UploadCloudIcon,
} from "lucide-react";

import { cn } from "@/src/lib/utils";
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
import { useProjectStore } from "@/src/stores/useProjectStore";
import {
  startGithubConnect,
  useGithubReturnToast,
} from "@/src/features/auth/github";
import {
  useGithubProject,
  useUserRepos,
  usePushToGithub,
  useLinkRepo,
  useUnlinkRepo,
  usePatchGithub,
  useDisconnectGithub,
  syncLabel,
  type GithubProjectInfo,
  type PrSummary,
} from "@/src/features/project/github";
import { GithubMark } from "@/src/components/ui/github-mark";

/** Colour of the little status dot on the trigger button. */
function dotClass(info: GithubProjectInfo | undefined): string | null {
  if (!info?.connected) return null;
  if (!info.repo) return "bg-blue-500";
  return info.unpushedChanges > 0 ? "bg-amber-400" : "bg-green-500";
}

function prStateBadge(pr: PrSummary): { label: string; cls: string } {
  if (pr.merged) return { label: "Merged", cls: "bg-purple-500/15 text-purple-300" };
  if (pr.state === "closed")
    return { label: "Closed", cls: "bg-red-500/15 text-red-300" };
  return { label: "Open", cls: "bg-green-500/15 text-green-400" };
}

export function GithubPanel() {
  useGithubReturnToast();
  const projectId = useProjectStore((s) => s.projectId);
  const { data: info, isLoading } = useGithubProject(projectId);

  const [open, setOpen] = useState(false);
  // While a confirmation modal is up, keep the popover open — otherwise its
  // content (and the modal rendered inside it) would unmount on focus-outside.
  const [confirmActive, setConfirmActive] = useState(false);

  const dot = dotClass(info);

  const trigger = (
    <motion.button
      type="button"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label="GitHub"
      className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--silver-200)] bg-[var(--space-surface)] text-[var(--silver-900)] transition-colors hover:border-[var(--silver-400)] hover:bg-[var(--space-overlay)]"
    >
      <GithubMark className="size-4.5" />
      {dot && (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--space-void)]",
            dot,
          )}
        />
      )}
    </motion.button>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && confirmActive) return;
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-xl border border-silver-400/30 bg-space-surface p-4 text-left shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Popover.Arrow className="fill-space-surface" />
          <div className="mb-3 flex items-center gap-2">
            <GithubMark className="size-4 text-silver-900" />
            <span className="font-heading text-sm font-medium text-silver-900">
              GitHub
            </span>
          </div>

          {isLoading || !info ? (
            <div className="flex items-center gap-2 py-6 text-sm text-silver-600">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading…
            </div>
          ) : !info.connected ? (
            <NotConnected />
          ) : (
            <Connected
              projectId={projectId}
              info={info}
              onConfirmActiveChange={setConfirmActive}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotConnected() {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-silver-600">
        Connect your GitHub account to push this project, open pull requests, and
        file issues.
      </p>
      <button
        type="button"
        onClick={startGithubConnect}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand/90"
      >
        <GithubMark className="size-4" />
        Connect GitHub
      </button>
    </div>
  );
}

function Connected({
  projectId,
  info,
  onConfirmActiveChange,
}: {
  projectId: string | null;
  info: GithubProjectInfo;
  onConfirmActiveChange: (active: boolean) => void;
}) {
  const disconnect = useDisconnectGithub(projectId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] text-silver-600">Connected as</p>
          <p className="truncate text-sm font-medium text-silver-900">
            {info.username}
          </p>
        </div>
        <button
          type="button"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          className="shrink-0 text-[11px] text-silver-600 underline-offset-2 hover:text-silver-900 hover:underline disabled:opacity-50"
        >
          Disconnect
        </button>
      </div>

      <div className="h-px bg-silver-400/20" />

      {info.repo ? (
        <LinkedRepo
          projectId={projectId}
          info={info}
          onConfirmActiveChange={onConfirmActiveChange}
        />
      ) : (
        <NoRepo projectId={projectId} />
      )}
    </div>
  );
}

function NoRepo({ projectId }: { projectId: string | null }) {
  const push = usePushToGithub(projectId);
  const [picking, setPicking] = useState(false);

  return (
    <div className="space-y-2.5">
      <p className="text-xs leading-relaxed text-silver-600">
        This project isn’t linked to a repository yet.
      </p>
      <button
        type="button"
        onClick={() => push.mutate({ mode: "new_pr" })}
        disabled={push.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand/90 disabled:opacity-60"
      >
        {push.isPending ? (
          <LoaderCircleIcon className="size-4 animate-spin" />
        ) : (
          <UploadCloudIcon className="size-4" />
        )}
        {push.isPending ? "Creating…" : "Create & push repository"}
      </button>
      <button
        type="button"
        onClick={() => setPicking((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-silver-400/30 px-3 py-2 text-sm text-silver-900 transition-colors hover:bg-space-overlay"
      >
        <Link2Icon className="size-4" />
        Link existing repository
      </button>
      {picking && <RepoPicker projectId={projectId} onDone={() => setPicking(false)} />}
    </div>
  );
}

function RepoPicker({
  projectId,
  onDone,
}: {
  projectId: string | null;
  onDone: () => void;
}) {
  const { data: repos, isLoading } = useUserRepos(projectId, true);
  const link = useLinkRepo(projectId);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const list = repos ?? [];
    const needle = q.trim().toLowerCase();
    return (needle
      ? list.filter((r) => r.fullName.toLowerCase().includes(needle))
      : list
    ).slice(0, 50);
  }, [repos, q]);

  return (
    <div className="rounded-lg border border-silver-400/20 bg-space-void/40 p-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-silver-600" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your repos…"
          className="w-full rounded-md border border-silver-400/30 bg-space-overlay py-1.5 pl-7 pr-2 text-xs text-silver-900 outline-none placeholder:text-silver-600 focus:border-silver-400"
        />
      </div>
      <div className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-silver-600">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            Loading repos…
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-1 py-2 text-xs text-silver-600">No repositories.</p>
        ) : (
          filtered.map((r) => (
            <button
              key={r.fullName}
              type="button"
              disabled={link.isPending}
              onClick={() =>
                link.mutate(r.fullName, { onSuccess: () => onDone() })
              }
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-silver-900 transition-colors hover:bg-space-overlay disabled:opacity-50"
            >
              {r.private ? (
                <LockIcon className="size-3 shrink-0 text-silver-600" />
              ) : (
                <GlobeIcon className="size-3 shrink-0 text-silver-600" />
              )}
              <span className="truncate">{r.fullName}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function LinkedRepo({
  projectId,
  info,
  onConfirmActiveChange,
}: {
  projectId: string | null;
  info: GithubProjectInfo;
  onConfirmActiveChange: (active: boolean) => void;
}) {
  const repo = info.repo!;
  const patch = usePatchGithub(projectId);
  const unlink = useUnlinkRepo(projectId);

  const isPrivate = repo.visibility === "private";

  // Target visibility awaiting confirmation (true = make private), or null.
  const [pendingPrivate, setPendingPrivate] = useState<boolean | null>(null);

  const openConfirm = () => {
    setPendingPrivate(!isPrivate);
    onConfirmActiveChange(true);
  };
  const closeConfirm = () => {
    setPendingPrivate(null);
    onConfirmActiveChange(false);
  };
  const confirmVisibility = (e: MouseEvent) => {
    // Keep the modal open (showing the pending state) until the mutation lands.
    e.preventDefault();
    if (pendingPrivate === null) return;
    patch.mutate(
      { private: pendingPrivate },
      { onSettled: () => closeConfirm() },
    );
  };

  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const openUnlink = () => {
    setUnlinkOpen(true);
    onConfirmActiveChange(true);
  };
  const closeUnlink = () => {
    setUnlinkOpen(false);
    onConfirmActiveChange(false);
  };
  const confirmUnlink = (e: MouseEvent) => {
    e.preventDefault();
    unlink.mutate(undefined, { onSettled: () => closeUnlink() });
  };

  return (
    <div className="space-y-3">
      {/* Repo + visibility */}
      <div className="flex items-center justify-between gap-2">
        <a
          href={repo.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="group flex min-w-0 items-center gap-1.5 text-sm font-medium text-silver-900"
        >
          <span className="truncate">{repo.fullName}</span>
          <ExternalLinkIcon className="size-3.5 shrink-0 text-silver-600 group-hover:text-silver-900" />
        </a>
        <button
          type="button"
          onClick={openConfirm}
          disabled={patch.isPending}
          title="Change visibility"
          className="flex shrink-0 items-center gap-1 rounded-full border border-silver-400/30 px-2 py-0.5 text-[10px] font-medium text-silver-600 transition-colors hover:text-silver-900 disabled:opacity-50"
        >
          {isPrivate ? (
            <LockIcon className="size-3" />
          ) : (
            <GlobeIcon className="size-3" />
          )}
          {isPrivate ? "Private" : "Public"}
        </button>
      </div>

      {/* Sync status */}
      <div className="flex items-center gap-2 text-xs">
        <CircleDotIcon
          className={cn(
            "size-3",
            info.unpushedChanges > 0 ? "text-amber-400" : "text-green-500",
          )}
        />
        <span className="text-silver-600">{syncLabel(info)}</span>
        <span className="ml-auto text-[10px] text-silver-600">
          {repo.defaultBranch}
        </span>
      </div>

      {/* Last PR + open PRs */}
      {(info.lastPr || info.openPrs.length > 0) && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-silver-600">
            Pull requests
          </p>
          {(info.lastPr
            ? [info.lastPr, ...info.openPrs.filter((p) => p.number !== info.lastPr!.number)]
            : info.openPrs
          )
            .slice(0, 4)
            .map((pr) => {
              const badge = prStateBadge(pr);
              return (
                <a
                  key={pr.number}
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-silver-900 transition-colors hover:bg-space-overlay"
                >
                  <GitPullRequestIcon className="size-3.5 shrink-0 text-silver-600" />
                  <span className="truncate">
                    #{pr.number} {pr.title}
                  </span>
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                      badge.cls,
                    )}
                  >
                    {badge.label}
                  </span>
                </a>
              );
            })}
        </div>
      )}

      <div className="h-px bg-silver-400/20" />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-silver-600">Danger zone</span>
        <button
          type="button"
          onClick={openUnlink}
          disabled={unlink.isPending}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-red-400/90 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
        >
          <Unlink2Icon className="size-3.5" />
          Unlink repository
        </button>
      </div>

      <AlertDialog
        open={unlinkOpen}
        onOpenChange={(o) => {
          if (!o) closeUnlink();
        }}
      >
        <AlertDialogContent
          size="sm"
          className="border-silver-200 bg-space-surface"
        >
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-red-500/10 text-red-400">
              <Unlink2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle className="text-silver-900">
              Unlink repository?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-silver-600">
              This project will be detached from{" "}
              <span className="font-medium text-silver-900">
                {repo.fullName}
              </span>
              . The repository and its history stay on GitHub — only the link
              from this project is removed. You can relink or push again later.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="border-t border-silver-200 bg-space-void/60">
            <AlertDialogCancel
              variant="outline"
              className="border-silver-200 bg-transparent text-silver-600 hover:bg-space-overlay hover:text-silver-900"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={unlink.isPending}
              onClick={confirmUnlink}
              className="bg-red-500/15 text-red-400 hover:bg-red-500/25"
            >
              {unlink.isPending ? "Unlinking…" : "Unlink repository"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingPrivate !== null}
        onOpenChange={(o) => {
          if (!o) closeConfirm();
        }}
      >
        <AlertDialogContent
          size="sm"
          className="border-silver-200 bg-space-surface"
        >
          <AlertDialogHeader>
            <AlertDialogMedia
              className={cn(
                pendingPrivate
                  ? "bg-silver-400/15 text-silver-900"
                  : "bg-amber-500/10 text-amber-400",
              )}
            >
              {pendingPrivate ? (
                <LockIcon />
              ) : (
                <GlobeIcon />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle className="text-silver-900">
              {pendingPrivate
                ? "Make repository private?"
                : "Make repository public?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-silver-600">
              {pendingPrivate ? (
                <>
                  <span className="font-medium text-silver-900">
                    {repo.fullName}
                  </span>{" "}
                  will only be visible to you and its collaborators.
                </>
              ) : (
                <>
                  <span className="font-medium text-silver-900">
                    {repo.fullName}
                  </span>{" "}
                  will be visible to{" "}
                  <span className="text-amber-400">anyone on the internet</span>.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="border-t border-silver-200 bg-space-void/60">
            <AlertDialogCancel
              variant="outline"
              className="border-silver-200 bg-transparent text-silver-600 hover:bg-space-overlay hover:text-silver-900"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={patch.isPending}
              onClick={confirmVisibility}
              className="bg-brand text-primary-foreground hover:bg-brand/90"
            >
              {patch.isPending
                ? "Updating…"
                : pendingPrivate
                  ? "Make private"
                  : "Make public"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
