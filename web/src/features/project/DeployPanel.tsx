import { motion } from "motion/react";
import { Popover } from "radix-ui";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RocketIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { useProjectStore } from "@/src/stores/useProjectStore";
import { useBalance } from "@/src/features/billing/api";
import { useUpgradeModalStore } from "@/src/features/billing/useUpgradeModalStore";
import {
  formatBytes,
  publishLabel,
  useDeployStatus,
  usePublishProject,
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

/** Colour of the dot on the trigger: green live, amber stale, blue building. */
function dotClass(status: DeployStatus | undefined): string | null {
  if (!status) return null;
  if (status.inProgress) return "bg-blue-500";
  if (!status.live) return null;
  return status.unpublishedChanges > 0 ? "bg-amber-400" : "bg-green-500";
}

export function DeployPanel() {
  const projectId = useProjectStore((s) => s.projectId);
  const { data: status, isLoading } = useDeployStatus(projectId);
  const [open, setOpen] = useState(false);

  const dot = dotClass(status);

  const trigger = (
    <motion.button
      type="button"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label="Publish"
      className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--silver-200)] bg-[var(--space-surface)] text-[var(--silver-900)] transition-colors hover:border-[var(--silver-400)] hover:bg-[var(--space-overlay)]"
    >
      {status?.inProgress ? (
        <LoaderCircleIcon className="size-4.5 animate-spin" />
      ) : (
        <RocketIcon className="size-4.5" />
      )}
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
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-xl border border-silver-400/30 bg-space-surface p-4 text-left shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
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
            <PanelBody projectId={projectId} status={status} />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PanelBody({
  projectId,
  status,
}: {
  projectId: string | null;
  status: DeployStatus;
}) {
  const publish = usePublishProject(projectId);

  // `error` carries whatever the user needs to know about a build; `status`
  // decides whether that reads as a failure or a caveat on a published site.
  const latest = status.deployments[0];
  const failure =
    latest?.status === "FAILED" ? latest.error : null;
  const caveat = status.live?.error ?? null;

  return (
    <div className="space-y-3">
      {status.url ? (
        <LiveUrl url={status.url} live={status.live} />
      ) : (
        <p className="text-xs leading-relaxed text-silver-600">
          Publish your app to a public URL anyone can open. No account, no setup
          needed. Tau builds it and puts it online for you.
        </p>
      )}

      {status.serverWarning && (
        <Notice tone="warning" icon={AlertTriangleIcon}>
          {status.serverWarning}
        </Notice>
      )}

      {failure && (
        <Notice tone="error" icon={XCircleIcon}>
          {failure}
        </Notice>
      )}

      {caveat && (
        <Notice tone="warning" icon={AlertTriangleIcon}>
          {caveat}
        </Notice>
      )}

      <BadgeRow />

      <button
        type="button"
        disabled={status.inProgress || publish.isPending}
        onClick={() => publish.mutate()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.inProgress || publish.isPending ? (
          <>
            <LoaderCircleIcon className="size-4 animate-spin" />
            Publishing…
          </>
        ) : (
          <>
            <RocketIcon className="size-4" />
            {status.live ? "Publish update" : "Publish"}
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-silver-600">
        {publishLabel(status)}
      </p>
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
      <span className="min-w-0">{children}</span>
    </div>
  );
}
