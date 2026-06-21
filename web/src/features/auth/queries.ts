import { useQuery } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";
import type { AuthUser } from "./types";

export const authKeys = {
  me: ["auth", "me"] as const,
};

/**
 * The single source of truth for "who is logged in". A 401 (after the silent
 * refresh attempt in the axios interceptor) resolves to `undefined` rather than
 * retrying — guards read that to decide redirects.
 */
export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: () => api.get<{ user: AuthUser }>("/auth/me").then((r) => r.data),
    select: (d) => d.user,
    retry: false,
    staleTime: 5 * 60_000,
  });
}
