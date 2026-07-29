import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { OrbitRing } from "@/src/features/marketing/motion/OrbitRing";
import { loadSearchIndex, searchDocs, type SearchDoc } from "./search";

/**
 * ⌘K search over the docs.
 *
 * The index loads the first time the overlay opens and is cached for the
 * session. The list is keyboard-first — arrows move, Enter opens, Escape
 * closes — because that is the only way anyone uses a ⌘K palette.
 *
 * Mounted only while open (see `DocsShell`), so the query and cursor are fresh
 * every time it appears without anything having to reset them.
 */
export function DocsSearch({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<SearchDoc[] | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadSearchIndex().then((loaded) => {
      if (!cancelled) setDocs(loaded);
    });
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const hits = useMemo(
    () => (docs ? searchDocs(docs, query) : []),
    [docs, query],
  );

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-space-void/70 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Search the documentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-silver-200 bg-space-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-silver-200 px-4">
          <SearchIcon className="size-4 shrink-0 text-silver-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (event.key === "Enter" && hits[cursor]) {
                event.preventDefault();
                go(hits[cursor]!.doc.path);
              }
            }}
            placeholder="Search the docs…"
            aria-label="Search the docs"
            className="w-full bg-transparent py-4 text-sm text-silver-900 placeholder:text-silver-600 focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-silver-200 px-1.5 py-0.5 font-mono text-[0.65rem] text-silver-600">
            esc
          </kbd>
        </div>

        {query.trim() === "" ? (
          <div className="flex flex-col items-center gap-3 py-12 text-sm text-silver-600">
            <OrbitRing size={72} periodSeconds={22} />
            <p>Search guides, reference and limits.</p>
          </div>
        ) : hits.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-silver-600">
            {docs === null
              ? "Loading the index…"
              : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : (
          <ul className="max-h-[52vh] overflow-y-auto p-2">
            {hits.map((hit, i) => (
              <li key={hit.doc.path}>
                <button
                  type="button"
                  onClick={() => go(hit.doc.path)}
                  onPointerEnter={() => setCursor(i)}
                  aria-current={i === cursor ? "true" : undefined}
                  className={cn(
                    "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                    i === cursor ? "bg-space-overlay" : "hover:bg-space-overlay/60",
                  )}
                >
                  <span className="block text-sm font-medium text-silver-900">
                    {hit.doc.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-silver-600">
                    {hit.excerpt}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DocsSearch;
