import { LockIcon } from "lucide-react";

import { KeysPane } from "@/src/features/project/KeysPane";

export function ToolsPane({ projectId }: { projectId: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--space-void)] sm:flex-row">
      <nav
        aria-label="Project tools"
        className="shrink-0 border-b border-[var(--silver-200)] bg-[var(--space-surface)] p-3 sm:w-44 sm:border-r sm:border-b-0 lg:w-48"
      >
        <p className="mb-3 px-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-[var(--silver-600)]">
          Setup
        </p>
        <button
          type="button"
          aria-current="page"
          aria-controls="project-secrets"
          className="flex h-9 w-full items-center gap-2.5 rounded-lg bg-[var(--space-overlay)] px-3 text-xs font-medium text-[var(--silver-900)] focus-visible:outline-2 focus-visible:outline-ring"
        >
          <LockIcon className="size-4 shrink-0" />
          Secrets
        </button>
      </nav>
      <section id="project-secrets" aria-label="Secrets" className="min-h-0 min-w-0 flex-1">
        <KeysPane projectId={projectId} />
      </section>
    </div>
  );
}
