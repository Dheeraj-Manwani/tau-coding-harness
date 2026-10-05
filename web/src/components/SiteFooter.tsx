import {
  LANDING_PRICING,
  LANDING_PRIVACY,
  LANDING_TERMS,
} from "@/src/lib/routes";
import { useSupportStore } from "@/src/features/support/useSupportStore";

export function SiteFooter({
  /** The auth pages (login/signup) are a focused, single-task flow - the big
   *  watermark line is a flourish for pages someone lingers on, not one they're
   *  trying to get through quickly. */
  watermark = true,
}: {
  watermark?: boolean;
}) {
  const openSupport = useSupportStore((s) => s.open);
  return (
    <footer className="border-t border-border/50 px-6 py-2">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Tau. All rights reserved.</span>
          <nav className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={openSupport} className="cursor-pointer hover:text-foreground">
              Support tau
            </button>
            <a href={LANDING_PRICING} className="hover:text-foreground">
              Pricing
            </a>
            <a href={LANDING_PRIVACY} className="hover:text-foreground">
              Privacy Policy
            </a>
            <a href={LANDING_TERMS} className="hover:text-foreground">
              Terms &amp; Cancellation
            </a>
            <a
              href="mailto:iammadfortech@gmail.com"
              className="hover:text-foreground"
            >
              Contact
            </a>
          </nav>
        </div>

        {watermark && (
          <p
            aria-hidden="true"
            className="text-hollow display-heading mt-4 overflow-hidden text-nowrap text-[clamp(2rem,9vw,4.5rem)] leading-none select-none"
          >
            Describe it. Build it.
          </p>
        )}
      </div>
    </footer>
  );
}
