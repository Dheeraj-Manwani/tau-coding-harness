import { Link, Outlet } from "react-router-dom";

import { SiteFooter } from "@/src/components/SiteFooter";
import { Button } from "@/src/components/ui/button";
import { useCosmosScene } from "@/src/features/marketing/motion/cosmos";

/**
 * Shell for the public marketing surfaces (`/`, and later `/pricing` and
 * `/changelog`).
 *
 * Unlike `AppShell` this is a normal document-flow page, not a `100svh` box
 * with an inner scroller — the landing page's parallax reads `window.scrollY`,
 * which only moves if the document itself scrolls.
 *
 * The navbar below is structural. §4.0's real one — glass-on-scroll, the
 * Product mega-panel, the magnetic CTA — lands in Phase 1, along with the
 * expanded five-column footer from §4.13.
 */
export function MarketingShell() {
  useCosmosScene({ density: 1, parallax: true });

  return (
    <div className="flex min-h-[100svh] flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-space-overlay focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50">
        <nav
          aria-label="Main"
          className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-4"
        >
          <Link to="/" className="flex items-center gap-2" aria-label="tau home">
            <span className="logo-mark size-6" role="img" aria-hidden="true" />
            <span className="text-sm font-semibold text-silver-900">tau</span>
          </Link>

          <div className="flex items-center gap-1 text-sm text-silver-600">
            <Link
              to="/docs"
              className="rounded-md px-3 py-1.5 transition-colors hover:text-silver-900"
            >
              Docs
            </Link>
            <Link
              to="/pricing"
              className="rounded-md px-3 py-1.5 transition-colors hover:text-silver-900"
            >
              Pricing
            </Link>
            <Link
              to="/login"
              className="rounded-md px-3 py-1.5 transition-colors hover:text-silver-900"
            >
              Sign in
            </Link>
            <Button asChild size="sm" className="ml-2">
              <Link to="/signup">Start building</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}

export default MarketingShell;
