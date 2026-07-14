import type { ReactNode } from "react";

import { SparkleParticles } from "@/src/components/ui/star-particles";
import { SiteFooter } from "@/src/components/SiteFooter";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";

// Mirrors the ambient palette used on Home so the auth routes sit inside the
// same cosmos rather than on a bare void.
const STAR_COLORS = [
  "rgba(203, 213, 225, 0.7)",
  "rgba(203, 213, 225, 0.7)",
  "rgba(226, 232, 240, 0.75)",
  "rgba(253, 230, 138, 0.7)",
  "rgba(186, 230, 253, 0.7)",
];

/**
 * Shared shell for every auth route (sign in, sign up, verify). Renders the
 * ambient starfield behind a centred glass card so these pages feel like part
 * of the product instead of a detached form. Reduced-motion users get the calm
 * static star field from index.css only.
 */
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
  const reduceMotion = useReduceMotion();

  return (
    <div className="relative flex min-h-[100svh] flex-col">
      {!reduceMotion && (
        <SparkleParticles
          className="fixed inset-0 -z-10"
          particleColor={STAR_COLORS}
          baseDensity={60}
          maxParticleSize={1.4}
          maxOpacity={0.65}
          minParticleOpacity={0.35}
          maxSpeed={0.4}
          enableShootingStars
        />
      )}

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className={cn("w-full max-w-sm", className)}>
          {/* Soft brand glow pooled behind the card. */}
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-blue-500/10 blur-2xl"
            />

            <div className="rounded-2xl border border-silver-200/70 bg-space-surface/70 p-7 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_20px_60px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-8">
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

              <div className="mt-7">{children}</div>
            </div>
          </div>

          {footer && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {footer}
            </p>
          )}
        </div>
      </div>

      <SiteFooter />
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
