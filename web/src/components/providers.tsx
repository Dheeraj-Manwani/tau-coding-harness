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
              background: "#09090b",
              color: "#fafafa",
              border: "1px solid #27272a",
              borderRadius: "12px",
              fontSize: "14px",
            },
            success: {
              iconTheme: { primary: "#fafafa", secondary: "#09090b" },
            },
            error: { iconTheme: { primary: "#f87171", secondary: "#09090b" } },
          }}
        />
        {children}
        <SuccessCelebration />
      </TooltipProvider>

      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
