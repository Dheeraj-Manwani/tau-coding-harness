import { Suspense, lazy, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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
} from "lucide-react";

import { cn } from "@/src/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { UserMenu } from "@/src/components/UserMenu";
import { GithubPanel } from "@/src/features/project/GithubPanel";
import {
  useProjectStore,
  type PreviewDevice,
  type Tab,
} from "@/src/stores/useProjectStore";
import { PreviewPane } from "@/src/features/project/PreviewPane";
import { previewSrc } from "@/src/features/project/previewUrl";

// Lazy so the editor's heavy deps (CodeMirror + file icons) only load when the
// Code tab is first opened, not on initial project render.
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

function UrlBar() {
  const previewUrl = useProjectStore((s) => s.previewUrl);
  const previewPath = useProjectStore((s) => s.previewPath);
  const reloadPreview = useProjectStore((s) => s.reloadPreview);
  const setPreviewPath = useProjectStore((s) => s.setPreviewPath);
  const hasUrl = Boolean(previewUrl);

  // While the user is typing, the input shows their draft; the committed path
  // is only replaced on Enter. `null` means "not editing — show the real path".
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? previewPath;

  const fullUrl = previewSrc(previewUrl, previewPath);

  const commit = () => {
    if (!hasUrl) return;
    setPreviewPath(value);
    setDraft(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="flex flex-1 items-center gap-2"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1 }}
            whileTap={{ rotate: 180 }}
            disabled={!hasUrl}
            onClick={() => hasUrl && reloadPreview()}
            aria-label="Reload preview"
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:text-[var(--silver-900)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCwIcon className="size-3.5" />
          </motion.button>
        </TooltipTrigger>
        <TooltipContent>Reload preview</TooltipContent>
      </Tooltip>

      <div className="relative flex flex-1 items-center">
        <input
          value={hasUrl ? value : ""}
          disabled={!hasUrl}
          spellCheck={false}
          autoComplete="off"
          // The origin is a generated sandbox hostname — not useful in the bar,
          // but worth having on hover and for copy/paste.
          title={fullUrl ?? undefined}
          placeholder={hasUrl ? "/" : "No preview yet — tau will build one"}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          // Abandon an uncommitted edit rather than leave the bar showing a path
          // the preview was never sent to.
          onBlur={() => setDraft(null)}
          className="w-full rounded-[var(--radius-md)] border border-[var(--silver-400)] bg-[var(--space-overlay)] py-1.5 pl-3 pr-3 text-xs text-[var(--silver-900)] transition-colors placeholder:text-[var(--silver-600)] focus:border-[var(--blue-500)] focus:outline-none disabled:cursor-default disabled:text-[var(--silver-600)]"
        />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1 }}
            disabled={!hasUrl}
            onClick={() => fullUrl && window.open(fullUrl, "_blank")}
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

        <GithubPanel />
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
