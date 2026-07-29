import { Link } from "react-router-dom";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";

/**
 * `/docs` — a placeholder standing on the finished `DocsShell`.
 *
 * The route exists in Phase 0 so the shell, the docs scene and the lazy chunk
 * boundary are all real and verifiable. It is `noIndex` on purpose: an empty
 * docs root that gets crawled before Phase 5 writes the content is worse than
 * no docs root at all. Drop the flag when the pages land.
 */
export function DocsIndex() {
  useDocumentMeta({
    title: "Documentation",
    description: "Guides and reference for building with tau.",
    canonical: "/docs",
    noIndex: true,
  });

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-4 text-silver-600">
        The guides are being written. In the meantime,{" "}
        <Link to="/pricing" className="text-blue-500 hover:underline">
          pricing
        </Link>{" "}
        covers plans and credits, and{" "}
        <a
          href="mailto:support@usetau.dev"
          className="text-blue-500 hover:underline"
        >
          support@usetau.dev
        </a>{" "}
        reaches a human.
      </p>
    </div>
  );
}

export default DocsIndex;
