import { Link } from "react-router-dom";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { TauWatermark } from "@/src/features/marketing/motion/TauWatermark";

/**
 * The catch-all 404.
 *
 * Was an unstyled `<h1>` and a link — off-brand in a way that reads as broken
 * rather than as a missing page, which matters now that `/` is a public link
 * people paste and mistype. Mirrors `DocsNotFound` so the two feel like one site,
 * but offers the three destinations a stranger is most likely to want rather than
 * the docs sidebar.
 *
 * `noIndex` because a soft 404 that crawlers index is worse than one they skip:
 * this is a client-rendered SPA, so the server has already answered 200.
 */
function NotFound() {
  useDocumentMeta({
    title: "Page not found",
    description: "There's no page at this address.",
    noIndex: true,
  });

  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 py-16 text-center">
      <TauWatermark size={88} opacity={0.14} />

      <p className="mt-6 font-mono text-xs uppercase tracking-[0.18em] text-blue-500">
        404
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-silver-900">
        There's nothing at this address
      </h1>
      <p className="mt-3 max-w-sm text-sm text-silver-600">
        The link may be out of date, or the page may never have existed.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
        <Link
          to="/"
          className="rounded-lg border border-silver-200 px-4 py-2 text-silver-900 transition-colors hover:border-silver-400"
        >
          Go home
        </Link>
        <Link
          to="/docs"
          className="rounded-lg border border-silver-200 px-4 py-2 text-silver-900 transition-colors hover:border-silver-400"
        >
          Read the docs
        </Link>
        <a
          href="mailto:support@usetau.dev"
          className="text-blue-500 hover:underline"
        >
          Report a broken link
        </a>
      </div>
    </div>
  );
}

export default NotFound;
