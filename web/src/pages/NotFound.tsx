import { Link } from "react-router-dom";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { LANDING_DOCS } from "@/src/lib/routes";

function NotFound() {
  useDocumentMeta({
    title: "Page not found",
    description: "There's no app page at this address.",
    noIndex: true,
  });

  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 py-16 text-center">
      <span className="logo-mark logo-shimmer size-16" aria-hidden="true" />
      <p className="mt-6 font-mono text-xs uppercase tracking-[0.18em] text-blue-500">
        404
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-silver-900">
        There's nothing at this app address
      </h1>
      <p className="mt-3 max-w-sm text-sm text-silver-600">
        The project may have moved, or the link may be out of date.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
        <Link
          to="/"
          className="rounded-lg border border-silver-200 px-4 py-2 text-silver-900 transition-colors hover:border-silver-400"
        >
          Back to projects
        </Link>
        <a href={LANDING_DOCS} className="text-blue-500 hover:underline">
          Read the docs
        </a>
      </div>
    </div>
  );
}

export default NotFound;
