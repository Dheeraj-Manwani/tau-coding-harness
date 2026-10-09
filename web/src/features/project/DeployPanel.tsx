import { motion } from "motion/react";
import { Popover } from "radix-ui";
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RocketIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { useProjectStore } from "@/src/stores/useProjectStore";
import { useBalance } from "@/src/features/billing/api";
import { useUpgradeModalStore } from "@/src/features/billing/useUpgradeModalStore";
import { useSendMessage } from "@/src/features/project/useSendMessage";
import { BuyCredits, IdentitySection } from "@/src/features/project/IdentitySection";
import {
  deployedAgo,
  formatBytes,
  historyLabel,
  publishFailureError,
  publishLabel,
  useDeployStatus,
  usePublishProject,
  useRollbackDeploy,
  useUnpublish,
  type DeployFailure,
  type DeployStatus,
  type DeploymentSummary,
} from "@/src/features/project/deploy";

/**
 * The Publish button and its panel.
 *
 * Deliberately the same shape as the GitHub panel next to it: a status dot on
 * a round trigger, a popover with the current state and one primary action -
 * because they answer the same question ("where has this code gone?") and
 * should not need to be learned twice.
 */

/** Colour of the dot on the trigger: green live, amber stale, blue building, red suspended. */
function dotClass(status: DeployStatus | undefined): string | null {
  if (!status) return null;
  if (status.suspended) return "bg-red-500";
  if (status.inProgress) return "bg-blue-500";
  if (!status.live) return null;
  return status.unpublishedChanges > 0 ? "bg-amber-400" : "bg-green-500";
}

