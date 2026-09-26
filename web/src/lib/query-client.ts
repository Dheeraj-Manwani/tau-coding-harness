import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/src/lib/api-client";

/**
 * The app's single QueryClient. Exported as a module singleton (rather than
 * created inside <Providers/>) so non-React code: notably the WS event reducer
 * in useProjectStore: can read and mutate the query cache directly, e.g. to
 * tick the credit balance down live as generation spends it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = error instanceof ApiError ? error.status : 0;
        return status >= 500 && failureCount < 2;
      },
    },
  },
});
