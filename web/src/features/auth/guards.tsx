import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { SplashScreen } from "@/src/components/SplashScreen";
import { refreshOnce } from "@/src/lib/api-client";
import { useMe } from "./queries";

/**
 * Runs the one-time silent refresh before the router decides anything. Without
 * this, a logged-in user is bounced to /login on every reload, because the
 * in-memory access token always starts null. The refresh cookie (httpOnly,
 * survives reloads) lets us mint a fresh access token and know who we are.
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    refreshOnce().finally(() => setReady(true));
  }, []);
  if (!ready) return <SplashScreen />;
  return <>{children}</>;
}

/**
 * Protected zone. Guests are sent to /login (remembering where they were);
 * authenticated-but-unverified users can't enter the platform — they're routed
 * to /verify-pending until they confirm their email.
 */
export function RequireAuth() {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!user.emailVerifiedAt) return <Navigate to="/verify-pending" replace />;
  return <Outlet />;
}

/** Public-only zone: authenticated users can't see login/signup — send home. */
export function RequireGuest() {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <SplashScreen />;
  if (user) {
    const from = (location.state as { from?: Location } | null)?.from;
    return <Navigate to={from?.pathname ?? "/"} replace />;
  }
  return <Outlet />;
}

/**
 * The /verify-pending holding area: only for authenticated users who haven't
 * verified yet. Guests go to /login; already-verified users go home.
 */
export function RequireUnverified() {
  const { data: user, isLoading } = useMe();
  if (isLoading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerifiedAt) return <Navigate to="/" replace />;
  return <Outlet />;
}