export function DeployPanel() {
  const projectId = useProjectStore((s) => s.projectId);
  const { data: status, isLoading } = useDeployStatus(projectId);
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const publishRequested = searchParams.get("publish") === "1";

  const dot = dotClass(status);

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (publishRequested) {
      const next = new URLSearchParams(searchParams);
      next.delete("publish");
      setSearchParams(next, { replace: true });
    }
  };

  const trigger = (
    <motion.button
      type="button"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      aria-label="Publish"
      className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-blue-500 px-3.5 text-sm font-semibold text-blue-900 shadow-[0_0_16px_rgba(96,165,250,0.35)] transition-colors hover:bg-blue-400"
    >
      {status?.inProgress ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : (
        <RocketIcon className="size-4" />
      )}
      Publish
      {dot && !status?.inProgress && (
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
      open={open || publishRequested}
      onOpenChange={onOpenChange}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto rounded-xl border border-silver-400/30 bg-space-surface p-4 text-left shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Popover.Arrow className="fill-space-surface" />
          <div className="mb-3 flex items-center gap-2">
            <RocketIcon className="size-4 text-silver-900" />
            <span className="font-heading text-sm font-medium text-silver-900">
              Publish
            </span>
          </div>

          {isLoading || !status ? (
            <div className="flex items-center gap-2 py-6 text-sm text-silver-600">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <PanelBody
              projectId={projectId}
              status={status}
              onClose={() => onOpenChange(false)}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PanelBody({
  projectId,
  status,
  onClose,
}: {
  projectId: string | null;
  status: DeployStatus;
  onClose: () => void;
}) {
  const publish = usePublishProject(projectId);
  const { data: balance } = useBalance();

  // The first publish of a project is paid for, so the button says what it costs
  // and, when the balance cannot cover it, gives way to buying credits. Only
  // known once the balance has loaded: until then it is not called short.
  const fee = status.publishFee;
  const feeDue = fee.due && !status.live;
  const short = feeDue && balance !== undefined && balance.credits.available < fee.credits;

  // A failed publish leaves the previous build serving, so a failure and a
  // caveat on the live site can both be true at once.
  const caveat = status.live?.error ?? null;
  const suspended = status.suspended;
  const busy = status.inProgress || publish.isPending;

  return (
    <div className="space-y-3">
      {status.url ? (
        <LiveUrl url={status.url} live={suspended ? null : status.live} />
      ) : (
        <p className="text-xs leading-relaxed text-silver-600">
          Publish your app to a public URL anyone can open. No account, no setup
          needed. Tau builds it and puts it online for you.
        </p>
      )}

      {suspended && (
        <Notice tone="error" icon={BanIcon}>
          Tau has suspended this site, so visitors see a notice instead of your
          app.
          {suspended.reason && (
            <span className="mt-1 block text-red-100">{suspended.reason}</span>
          )}
        </Notice>
      )}

      {status.serverWarning && (
        <Notice tone="warning" icon={AlertTriangleIcon}>
          {status.serverWarning}
        </Notice>
      )}

      {status.lastFailure && (
        <FailureNotice
          projectId={projectId}
          failure={status.lastFailure}
          onSent={onClose}
        />
      )}

      {caveat && (
        <Notice tone="warning" icon={AlertTriangleIcon}>
          {caveat}
        </Notice>
      )}

      <BadgeRow />

      <IdentitySection projectId={projectId} />

      <button
        type="button"
        disabled={busy || !!suspended || short}
        onClick={() => publish.mutate()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <>
            <LoaderCircleIcon className="size-4 animate-spin" />
            Publishing…
          </>
        ) : (
          <>
            <RocketIcon className="size-4" />
            {status.live
              ? "Publish update"
              : feeDue
                ? `Publish · ${fee.credits} credits`
                : "Publish"}
          </>
        )}
      </button>
      {feeDue && balance !== undefined && (
        <p className="text-center text-[11px] text-silver-600">
          First publish of a project. Updates are free. Balance{" "}
          {Math.floor(balance.credits.available)}.
        </p>
      )}
      {short && <BuyCredits>Publishing needs {fee.credits} credits.</BuyCredits>}

      <p className="text-center text-[11px] text-silver-600">
        {publishLabel(status)}
      </p>

      <History projectId={projectId} status={status} />

      {status.live && <TakeOffline projectId={projectId} />}
    </div>
  );
}

/**
 * The newest publish failed. The same one-click fix the preview offers for a
 * build error: the error and the end of the build log go to tau in a block the
 * chat does not show, behind one plain sentence.
 *
 * Once the project has changed since the failure the button goes: whatever was
 * wrong may already be fixed, and the next step is to publish again.
 */
function FailureNotice({
  projectId,
  failure,
  onSent,
}: {
  projectId: string | null;
  failure: DeployFailure;
  onSent: () => void;
}) {
  const setChatOpen = useProjectStore((s) => s.setChatOpen);
  const { send, canSend, isSending } = useSendMessage(projectId ?? undefined);

  if (failure.changedSince) {
    return (
      <Notice tone="warning" icon={AlertTriangleIcon}>
        The last publish failed, and the project has changed since. Publish
        again to try the new version.
      </Notice>
    );
  }

  const fix = () => {
    const sent = send(
      "Publishing failed. Fix what stops the production build so the app can be published.",
      { buildError: publishFailureError(failure) },
    );
    if (!sent) return;
    // The answer arrives in the chat, so get this panel out of its way.
    setChatOpen(true);
    onSent();
  };

  return (
    <Notice tone="error" icon={XCircleIcon}>
      {failure.error}
      <button
        type="button"
        onClick={fix}
        disabled={!canSend}
        title={
          canSend
            ? "Send this error to tau"
            : "tau is already working on something"
        }
        className="mt-2 flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:hover:bg-brand"
      >
        {isSending ? (
          <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <WrenchIcon className="size-3.5" />
        )}
        Fix with tau
      </button>
    </Notice>
  );
}

/**
 * The last few publishes, with a way back to any that can still be served.
 *
 * Closed by default: most visits to this panel are to publish or copy the
 * link, and the list is only interesting on the day something went wrong.
 * Rolling back has no confirmation because it destroys nothing: the build it
 * replaces stays in this same list, one click from being live again.
 */
function History({
  projectId,
  status,
}: {
  projectId: string | null;
  status: DeployStatus;
}) {
  const [open, setOpen] = useState(false);
  const rollback = useRollbackDeploy(projectId);

  if (status.deployments.length === 0) return null;

  const blocked = status.inProgress || !!status.suspended || rollback.isPending;

  return (
    <div className="border-t border-silver-400/20 pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md px-1 py-1 text-[11px] font-medium text-silver-600 transition-colors hover:text-silver-900"
      >
        History
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul className="mt-1 max-h-44 space-y-0.5 overflow-y-auto">
          {status.deployments.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-md px-1 py-1.5 text-[11px]"
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  d.isLive
                    ? "bg-green-500"
                    : d.status === "FAILED"
                      ? "bg-red-500"
                      : "bg-silver-400",
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-silver-900">{historyLabel(d)}</span>
                <span className="text-silver-600">
                  {" · "}
                  {deployedAgo(d.createdAt)}
                  {d.sizeBytes > 0 && ` · ${formatBytes(d.sizeBytes)}`}
                </span>
              </span>
              {d.canRollback && (
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => rollback.mutate(d.id)}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-silver-400/30 px-1.5 py-0.5 font-medium text-silver-900 transition-colors hover:bg-space-overlay disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rollback.isPending && rollback.variables === d.id && (
                    <LoaderCircleIcon className="size-3 animate-spin" />
                  )}
                  {status.live ? "Roll back" : "Restore"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Taking the site offline, behind a second click.
 *
 * It is undoable (the build stays in the history for a week, and publishing
 * again is always possible), but for as long as it lasts every link the owner
 * has shared is dead, which is worth one sentence before it happens.
 */
function TakeOffline({ projectId }: { projectId: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const unpublish = useUnpublish(projectId);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="block w-full rounded-md py-1 text-center text-[11px] text-silver-600 transition-colors hover:text-red-300"
      >
        Take offline
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-2.5">
      <p className="text-[11px] leading-relaxed text-red-200">
        Take this site offline? The link stops working until you publish again.
        The address stays yours.
      </p>
      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          disabled={unpublish.isPending}
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-silver-900 transition-colors hover:bg-space-overlay disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={unpublish.isPending}
          onClick={() => unpublish.mutate()}
          className="flex items-center gap-1 rounded-md bg-red-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-400 disabled:opacity-60"
        >
          {unpublish.isPending && (
            <LoaderCircleIcon className="size-3 animate-spin" />
          )}
          Take offline
        </button>
      </div>
    </div>
  );
}

/**
 * Free plan only: says the published site carries the "Built with tau" badge
 * and offers the way to remove it. Pro sites have no badge, so nothing to say.
 */
function BadgeRow() {
  const { data: balance } = useBalance();
  const openUpgrade = useUpgradeModalStore((s) => s.openModal);
  if (balance?.plan !== "FREE") return null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-silver-400/20 bg-space-void/40 px-3 py-2">
      <span className="text-[11px] leading-relaxed text-silver-600">
        Shows a “Built with tau” badge
      </span>
      <button
        type="button"
        onClick={() => openUpgrade("Upgrade to Pro to remove this badge")}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-silver-900 transition-colors hover:bg-space-overlay"
      >
        Remove
        <span className="rounded-full bg-brand/10 px-1.5 py-px text-[10px] font-semibold text-brand">
          PRO
        </span>
      </button>
    </div>
  );
}

function LiveUrl({
  url,
  live,
}: {
  url: string;
  live: DeploymentSummary | null;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  // Hostname alone is the readable form; the full URL stays in the link target
  // and on the clipboard.
  const display = url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="rounded-lg border border-silver-400/20 bg-space-void/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        {live ? (
          <CheckCircle2Icon className="size-3.5 text-green-500" />
        ) : (
          <AlertTriangleIcon className="size-3.5 text-amber-400" />
        )}
        <span className="text-[11px] text-silver-600">
          {live ? "Live at" : "Reserved address"}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-sm font-medium text-silver-900 underline-offset-2 hover:underline"
        >
          {display}
        </a>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy link"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-silver-600 transition-colors hover:bg-space-overlay hover:text-silver-900"
        >
          <CopyIcon className="size-3.5" />
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open site"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-silver-600 transition-colors hover:bg-space-overlay hover:text-silver-900"
        >
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>

      {live && (
        <p className="mt-1.5 text-[11px] text-silver-600">
          {live.fileCount} files · {formatBytes(live.sizeBytes)}
        </p>
      )}
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: "warning" | "error";
  icon: typeof AlertTriangleIcon;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border p-2.5 text-[11px] leading-relaxed",
        tone === "warning"
          ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
          : "border-red-500/25 bg-red-500/10 text-red-200",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
