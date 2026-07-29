import { Link, Outlet } from "react-router-dom";

import { SiteFooter } from "@/src/components/SiteFooter";
import { useCosmosScene } from "@/src/features/marketing/motion/cosmos";

/**
 * Shell for `/docs/*`.
 *
 * Docs share the marketing sky but turn it down: 40% density, no parallax. A
 * background that slides while you read is a background that fights the text.
 * Nothing here lights up, arcs or streaks — lightning and comets belong to
 * marketing (§6).
 *
 * The landmarks (`nav` / `main` / `aside`, skip link) are load-bearing and real
 * now so the keyboard order is right from the start. What fills them —
 * collapsible sidebar with the sliding active rule, scroll-spy table of
 * contents, breadcrumbs, prev/next — is Phase 4.
 */
export function DocsShell() {
  useCosmosScene({ density: 0.4, parallax: false, shootingStars: false });

  return (
    <div className="flex min-h-[100svh] flex-col">
      <a
        href="#docs-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-space-overlay focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50 border-b border-silver-200/60 bg-space-void/70 backdrop-blur-xl">
        <nav
          aria-label="Main"
          className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6 py-3"
        >
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-2" aria-label="tau home">
              <span className="logo-mark size-5" role="img" aria-hidden="true" />
              <span className="text-sm font-semibold text-silver-900">tau</span>
            </Link>
            <span className="text-silver-400" aria-hidden="true">
              /
            </span>
            <Link to="/docs" className="text-sm text-silver-600 hover:text-silver-900">
              Docs
            </Link>
          </div>

          <Link
            to="/pricing"
            className="text-sm text-silver-600 transition-colors hover:text-silver-900"
          >
            Pricing
          </Link>
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-6">
        {/* Phase 4: section tree with the layoutId active rule. */}
        <nav
          aria-label="Documentation"
          className="hidden w-56 shrink-0 py-10 lg:block"
        />

        <main id="docs-main" className="min-w-0 flex-1 py-10">
          <Outlet />
        </main>

        {/* Phase 4: "On this page" scroll-spy. */}
        <aside aria-label="On this page" className="hidden w-56 shrink-0 py-10 xl:block" />
      </div>

      <SiteFooter />
    </div>
  );
}

export default DocsShell;
