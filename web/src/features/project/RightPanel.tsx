import { Suspense, lazy } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CodeIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PanelLeftOpenIcon,
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
const MOCK_URL = "https://tau-app.local/";

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
            <Icon className="size-3.5" />
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
    <div className="flex gap-1">
      {DEVICES.map(({ id, icon: Icon, label }) => (
        <motion.button
          key={id}
          type="button"
          whileHover={{ scale: 1.1 }}
          onClick={() => setPreviewDevice(id)}
          aria-label={label}
          className={cn(
            "flex size-7 items-center justify-center rounded-[var(--radius-md)] transition-colors",
            previewDevice === id
              ? "bg-[var(--space-overlay)] text-[var(--blue-500)]"
              : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
          )}
        >
          <Icon className="size-4" />
        </motion.button>
      ))}
    </div>
  );
}

function UrlBar() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="flex flex-1 items-center gap-2"
    >
      <input
        readOnly
        value={MOCK_URL}
        onClick={(e) => e.currentTarget.select()}
        className="w-full flex-1 cursor-default rounded-[var(--radius-md)] border border-[var(--silver-400)] bg-[var(--space-overlay)] px-3 py-1.5 text-xs text-[var(--silver-600)] focus:outline-none"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1 }}
            onClick={() => window.open(MOCK_URL, "_blank")}
            aria-label="Open in new tab"
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:text-[var(--silver-900)]"
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
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--silver-200)] px-3 py-2">
        {!isChatOpen && (
          <motion.button
            type="button"
            onClick={toggleChat}
            whileHover={{ scale: 1.1 }}
            aria-label="Open chat"
            className="flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
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
