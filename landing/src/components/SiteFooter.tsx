import { Link } from "react-router-dom";
import { SupportTauButton } from "@/src/components/SupportTauButton";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/50 px-6 py-2">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Tau. All rights reserved.</span>
          <nav className="flex flex-wrap items-center gap-4">
            <SupportTauButton className="cursor-pointer hover:text-foreground" />
            <Link to="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Terms &amp; Cancellation
            </Link>
            <a href="mailto:iammadfortech@gmail.com" className="hover:text-foreground">
              Contact
            </a>
          </nav>
        </div>

        <p
          aria-hidden="true"
          className="text-hollow display-heading mt-4 overflow-hidden text-nowrap text-[clamp(2rem,9vw,4.5rem)] leading-none select-none"
        >
          Describe it. Build it.
        </p>
      </div>
    </footer>
  );
}
