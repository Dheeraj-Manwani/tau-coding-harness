import type { ReactNode } from "react";

import { SiteFooter } from "@/src/components/SiteFooter";
import { AmbientStars } from "@/src/components/AmbientStars";
import { cn } from "@/src/lib/utils";

/** Neutral, centered account card shared by the authentication routes. */
export function AuthLayout({
  icon,
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {

  return (
    <div className="relative flex min-h-[100svh] flex-col">
      <AmbientStars />

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className={cn("w-full max-w-sm", className)}>
          <div className="relative">

            <div className="rounded-xl border border-border bg-background p-6 shadow-xl">
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 flex items-center gap-2">
                  {icon ?? <span className="logo-mark size-9" />}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
                {subtitle && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>

              <div className="mt-6">{children}</div>
            </div>
          </div>

          {footer && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {footer}
            </p>
          )}
        </div>
      </div>

      <SiteFooter watermark={false} />
    </div>
  );
}

/**
 * Thin horizontal "or" separator shared by the sign-in / sign-up forms.
 */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-silver-600">
      <span className="h-px flex-1 bg-silver-400/30" />
      {label}
      <span className="h-px flex-1 bg-silver-400/30" />
    </div>
  );
}
