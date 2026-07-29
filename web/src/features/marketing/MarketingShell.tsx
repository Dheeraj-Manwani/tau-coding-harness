import { Outlet } from "react-router-dom";

import { MarketingFooter } from "@/src/features/marketing/MarketingFooter";
import { MarketingNav } from "@/src/features/marketing/MarketingNav";
import { useCosmosScene } from "@/src/features/marketing/motion/cosmos";

/**
 * Shell for the public marketing surfaces (`/`, and later `/pricing` and
 * `/changelog`).
 *
 * Unlike `AppShell` this is a normal document-flow page, not a `100svh` box
 * with an inner scroller — the parallax and the glass-on-scroll navbar both
 * read `window.scrollY`, which only moves if the document itself scrolls.
 */
export function MarketingShell() {
  useCosmosScene({ density: 1, parallax: true, shootingStars: true });

  return (
    <div className="flex min-h-[100svh] flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-space-overlay focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <MarketingNav />

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <MarketingFooter />
    </div>
  );
}

export default MarketingShell;
