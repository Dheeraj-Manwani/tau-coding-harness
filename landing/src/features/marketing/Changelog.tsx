import { useEffect, useState } from "react";
import { LinkIcon } from "lucide-react";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { ChatLoader } from "@/src/components/ui/tau-loader";
import { Markdown } from "@/src/features/docs/markdown/Markdown";
import { MeteorDivider } from "@/src/features/marketing/motion/MeteorDivider";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";
import { loadChangelog, type ChangelogEntry } from "./changelog";

/**
 * `/changelog`: every entry on one page, newest first.
 *
 * Rendered with the docs' `Markdown` rather than a second renderer: an entry is
 * prose with lists and the occasional code fence, which is exactly what that
 * component already handles, and sharing it means a callout looks the same here
 * as it does in the docs.
 *
 * One page rather than a route per entry. A changelog is read by scrolling, and
 * per-entry routes would trade that for a navigation on every item plus a
 * sitemap that grows a URL per release for no search value.
 */

/** `2026-07-30` → `30 July 2026`. Parsed as UTC so it cannot shift a day. */
function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Entry({ entry }: { entry: ChangelogEntry }) {
  return (
    <ScrollReveal>
      <article className="group grid gap-x-10 gap-y-3 md:grid-cols-[9rem_minmax(0,1fr)]">
        {/* Sticky only from md up: on a phone the date would pin itself over
            the prose it belongs to. */}
        <div className="md:sticky md:top-24 md:self-start">
          <time
            dateTime={entry.date}
            className="font-mono text-xs text-silver-400"
          >
            {formatDate(entry.date)}
          </time>
        </div>

        <div className="min-w-0">
          <h2
            id={entry.id}
            className="scroll-mt-24 text-xl font-semibold text-silver-900"
          >
            {entry.title}
            <a
              href={`#${entry.id}`}
              aria-label={`Link to ${entry.title}`}
              className="ml-2 inline-block align-middle text-silver-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <LinkIcon className="size-3.5" />
            </a>
          </h2>
          <Markdown>{entry.body}</Markdown>
        </div>
      </article>
    </ScrollReveal>
  );
}

export function Changelog() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);

  useDocumentMeta({
    title: "Changelog",
    description:
      "What shipped in tau, and when: every release, newest first.",
    canonical: "/changelog",
  });

  useEffect(() => {
    let cancelled = false;
    loadChangelog()
      .then((loaded) => {
        if (!cancelled) setEntries(loaded);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-20">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          Changelog
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-silver-900 sm:text-4xl">
          What shipped, and when.
        </h1>
        <p className="mt-4 max-w-2xl text-silver-600">
          Every release, newest first. For what tau does and doesn&apos;t do
          today, the{" "}
          <a href="/docs" className="text-blue-500 hover:underline">
            documentation
          </a>{" "}
          is the current answer.
        </p>
      </header>

      <MeteorDivider className="my-12" />

      {/* Waiting on one small fetch, so a fixed-height reservation would be a
          guess at a list length that varies. The loader occupies the space
          instead, and nothing above it can shift. */}
      {entries === null ? (
        <div className="py-16">
          <ChatLoader text="Loading" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-silver-600">Nothing here yet.</p>
      ) : (
        <div className="flex flex-col gap-16">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

export default Changelog;
