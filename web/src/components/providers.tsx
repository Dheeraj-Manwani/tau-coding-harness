import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "react-hot-toast";

import { queryClient } from "@/src/lib/query-client";
import { TooltipProvider } from "./ui/tooltip";
import { SuccessCelebration } from "./SuccessCelebration";

export function Providers({ children }: { children: ReactNode }) {
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
        <SuccessCelebration />
      </TooltipProvider>

      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
