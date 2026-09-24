import { ExternalLinkIcon, ShieldCheckIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { openAdminConsole, useAdminHealth, useIsAdmin } from "./api";

function Stat({
  label,
  value,
  alarming = false,
}: {
  label: string;
  value: string | number;
  alarming?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-silver-600">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-medium tabular-nums",
          alarming ? "text-amber-400" : "text-silver-900",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * The admin entry point on Home. Renders for nobody but an ADMIN.
 *
 * It shows live health rather than being a bare link, because the question an
 * operator opens the app with is "is anything wrong right now" — and if the
 * answer is no, they should be able to stop reading here instead of opening the
 * console to find out.
 *
 * A failed health call renders the card without numbers rather than hiding it:
 * an admin who can't reach `/admin/health` needs to know that, and it is
 * exactly the moment the console link matters most.
 */
export function AdminHomeCard() {
  const isAdmin = useIsAdmin();
  const { data: health, isLoading, isError } = useAdminHealth(isAdmin);

  if (!isAdmin) return null;

  const degraded = health ? !health.ok : false;

  return (
    <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pt-16">
      <div className="rounded-lg border border-silver-400/30 bg-space-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-brand" />
            <h2 className="text-sm font-medium text-silver-900">Admin</h2>
            {health && (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  degraded
                    ? "border-amber-400/40 text-amber-400"
                    : "border-emerald-400/40 text-emerald-400",
                )}
              >
                {degraded ? "degraded" : "healthy"}
              </span>
            )}
            {isError && (
              <span className="rounded-full border border-silver-400/40 px-2 py-0.5 text-xs text-silver-600">
                unreachable
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => void openAdminConsole()}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-silver-400/30 px-3 py-1.5 text-sm text-silver-900 transition-colors hover:border-silver-400/60 hover:bg-space-overlay"
          >
            Open ops console
            <ExternalLinkIcon className="size-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex min-h-16 items-center justify-center">
            <DataSpinner label="Loading service health" />
          </div>
        ) : health && (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Active" value={`${health.active}/${health.concurrency}`} />
            <Stat
              label="Queued"
              value={health.queueDepth}
              alarming={health.queueDepth > 0}
            />
            <Stat
              label="Stuck"
              value={health.stuckJobs}
              alarming={health.stuckJobs > 0}
            />
            <Stat
              label="Orphan holds"
              value={health.orphanHolds}
              alarming={health.orphanHolds > 0}
            />
            <Stat label="Resident" value={health.residentJobs} />
          </div>
        )}
      </div>
    </section>
  );
}
