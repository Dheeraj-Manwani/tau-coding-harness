import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

/**
 * The standard frame for a full page inside AppShell (Billing, Account, …).
 *
 * - Side gutters match the navbar and footer (`px-6`), so a page's edges line
 *   up with the logo on a phone and never touch the screen edge.
 * - Content is a centred, readable column, so a wide monitor gets margins
 *   instead of cards stretched across the whole screen.
 * - Top padding clears the absolutely-positioned navbar.
 */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl px-6 pt-20 pb-12", className)}>
      {children}
    </div>
  );
}
