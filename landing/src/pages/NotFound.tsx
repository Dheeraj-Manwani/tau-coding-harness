import { Link, useLocation, useNavigate } from "react-router-dom";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { StormCanvas } from "@/src/features/marketing/sections/StormCanvas";

/**
 * The catch-all 404.
 *
 * Reuses the storm hero's own canvas (rain, ambient lightning) and its
 * `tube-flicker` keyframe - the "0" lights with the exact animation the hero
 * uses for "Build it.", just slower, so a mistyped link still feels like part
 * of the same weather system instead of a stock error page.
 *
 * Routed inside `MarketingShell`, so the real nav/footer still frame it.
 * `noIndex` because a soft 404 that crawlers index is worse than one they
 * skip: this is a client-rendered SPA, so the server has already answered 200.
 */
function NotFound() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useDocumentMeta({
    title: "Page not found",
    description: "There's no page at this address.",
    noIndex: true,
  });

  return (
    <div
      className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-6 py-20 text-center"
      style={{ background: "#02030a" }}
    >
      <StormCanvas rain mode="LOW" className="opacity-90" />

      <p className="mono absolute right-6 top-6 z-10 text-silver-600">
        GET {pathname} → 404
      </p>

      <div className="relative z-10 flex flex-col items-center">
        <div className="digit-404" aria-hidden="true">
          <span className="digit-hollow">4</span>
          <span className="digit-glow" data-text="0">
            0
          </span>
          <span className="digit-hollow">4</span>
        </div>

        <h1 className="display-heading mt-6 text-4xl text-silver-900 sm:text-6xl">
          Lost in the storm
        </h1>
        <p className="mt-4 max-w-md text-silver-600">
          This page doesn't exist, or it moved. Your projects are safe, and the
          way back is clear.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="rounded-lg bg-[#ff7a2e] px-5 py-2.5 text-sm font-semibold text-[#160700] shadow-[0_0_24px_rgba(255,122,46,0.35)] transition-transform hover:-translate-y-0.5"
          >
            Back to home
          </Link>
          {/* <button
            type="button"
            onClick={() =>
              window.history.length > 1 ? navigate(-1) : navigate("/")
            }
            className="rounded-lg border border-silver-200 px-5 py-2.5 text-sm text-silver-900 transition-colors hover:border-silver-400"
          >
            Strike again ↻
          </button> */}
        </div>
      </div>
    </div>
  );
}

export default NotFound;
