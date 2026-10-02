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
  SquareMousePointerIcon,
  SwatchBookIcon,
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
import { DeployPanel } from "@/src/features/project/DeployPanel";
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
    <div
      data-tour="view-tabs"
      className="flex shrink-0 gap-1 rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] p-1"
    >
      {TABS.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setActiveTab(id)}
          aria-pressed={activeTab === id}
          className={cn(
            "relative flex h-8 items-center rounded-lg px-3 text-xs font-medium capitalize transition-colors",
            activeTab === id
              ? "text-[var(--space-void)]"
              : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
          )}
        >
          {activeTab === id && (
            <motion.span
              layoutId="tab-pill"
              className="absolute inset-0 rounded-lg bg-[var(--silver-900)] shadow-sm"
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
    <div
      data-tour="device-switcher"
      className="flex shrink-0 gap-1 rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] p-1"
    >
      {DEVICES.map(({ id, icon: Icon, label }) => (
        <motion.button
          key={id}
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={() => setPreviewDevice(id)}
          aria-label={label}
          aria-pressed={previewDevice === id}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg transition-colors",
            previewDevice === id
              ? "bg-[var(--space-overlay)] text-[var(--silver-900)]"
              : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
          )}
        >
          <Icon className="size-3.5" />
        </motion.button>
      ))}
    </div>
  );
}

/**
 * Element picker toggle.
 *
 * Only offered once the in-iframe runtime has announced itself: an older
 * project whose sandbox predates the tagger has no runtime, and a dead toggle
 * is worse than no toggle. `visualEditReady` is reset on every iframe remount.
 *
 * The copy says "ask about" rather than "edit": what a selection does first is
 * open a prompt box (doc/archive/VISUAL_EDIT_PROMPTING.md), with the deterministic
 * editor one click further in.
 */
function VisualEditToggle() {
  const ready = useProjectStore((s) => s.visualEditReady);
  const enabled = useProjectStore((s) => s.visualEditEnabled);
  const setEnabled = useProjectStore((s) => s.setVisualEditEnabled);

  if (!ready) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setEnabled(!enabled)}
          aria-label="Select an element"
          data-tour="select-element"
          aria-pressed={enabled}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-colors",
            enabled
              ? "bg-[var(--space-overlay)] text-[var(--blue-500)]"
              : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
          )}
        >
          <SquareMousePointerIcon className="size-4" />
        </motion.button>
      </TooltipTrigger>
      <TooltipContent>
        {enabled ? "Stop selecting" : "Select an element to ask about it"}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Global theme editing. Sits beside the element picker because it is the same
 * feature at a different scale: one click here restyles every element that uses
 * a theme token, rather than the one element under the cursor.
 *
 * Unlike the picker this needs no in-iframe runtime: it edits `src/index.css`
 * directly: so it is offered whenever there is a preview at all.
 */
function ThemeToggle() {
  const open = useProjectStore((s) => s.themePanelOpen);
  const setOpen = useProjectStore((s) => s.setThemePanelOpen);
  const previewUrl = useProjectStore((s) => s.previewUrl);

  if (!previewUrl) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setOpen(!open)}
          aria-label="Edit theme"
          data-tour="theme-editor"
          aria-pressed={open}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-colors",
            open
              ? "bg-[var(--space-overlay)] text-[var(--blue-500)]"
              : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
          )}
        >
          <SwatchBookIcon className="size-4" />
        </motion.button>
      </TooltipTrigger>
      <TooltipContent>{open ? "Close theme" : "Edit theme"}</TooltipContent>
    </Tooltip>
  );
}

function UrlBar() {
  const previewUrl = useProjectStore((s) => s.previewUrl);
  const previewPath = useProjectStore((s) => s.previewPath);
  const reloadPreview = useProjectStore((s) => s.reloadPreview);
  const setPreviewPath = useProjectStore((s) => s.setPreviewPath);
  const hasUrl = Boolean(previewUrl);

  // While the user is typing, the input shows their draft; the committed path
  // is only replaced on Enter. `null` means "not editing: show the real path".
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
      className="flex min-w-0 flex-1 items-center gap-2"
      data-tour="url-bar"
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
            className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:text-[var(--silver-900)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCwIcon className="size-3.5" />
          </motion.button>
        </TooltipTrigger>
        <TooltipContent>Reload preview</TooltipContent>
      </Tooltip>

      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          value={hasUrl ? value : ""}
          disabled={!hasUrl}
          spellCheck={false}
          autoComplete="off"
          // The origin is a generated sandbox hostname: not useful in the bar,
          // but worth having on hover and for copy/paste.
          title={fullUrl ?? undefined}
          placeholder={hasUrl ? "/" : "No preview yet: tau will build one"}
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
          aria-label="Preview path"
          className="h-9 w-full rounded-lg border border-[var(--silver-200)] bg-[var(--space-surface)] px-3 font-mono text-xs text-[var(--silver-900)] transition-colors placeholder:font-sans placeholder:text-[var(--silver-600)] focus:border-[var(--silver-400)] focus:outline-none focus:ring-2 focus:ring-white/5 disabled:cursor-default disabled:text-[var(--silver-600)]"
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
            className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:text-[var(--silver-900)] disabled:cursor-not-allowed disabled:opacity-40"
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
    <div className="flex h-full min-w-0 flex-col bg-[var(--space-void)]">
      <div className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[var(--silver-200)] px-4 py-2.5">
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

        <div className="flex-1" />
        {activeTab === "preview" && <VisualEditToggle />}
        {activeTab === "preview" && <ThemeToggle />}
        {activeTab === "preview" && <DeviceSwitcher />}

        <div className="mx-0.5 h-6 w-px shrink-0 bg-[var(--silver-200)]" />

        <div
          className="flex items-center gap-1"
          aria-label="Project sharing and publishing"
          data-tour="ship"
        >
          <GithubPanel />
          <DeployPanel />
        </div>
        <UserMenu />
      </div>

      <AnimatePresence initial={false}>
        {activeTab === "preview" && (
          <motion.div
            key="preview-navigation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex shrink-0 items-center border-b border-[var(--silver-200)] px-4 py-2"
          >
            <UrlBar />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="min-h-0 flex-1">
        {/* Keep the iframe mounted while Code is open. Unmounting it made a
            simple tab round-trip navigate the preview again and replay the
            post-load shimmer even though the already-loaded page was usable. */}
        <div
          className={cn(
            "h-full bg-black",
            activeTab !== "preview" && "hidden",
          )}
          aria-hidden={activeTab !== "preview"}
        >
          <PreviewPane
            device={previewDevice}
            active={activeTab === "preview"}
          />
        </div>

        {activeTab === "code" && (
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
