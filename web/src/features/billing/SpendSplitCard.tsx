import { DataSpinner } from "@/src/components/ui/data-spinner";
import { useSpend } from "./api";

/**
 * Building vs deployed-app AI, over the last 30 days.
 *
 * Two very different things spend from one balance and only one of them used to
 * be visible: every rollup read `TokenUsage`, which covers builds alone. A user
 * whose deployed app was burning credits saw the number fall with nothing on the
 * page accounting for it.
 */
export function SpendSplitCard() {
  const { data, isLoading } = useSpend();

  if (isLoading) {
    return (
      <div className="flex min-h-20 items-center justify-center rounded-xl border bg-card p-5">
        <DataSpinner label="Loading credit usage" />
      </div>
    );
  }
  if (!data || data.total.credits <= 0) return null;

  const build = data.build.credits;
  const runtime = data.runtime.credits;
  const buildPct = (build / (build + runtime)) * 100;

  const rows = [
    { label: "Building", value: build, swatch: "bg-foreground/70" },
    { label: "Your apps' AI", value: runtime, swatch: "bg-blue-500/70" },
  ];

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Where your credits went</h2>
        <span className="text-xs text-muted-foreground">
          last {data.windowDays} days
        </span>
      </div>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-blue-500/70" aria-hidden>
        <div className="bg-foreground/70" style={{ width: `${buildPct}%` }} />
      </div>

      <div className="mt-3 space-y-1.5 text-sm">
        {rows.map(({ label, value, swatch }) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${swatch}`} aria-hidden />
            <span className="text-muted-foreground">{label}</span>
            <span className="ml-auto tabular-nums">{value.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
