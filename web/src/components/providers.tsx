import { type ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "react-hot-toast";

import { ApiError } from "@/src/lib/api-client";
import { TooltipProvider } from "./ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
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
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "#0c0f14",
              color: "#e2e8f0",
              border: "1px solid #1e2532",
              borderRadius: "12px",
              fontSize: "14px",
            },
            success: {
              iconTheme: { primary: "#60a5fa", secondary: "#0c0f14" },
            },
            error: { iconTheme: { primary: "#f87171", secondary: "#0c0f14" } },
          }}
        />
        {children}
      </TooltipProvider>

      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
