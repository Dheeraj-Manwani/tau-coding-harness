/**
 * The one place "which effort does the next turn run at" is decided.
 *
 * Two composers (Home and the project chat) and now the visual-edit inspector
 * all start a job, and they must agree: a user who picked MAX in the composer
 * would not expect an element prompt to quietly run at LOW.
 *
 * The answer is derived, never mirrored:
 *
 *   effort = lastEffort ?? planDefault ?? "LOW"
 *
 * `lastEffort` is the user's own choice and is persisted. `planDefault` is the
 * silent upgrade paid plans get *until* they choose for themselves, which is
 * why it is a separate field rather than a write into `lastEffort`: writing
 * there would make the upgrade look like a choice and stick forever.
 */
import { useEffect } from "react";

import { useBalance } from "@/src/features/billing/api";
import type { Effort } from "@/src/features/project/types";
import { getPreferences } from "@/src/features/settings/preferences";
import { useSettings } from "@/src/hooks/useSettings";
import { useSettingsStore } from "@/src/stores/useSettingsStore";

function resolve(last: Effort | null, plan: Effort | null): Effort {
  return last ?? plan ?? "LOW";
}

/**
 * The effort a send should use, read outside React.
 *
 * For senders with no dropdown of their own (the inspector prompt). Safe
 * because `ChatPanel` is mounted for the whole life of a project page: the
 * collapse control resizes its panel to zero rather than unmounting it: so
 * `planDefault` has been resolved by the time anything can be selected.
 */
export function currentEffort(): Effort {
  const { planDefault } = useSettingsStore.getState();
  return resolve(getPreferences().lastEffort ?? null, planDefault);
}

/** Effort plus its setter, for a composer that shows the dropdown. */
export function useEffortChoice(): {
  effort: Effort;
  setEffort: (next: Effort) => void;
} {
  const { lastEffort, setLastEffort } = useSettings();
  const planDefault = useSettingsStore((s) => s.planDefault);
  const setPlanDefault = useSettingsStore((s) => s.setPlanDefault);
  const { data: balance } = useBalance();

  useEffect(() => {
    if (balance === undefined) return;
    setPlanDefault(balance.plan === "FREE" ? "LOW" : "HIGH");
  }, [balance, setPlanDefault]);

  return { effort: resolve(lastEffort, planDefault), setEffort: setLastEffort };
}
