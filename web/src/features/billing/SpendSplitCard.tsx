import { HammerIcon, SparklesIcon } from "lucide-react";

import { DataSpinner } from "@/src/components/ui/data-spinner";
import { useSpend } from "./api";

function Bar({ build, runtime }: { build: number; runtime: number }) {
  const total = build + runtime;
  if (total <= 0) return null;
  const buildPct = (build / total) * 100;

  return (
    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
      <div
        className="bg-foreground/70"
        style={{ width: `${buildPct}%` }}
        aria-hidden
      />
      <div className="flex-1 bg-blue-500/70" aria-hidden />
    </div>
  );
}

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

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Where your credits went</h2>
        <span className="text-xs text-muted-foreground">
          last {data.windowDays} days
        </span>
      </div>

      <Bar build={data.build.credits} runtime={data.runtime.credits} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-1.5">
            <HammerIcon className="size-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Building</span>
          </div>
          <p className="mt-1 font-mono text-lg">
            {data.build.credits.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">
            tau writing and fixing your apps
          </p>
        </div>

        <div>
          <div className="flex items-center gap-1.5">
            <SparklesIcon className="size-3.5 text-blue-500" />
            <span className="text-xs text-muted-foreground">App AI usage</span>
          </div>
          <p className="mt-1 font-mono text-lg">
            {data.runtime.credits.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">
            {data.runtime.requests.toLocaleString()}{" "}
            {data.runtime.requests === 1 ? "call" : "calls"} from apps you built
          </p>
        </div>
      </div>

      {data.runtime.byModel.length > 0 && (
        <div className="mt-4 space-y-1 border-t pt-3">
          {data.runtime.byModel.map((m) => (
            <div
              key={m.alias}
              className="flex items-baseline justify-between text-xs"
            >
              <code className="font-mono text-muted-foreground">{m.alias}</code>
              <span className="text-muted-foreground">
                {m.requests.toLocaleString()} ×{" "}
                <span className="font-mono">{m.credits.toFixed(2)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
