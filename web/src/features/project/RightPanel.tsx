import { Suspense, lazy } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import {
  CodeIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PanelLeftOpenIcon,
  RotateCwIcon,
  SmartphoneIcon,
  TabletIcon,
  TvMinimalIcon,
  Unlink2Icon,
} from "lucide-react";

import { cn } from "@/src/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { UserMenu } from "@/src/components/UserMenu";
import {
  useGithubStatus,
  useDisconnectGithub,
  useGithubReturnToast,
  startGithubConnect,
} from "@/src/features/auth/github";
import {
  useProjectStore,
  type PreviewDevice,
  type Tab,
} from "@/src/stores/useProjectStore";
import { PreviewPane } from "@/src/features/project/PreviewPane";

// Lazy so the editor's heavy deps (syntax highlighter + file icons) only load
// when the Code tab is first opened, not on initial project render.
const CodePane = lazy(() =>
  import("@/src/features/project/CodePane").then((m) => ({
    default: m.CodePane,
  })),
);

const TABS: { id: Tab; icon: typeof CodeIcon }[] = [
  { id: "preview", icon: TvMinimalIcon },
  { id: "code", icon: CodeIcon },
];

const DEVICES: {
  id: PreviewDevice;
  icon: typeof MonitorIcon;
  label: string;
}[] = [
  { id: "mobile", icon: SmartphoneIcon, label: "Mobile" },
  { id: "tablet", icon: TabletIcon, label: "Tablet" },
  { id: "desktop", icon: MonitorIcon, label: "Desktop" },
];

function TabToggle() {
  const activeTab = useProjectStore((s) => s.activeTab);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const isWriting = useProjectStore((s) => s.writingPath !== null);

  return (
    <div className="flex gap-1 rounded-[var(--radius-lg)] border border-[var(--silver-200)] bg-[var(--space-surface)] p-1">
      {TABS.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setActiveTab(id)}
          className={cn(
            "relative rounded-[var(--radius-md)] px-3 py-1 text-xs font-medium capitalize transition-colors",
            activeTab === id
              ? "text-[var(--silver-900)]"
              : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
          )}
        >
          {activeTab === id && (
            <motion.span
              layoutId="tab-pill"
              className="absolute inset-0 rounded-[var(--radius-md)] bg-[var(--space-overlay)]"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1.5">
            {id === "code" && isWriting ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <Icon className="size-3.5" />
            )}
            {id}
          </span>
        </button>
      ))}
    </div>
  );
}

function DeviceSwitcher() {
  const previewDevice = useProjectStore((s) => s.previewDevice);
  const setPreviewDevice = useProjectStore((s) => s.setPreviewDevice);

  return (
    <div className="flex gap-1 rounded-[var(--radius-lg)] border border-[var(--silver-200)] bg-[var(--space-surface)] p-1">
      {DEVICES.map(({ id, icon: Icon, label }) => (
        <motion.button
          key={id}
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={() => setPreviewDevice(id)}
          aria-label={label}
          className={cn(
            "flex size-6 items-center justify-center rounded-[var(--radius-md)] transition-colors",
            previewDevice === id
              ? "bg-[var(--space-overlay)] text-[var(--blue-500)]"
              : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
          )}
        >
          <Icon className="size-3.5" />
        </motion.button>
      ))}
    </div>
  );
}

