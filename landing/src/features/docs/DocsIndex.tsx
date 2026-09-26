import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { SearchIcon } from "lucide-react";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { DocsSearch } from "./DocsSearch";
import { useDocsSearchHotkey } from "./useDocsSearchHotkey";
import { NAV_TREE, FLAT_PAGES } from "./navTree";

/**
 * `/docs`: the front door.
 *
 * A card per section, each listing what it actually contains. Sections with no
 * pages yet do not appear at all: the tree is built from the content directory,
 * so this page can only ever advertise docs that exist.
 */
export function DocsIndex() {
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useDocsSearchHotkey(openSearch);

  useDocumentMeta({
    title: "Documentation",
    description: "Guides and reference for building with tau.",
    canonical: "/docs",
  });

  const first = FLAT_PAGES[0];

  return (
    <div className="pb-16">
      <h1 className="text-3xl font-semibold tracking-tight text-silver-900">
        Documentation
      </h1>
      <p className="mt-3 max-w-2xl text-silver-600">
        How tau works, what it costs, and what it deliberately doesn't do.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={openSearch}
          className="flex items-center gap-2 rounded-lg border border-silver-200 px-3 py-2 text-sm text-silver-600 transition-colors hover:border-silver-400 hover:text-silver-900"
        >
          <SearchIcon className="size-3.5" />
          Search the docs
          <kbd className="rounded border border-silver-200 px-1 font-mono text-[0.6rem]">
            ⌘K
          </kbd>
        </button>
        {first && (
          <p className="text-sm text-silver-600">
            New here? Start with{" "}
            <Link to={first.path} className="text-blue-500 hover:underline">
              {first.title}
            </Link>
            .
          </p>
        )}
      </div>

      {NAV_TREE.length === 0 ? (
        <p className="mt-12 text-sm text-silver-600">
          The guides are being written. In the meantime,{" "}
          <a
            href="mailto:support@usetau.dev"
            className="text-blue-500 hover:underline"
          >
            support@usetau.dev
          </a>{" "}
          reaches a human.
        </p>
      ) : (
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {NAV_TREE.map((section) => (
            <div
              key={section.slug}
              className="rounded-2xl border border-silver-200 bg-space-surface p-5 transition-colors hover:border-silver-400"
            >
              <h2 className="text-sm font-semibold text-silver-900">
                {section.title}
              </h2>
              <p className="mt-1 text-sm text-silver-600">{section.blurb}</p>
              <ul className="mt-4 space-y-1.5">
                {section.pages.map((page) => (
                  <li key={page.path}>
                    <Link
                      to={page.path}
                      className="text-sm text-blue-500 hover:underline"
                    >
                      {page.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {searchOpen && <DocsSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

export default DocsIndex;
