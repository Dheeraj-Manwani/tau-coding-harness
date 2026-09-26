import {
  LANDING_PRICING,
  LANDING_PRIVACY,
  LANDING_TERMS,
} from "@/src/lib/routes";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/50 px-6 py-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} Tau. All rights reserved.</span>
        <nav className="flex flex-wrap items-center gap-4">
          <a href={LANDING_PRICING} className="hover:text-foreground">
            Pricing
          </a>
          <a href={LANDING_PRIVACY} className="hover:text-foreground">
            Privacy Policy
          </a>
          <a href={LANDING_TERMS} className="hover:text-foreground">
            Terms &amp; Cancellation
          </a>
          <a href="mailto:support@usetau.dev" className="hover:text-foreground">
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
