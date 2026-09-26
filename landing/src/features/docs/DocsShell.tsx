import { useCallback, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { MenuIcon, SearchIcon, XIcon } from "lucide-react";

import { SiteFooter } from "@/src/components/SiteFooter";
import { cn } from "@/src/lib/utils";
import { useCosmosScene } from "@/src/features/marketing/motion/cosmos";
import { DocsSearch } from "./DocsSearch";
import { useDocsSearchHotkey } from "./useDocsSearchHotkey";
import { DocsSidebar } from "./DocsSidebar";

/**
 * Shell for `/docs/*`.
 *
 * Docs share the marketing sky but turn it down: 40% density, no parallax, no
 * shooting stars. A background that slides while you read is a background that
 * fights the text. Nothing here lights up, arcs or streaks: lightning and
 * comets belong to marketing (§6).
 *
 * On narrow screens the sidebar becomes a drawer rather than disappearing;
 * losing the map on a phone is how a docs site becomes unusable on a phone.
 */
export function DocsShell() {
  useCosmosScene({ density: 0.4, parallax: false, shootingStars: false });

  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);

  // The drawer remembers which page it was opened on, so navigating away closes
  // it by derivation: a drawer that survives navigation covers the page you
  // just asked for, and resetting it from an effect would cost a second render.
  const [drawer, setDrawer] = useState({ open: false, at: pathname });
  const drawerOpen = drawer.open && drawer.at === pathname;
  const setDrawerOpen = (open: boolean) => setDrawer({ open, at: pathname });

  const openSearch = useCallback(() => setSearchOpen(true), []);
  useDocsSearchHotkey(openSearch);

  return (
    <div className="flex min-h-[100svh] flex-col">
      <a
        href="#docs-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[80] focus:rounded-md focus:bg-space-overlay focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50 border-b border-silver-200/60 bg-space-void/70 backdrop-blur-xl">
        <nav
          aria-label="Main"
          className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-3"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(!drawerOpen)}
              aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={drawerOpen}
              className="-ml-1 rounded-md p-1.5 text-silver-600 transition-colors hover:text-silver-900 lg:hidden"
            >
              {drawerOpen ? (
                <XIcon className="size-4" />
              ) : (
                <MenuIcon className="size-4" />
              )}
            </button>
            <Link to="/" className="flex items-center gap-2" aria-label="tau home">
              <span className="logo-mark size-5" role="img" aria-hidden="true" />
              <span className="text-sm font-semibold text-silver-900">tau</span>
            </Link>
            <span className="text-silver-400" aria-hidden="true">
              /
            </span>
            <Link
              to="/docs"
              className="text-sm text-silver-600 hover:text-silver-900"
            >
              Docs
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openSearch}
              className="flex items-center gap-2 rounded-lg border border-silver-200 px-2.5 py-1.5 text-xs text-silver-600 transition-colors hover:border-silver-400 hover:text-silver-900"
            >
              <SearchIcon className="size-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border border-silver-200 px-1 font-mono text-[0.6rem] sm:inline">
                ⌘K
              </kbd>
            </button>
            <Link
              to="/pricing"
              className="hidden text-sm text-silver-600 transition-colors hover:text-silver-900 sm:inline"
            >
              Pricing
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-10 px-6">
        <div
          className={cn(
            "shrink-0 py-10 lg:block lg:w-56",
            drawerOpen
              ? "fixed inset-x-0 bottom-0 top-[57px] z-40 overflow-y-auto bg-space-void px-6"
              : "hidden",
          )}
        >
          <DocsSidebar onNavigate={() => setDrawerOpen(false)} />
        </div>

        <main id="docs-main" className="min-w-0 flex-1 py-10">
          <Outlet />
        </main>
      </div>

      <SiteFooter />

      {searchOpen && <DocsSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

export default DocsShell;
