import { useState, type ComponentType } from "react";
import { GlobeIcon, HardDriveIcon, LockIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { DomainsPane } from "@/src/features/project/DomainsPane";
import { KeysPane } from "@/src/features/project/KeysPane";
import { StoragePane } from "@/src/features/project/StoragePane";

interface ToolEntry {
  id: string;
  label: string;
  icon: typeof LockIcon;
  group: string;
  pane: ComponentType<{ projectId: string }>;
}

/** One line per tool: the navigation, the heading and the pane all come from here. */
const TOOLS: ToolEntry[] = [
  { id: "secrets", label: "Secrets", icon: LockIcon, group: "Setup", pane: KeysPane },
  { id: "storage", label: "Storage", icon: HardDriveIcon, group: "Setup", pane: StoragePane },
  { id: "domains", label: "Domains", icon: GlobeIcon, group: "Publish", pane: DomainsPane },
];

export function ToolsPane({ projectId }: { projectId: string }) {
  const [toolId, setToolId] = useState(TOOLS[0]!.id);
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]!;
  const Pane = tool.pane;

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--space-void)] sm:flex-row">
      <nav
        aria-label="Project tools"
        className="shrink-0 border-b border-[var(--silver-200)] bg-[var(--space-surface)] p-3 sm:w-44 sm:border-r sm:border-b-0 lg:w-48"
      >
        {TOOLS.map((item, i) => (
          <div key={item.id}>
            {(i === 0 || TOOLS[i - 1]!.group !== item.group) && (
              <p className={cn("mb-3 px-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-[var(--silver-600)]", i > 0 && "mt-4")}>
                {item.group}
              </p>
            )}
            <button
              type="button"
              aria-current={tool.id === item.id ? "page" : undefined}
              aria-controls={`project-${item.id}`}
              onClick={() => setToolId(item.id)}
              className={cn(
                "mb-1 flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring",
                tool.id === item.id
                  ? "bg-[var(--space-overlay)] text-[var(--silver-900)]"
                  : "text-[var(--silver-600)] hover:bg-[var(--space-overlay)]/60 hover:text-[var(--silver-900)]",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </button>
          </div>
        ))}
      </nav>
      <section id={`project-${tool.id}`} aria-label={tool.label} className="min-h-0 min-w-0 flex-1">
        <Pane projectId={projectId} />
      </section>
    </div>
  );
}
