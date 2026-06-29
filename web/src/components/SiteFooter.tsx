import { Link } from "react-router-dom";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/50 px-6 py-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} Tau. All rights reserved.</span>
        <nav className="flex flex-wrap items-center gap-4">
          <Link to="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link to="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            Terms &amp; Cancellation
          </Link>
          <a href="mailto:support@usetau.dev" className="hover:text-foreground">
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