// lucide-react 1.x dropped brand marks, so the GitHub logo is inlined here.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GithubButton() {
  useGithubReturnToast();
  const { data: status } = useGithubStatus();
  const disconnect = useDisconnectGithub();
  const connected = status?.connected ?? false;

  const trigger = (
    <motion.button
      type="button"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={
        connected
          ? `GitHub connected as ${status?.username}`
          : "Connect GitHub"
      }
      onClick={connected ? undefined : startGithubConnect}
      className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--silver-200)] bg-[var(--space-surface)] text-[var(--silver-900)] transition-colors hover:border-[var(--silver-400)] hover:bg-[var(--space-overlay)]"
    >
      <GithubMark className="size-4.5" />
      {connected && (
        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--space-void)] bg-green-500" />
      )}
    </motion.button>
  );

  // Not connected: a plain button that kicks off the OAuth consent flow.
  if (!connected) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent>Connect GitHub</TooltipContent>
      </Tooltip>
    );
  }

  // Connected: a dropdown showing the linked account with a Disconnect action.
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-56 rounded-lg border border-silver-400/30 bg-space-surface p-1 text-left shadow-xl"
        >
          <div className="px-3 py-2.5">
            <p className="text-xs text-silver-600">GitHub connected as</p>
            <p className="truncate text-sm font-medium text-silver-900">
              {status?.username}
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-silver-400/20" />
          <DropdownMenu.Item
            onSelect={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-silver-900 outline-none select-none data-[highlighted]:bg-space-overlay data-[disabled]:opacity-50"
          >
            <Unlink2Icon className="size-4" />
            Disconnect
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function UrlBar() {
  const previewUrl = useProjectStore((s) => s.previewUrl);
  const reloadPreview = useProjectStore((s) => s.reloadPreview);
  const hasUrl = Boolean(previewUrl);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="flex flex-1 items-center gap-2"
    >
      <div className="relative flex flex-1 items-center">
        <input
          readOnly
          value={previewUrl ?? ""}
          placeholder="No preview yet — tau will build one"
          onClick={(e) => e.currentTarget.select()}
          className="w-full cursor-default rounded-[var(--radius-md)] border border-[var(--silver-400)] bg-[var(--space-overlay)] py-1.5 pl-3 pr-8 text-xs text-[var(--silver-600)] focus:outline-none"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.button
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ rotate: 180 }}
              disabled={!hasUrl}
              onClick={() => hasUrl && reloadPreview()}
              aria-label="Reload preview"
              className="absolute right-1.5 flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--silver-600)] transition-colors hover:text-(--silver-900) disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCwIcon className="size-3.5" />
            </motion.button>
          </TooltipTrigger>
          <TooltipContent>Reload preview</TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1 }}
            disabled={!hasUrl}
            onClick={() => previewUrl && window.open(previewUrl, "_blank")}
            aria-label="Open in new tab"
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:text-[var(--silver-900)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ExternalLinkIcon className="size-4" />
          </motion.button>
        </TooltipTrigger>
        <TooltipContent>Open in new tab</TooltipContent>
      </Tooltip>
    </motion.div>
  );
}

export function RightPanel() {
  const activeTab = useProjectStore((s) => s.activeTab);
  const previewDevice = useProjectStore((s) => s.previewDevice);
  const isChatOpen = useProjectStore((s) => s.isChatOpen);
  const toggleChat = useProjectStore((s) => s.toggleChat);

  return (
    <div className="flex h-full flex-col bg-[var(--space-void)]">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--silver-200)] bg-[var(--space-void)]/70 px-3 py-2 backdrop-blur-md">
        {!isChatOpen && (
          <motion.button
            type="button"
            onClick={toggleChat}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.92 }}
            aria-label="Open chat"
            className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
          >
            <PanelLeftOpenIcon className="size-4.5" />
          </motion.button>
        )}

        <TabToggle />

        <AnimatePresence initial={false}>
          {activeTab === "preview" && <UrlBar key="url-bar" />}
        </AnimatePresence>

        {activeTab !== "preview" && <div className="flex-1" />}
        {activeTab === "preview" && <DeviceSwitcher />}

        <div className="mx-0.5 h-6 w-px shrink-0 bg-[var(--silver-200)]" />

        <GithubButton />
        <UserMenu />
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === "preview" ? (
          <PreviewPane device={previewDevice} />
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center bg-[var(--space-void)] text-sm text-[var(--silver-600)]">
                Loading editor…
              </div>
            }
          >
            <CodePane />
          </Suspense>
        )}
      </div>
    </div>
  );
}
