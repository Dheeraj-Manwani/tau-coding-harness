import { Link } from "react-router-dom";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { TauWatermark } from "@/src/features/marketing/motion/TauWatermark";

/**
 * The docs 404 (§6): "you're off the map".
 *
 * Kept inside the docs shell so the sidebar is still there: the most useful
 * thing to offer someone who followed a dead link is the map, not a dead end.
 */
export function DocsNotFound() {
  useDocumentMeta({
    title: "Page not found",
    description: "That documentation page doesn't exist.",
    noIndex: true,
  });

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center py-16 text-center">
      <TauWatermark size={72} opacity={0.14} />
      <h1 className="mt-6 text-2xl font-semibold text-silver-900">
        You're off the map
      </h1>
      <p className="mt-3 max-w-sm text-sm text-silver-600">
        There's no page at this address. It may have moved, or it may not be
        written yet.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
        <Link
          to="/docs"
          className="rounded-lg border border-silver-200 px-4 py-2 text-silver-900 transition-colors hover:border-silver-400"
        >
          Back to the docs
        </Link>
        <a
          href="mailto:support@usetau.dev"
          className="text-blue-500 hover:underline"
        >
          Tell us what you were looking for
        </a>
      </div>
    </div>
  );
}

export default DocsNotFound;
