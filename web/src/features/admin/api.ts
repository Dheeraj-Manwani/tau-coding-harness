import { useQuery } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";
import { env } from "@/src/lib/env";
import { useMe } from "@/src/features/auth/queries";

export const adminKeys = {
  health: ["admin", "health"] as const,
};

/** Mirrors `AdminHealth` in `server/src/api/services/admin.service.ts`. */
export interface AdminHealth {
  ok: boolean;
  queueDepth: number;
  active: number;
  concurrency: number;
  residentJobs: number;
  stuckJobs: number;
  activeHolds: number;
  orphanHolds: number;
  uptimeSeconds: number;
  memoryMB: number;
}

/** True when the signed-in account carries the ADMIN role. */
export function useIsAdmin(): boolean {
  const { data: user } = useMe();
  return user?.role === "ADMIN";
}

/**
 * Health for the admin strip on Home.
 *
 * `/admin/*` accepts the ordinary access token as a bearer credential, so this
 * goes through the same axios instance as everything else — no separate client
 * and no admin cookie needed just to read a status dot.
 *
 * `retry: false` is deliberate: the interesting failure is 403 (the role was
 * revoked mid-session), and retrying that just makes the UI slower to admit it.
 */
export function useAdminHealth(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.health,
    queryFn: () => api.get<AdminHealth>("/admin/health").then((r) => r.data),
    enabled,
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/** Absolute URL of the server-rendered console — it lives on the API origin. */
export const ADMIN_CONSOLE_URL = `${env.API_URL}/admin/ui`;

/**
 * Open the ops console, already signed in.
 *
 * The console is a separate server-rendered page on the API origin and
 * authenticates with its own `/admin`-scoped cookie, which a browser tab cannot
 * mint for itself. Exchanging the access token we already hold for that cookie
 * first means an admin who is signed into the app doesn't retype credentials.
 *
 * The blank tab is opened *synchronously*, before any await: popup blockers
 * reject `window.open` once it is no longer inside the click handler's call
 * stack. We then point it at the console once the cookie is set.
 *
 * Every failure here is non-fatal — the console renders its own login box when
 * the cookie is missing, so the worst case is that the operator types a
 * password.
 */
export async function openAdminConsole(): Promise<void> {
  const tab = window.open("", "_blank", "noopener");

  try {
    // withCredentials is on for this instance, and the API allows credentials
    // from APP_URL, so the Set-Cookie lands even cross-origin. The cookie is
    // SameSite=Lax, which still rides a top-level navigation to /admin/ui.
    await api.post("/admin/session", {});
  } catch {
    /* fall through — the console will ask for a password instead */
  }

  if (tab) tab.location.href = ADMIN_CONSOLE_URL;
  // Blocked popup: fall back to navigating this tab rather than doing nothing.
  else window.location.href = ADMIN_CONSOLE_URL;
}
