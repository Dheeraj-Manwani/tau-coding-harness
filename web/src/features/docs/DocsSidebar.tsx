import { useLayoutEffect, useRef, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import { NAV_TREE } from "./navTree";

/**
 * The docs sidebar.
 *
 * A real `<nav>` of real links with `aria-current="page"` on the active one, so
 * a screen reader can answer "where am I" without seeing the blue rule.
 *
 * The rule is one absolutely-positioned element whose offset and height are
 * measured from the active link and written straight to its style, with a CSS
 * transition doing the sliding. The obvious implementation is Framer's
 * `layoutId`, and it was the first one here — but `motion` is otherwise absent
 * from the docs bundle, and pulling in 38KB gzipped of animation library on
 * every documentation page to slide a 2px bar is not a trade a reader would
 * make. Twenty lines of measurement is.
 *
 * Sections start expanded when they contain the current page and collapsed
 * otherwise, so arriving deep in the tree shows you your surroundings rather
 * than the whole map.
 */
export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const reduceMotion = useReduceMotion();
  const currentSection = pathname.split("/")[2] ?? "";

  const listRef = useRef<HTMLUListElement>(null);
  const ruleRef = useRef<HTMLSpanElement>(null);
  const placedRef = useRef(false);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isOpen = (slug: string) => !(collapsed[slug] ?? slug !== currentSection);

  // Layout effect, not effect: the rule must be in place in the same paint as
  // the newly active link, or it visibly starts from the wrong row.
  useLayoutEffect(() => {
    const list = listRef.current;
    const rule = ruleRef.current;
    if (!list || !rule) return;

    const active = list.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!active) {
      rule.style.opacity = "0";
      return;
    }

    // `offsetTop` is already measured against `list` — it is the nearest
    // positioned ancestor, which is exactly why the list is `relative`.
    // Subtracting the list's own offset (as this first did) puts the rule at
    // the top of the sidebar regardless of which page is open.
    rule.style.transform = `translateY(${active.offsetTop}px)`;
    rule.style.height = `${active.offsetHeight}px`;
    rule.style.opacity = "1";
    // The first placement should not slide in from y=0.
    if (!placedRef.current) {
      placedRef.current = true;
      rule.style.transition = "none";
      requestAnimationFrame(() => {
        rule.style.transition = "";
      });
    }
  });

  return (
    <nav aria-label="Documentation" className="text-sm">
      <ul ref={listRef} className="relative space-y-1">
        <span
          ref={ruleRef}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-1.5 top-0 w-0.5 rounded-full bg-blue-500 opacity-0",
            !reduceMotion &&
              "transition-[transform,height,opacity] duration-200 ease-out",
          )}
        />

        {NAV_TREE.map((section) => {
          const open = isOpen(section.slug);
          return (
            <li key={section.slug}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((current) => ({
                    ...current,
                    [section.slug]: open,
                  }))
                }
                className="flex w-full items-center gap-1.5 rounded-md py-1.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-silver-400 transition-colors hover:text-silver-900"
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3 transition-transform duration-200",
                    open && "rotate-90",
                  )}
                />
                {section.title}
              </button>

              {open && (
                <ul className="mb-2 ml-1.5 border-l border-silver-200">
                  {section.pages.map((page) => (
                    <li key={page.path}>
                      <NavLink
                        to={page.path}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            "block py-1.5 pl-4 pr-2 transition-colors",
                            isActive
                              ? "text-silver-900"
                              : "text-silver-600 hover:text-silver-900",
                          )
                        }
                      >
                        {page.title}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default DocsSidebar;
