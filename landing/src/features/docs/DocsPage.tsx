import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { ChatLoader } from "@/src/components/ui/tau-loader";
import { DocsNotFound } from "./DocsNotFound";
import { DocsToc } from "./DocsToc";
import { Markdown } from "./markdown/Markdown";
import { loadDoc, readingMinutes, tableOfContents, type LoadedDoc } from "./loader";
import { findPage, neighbours } from "./navTree";
import { sectionBySlug } from "./sections";

/**
 * One documentation page.
 *
 * The body is fetched per page rather than bundled with the shell, so reading
 * one doc never downloads forty. While it is in flight the page keeps its
 * chrome: breadcrumb, title, meta line: and only the body shows a loader:
 * the header is known from the nav index before the markdown arrives, so there
 * is nothing to wait for and nothing to shift.
 */
export function DocsPage() {
  const { section = "", slug = "" } = useParams();
  const key = `${section}/${slug}`;

  /**
   * The loaded body is stored with the key it belongs to, so navigating to
   * another page discards the previous one by derivation rather than by an
   * effect that clears state: which would render the old doc's body under the
   * new doc's title for a frame.
   */
  const [loaded, setLoaded] = useState<{
    key: string;
    doc: LoadedDoc | null;
    missing: boolean;
  }>({ key: "", doc: null, missing: false });

  const doc = loaded.key === key ? loaded.doc : null;
  const missing = loaded.key === key && loaded.missing;

  const navPage = findPage(section, slug);
  const sectionMeta = sectionBySlug(section);
  const { previous, next } = neighbours(`/docs/${section}/${slug}`);

  useEffect(() => {
    let cancelled = false;
    loadDoc(section, slug)
      .then((result) => {
        if (!cancelled) {
          setLoaded({ key, doc: result, missing: result === null });
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, doc: null, missing: true });
      });
    return () => {
      cancelled = true;
    };
  }, [section, slug, key]);

  const toc = useMemo(
    () => (doc ? tableOfContents(doc.body) : []),
    [doc],
  );

  const title = doc?.frontmatter.title ?? navPage?.title ?? "";
  const description = doc?.frontmatter.description ?? navPage?.description ?? "";

  useDocumentMeta({
    title: title || "Documentation",
    description,
    canonical: `/docs/${section}/${slug}`,
  });

  if (missing) return <DocsNotFound />;

  return (
    <div className="flex w-full gap-10">
      <article className="min-w-0 flex-1 pb-16">
        <nav aria-label="Breadcrumb" className="text-xs text-silver-600">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link to="/docs" className="hover:text-silver-900">
                Docs
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-silver-900">
              {sectionMeta?.title ?? section}
            </li>
          </ol>
        </nav>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-silver-900">
          {title || <span className="opacity-0">Loading</span>}
        </h1>

        {description && (
          <p className="mt-3 text-silver-600">{description}</p>
        )}

        {doc && (
          <p className="mt-4 flex flex-wrap items-center gap-3 font-mono text-xs text-silver-400">
            {doc.frontmatter.updated && (
              <span>Updated {doc.frontmatter.updated}</span>
            )}
            <span>{readingMinutes(doc.body)} min read</span>
          </p>
        )}

        <hr className="mt-6 border-silver-200" />

        {doc ? (
          <Markdown>{doc.body}</Markdown>
        ) : (
          <div className="py-16">
            <ChatLoader text="Loading" />
          </div>
        )}

        {(previous || next) && (
          <nav
            aria-label="Pagination"
            className="mt-16 grid gap-3 border-t border-silver-200 pt-6 sm:grid-cols-2"
          >
            {previous ? (
              <Link
                to={previous.path}
                className="group rounded-xl border border-silver-200 p-4 transition-colors hover:border-silver-400"
              >
                <span className="flex items-center gap-1.5 text-xs text-silver-600">
                  <ArrowLeftIcon className="size-3" />
                  Previous
                </span>
                <span className="mt-1 block text-sm font-medium text-silver-900">
                  {previous.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link
                to={next.path}
                className="group rounded-xl border border-silver-200 p-4 text-right transition-colors hover:border-silver-400 sm:col-start-2"
              >
                <span className="flex items-center justify-end gap-1.5 text-xs text-silver-600">
                  Next
                  <ArrowRightIcon className="size-3" />
                </span>
                <span className="mt-1 block text-sm font-medium text-silver-900">
                  {next.title}
                </span>
              </Link>
            )}
          </nav>
        )}

        <p className="mt-10 text-sm text-silver-600">
          Still stuck?{" "}
          <a
            href="mailto:support@usetau.dev"
            className="text-blue-500 hover:underline"
          >
            Email support
          </a>
          .
        </p>
      </article>

      <aside className="hidden w-56 shrink-0 xl:block">
        <DocsToc entries={toc} />
      </aside>
    </div>
  );
}

export default DocsPage;
