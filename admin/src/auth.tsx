import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, post, UNAUTHORIZED_EVENT } from "@/lib/api";
import type { Me } from "@/types";

type AuthState =
  | { status: "loading" }
  | { status: "in"; me: Me }
  /** `reason` explains *why* we're out, when there is something to say. */
  | { status: "out"; reason?: "expired" | "revoked" | "not_admin" | "unreachable" };

interface AuthContextValue {
  state: AuthState;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session = the server's HttpOnly `/admin` cookie, set by the Google round
 * trip. This app can't read it; it only asks `/admin/me` who it is. Any 401/403
 * from any page (see lib/api.ts) drops back to the sign-in screen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    api<Me>("/me")
      .then((me) => setState({ status: "in", me }))
      .catch((err: unknown) => {
        const status = err instanceof ApiError ? err.status : 0;
        // 403 on the very first probe means a valid session whose account is
        // no longer ADMIN — distinct from simply never having signed in.
        setState({ status: "out", reason: status === 403 ? "revoked" : status === 0 ? "unreachable" : undefined });
      });

    const onUnauthorized = (e: Event) => {
      const code = (e as CustomEvent<number>).detail;
      setState({ status: "out", reason: code === 403 ? "revoked" : "expired" });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signOut = useCallback(async () => {
    await post("/session/end").catch(() => {});
    setState({ status: "out" });
  }, []);

  return <AuthContext.Provider value={{ state, signOut }}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
