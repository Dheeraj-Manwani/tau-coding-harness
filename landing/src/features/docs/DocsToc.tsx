import { useEffect, useState } from "react";

import { cn } from "@/src/lib/utils";
import type { TocEntry } from "./loader";

/**
 * The right-rail "On this page", with scroll-spy.
 *
 * Uses an `IntersectionObserver` with a band across the upper third of the
 * viewport rather than tracking scroll offsets by hand: it costs nothing while
 * you are not moving, and it does not fight smooth scrolling the way a
 * scroll-listener does.
 *
 * The active heading is the last one to have crossed the top of that band, not
 * simply the topmost intersecting one: otherwise a short section sandwiched
 * between two long ones never lights up.
 */
export function DocsToc({ entries }: { entries: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;
    const seen = new Map<string, boolean>();

    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          seen.set(record.target.id, record.isIntersecting);
        }
        // Walk in document order; the deepest heading that has passed the band
        // is the one being read.
        let current: string | null = null;
        for (const entry of entries) {
          if (seen.get(entry.id)) {
            current = entry.id;
            break;
          }
        }
        if (current) setActiveId(current);
      },
      { rootMargin: "-88px 0px -70% 0px", threshold: 0 },
    );

    for (const entry of entries) {
      const element = document.getElementById(entry.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <nav aria-label="On this page" className="sticky top-24">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-silver-400">
        On this page
      </p>
      <ul className="mt-3 space-y-1.5 border-l border-silver-200">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              aria-current={activeId === entry.id ? "location" : undefined}
              className={cn(
                "-ml-px block border-l py-0.5 text-sm transition-colors",
                entry.level === 3 ? "pl-6" : "pl-3",
                activeId === entry.id
                  ? "border-blue-500 text-silver-900"
                  : "border-transparent text-silver-600 hover:text-silver-900",
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default DocsToc;
