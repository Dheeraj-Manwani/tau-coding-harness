/**
 * Layout families: the page structures a style may be built on.
 *
 * Left alone, a model lays out every page the same way — a centred hero, then
 * three equal cards, then a call to action. Naming a set of structures, and
 * telling each style which of them suit it, replaces "arrange this somehow"
 * with a choice between concrete options. The agent picks one per screen from
 * the list its app's `DESIGN.md` allows; how to build each is the `layouts`
 * guide (`agent/docs/layouts.md`), which a test keeps in step with this list.
 */

export const LAYOUT_KEYS = [
  "split-hero",
  "editorial-column",
  "bento",
  "full-bleed-bands",
  "poster",
  "index-list",
  "sidebar-shell",
  "topbar-workspace",
  "focus-column",
  "master-detail",
  "dashboard-grid",
  "board",
  "split-tool",
] as const;

export type LayoutKey = (typeof LAYOUT_KEYS)[number];

export interface LayoutSpec {
  name: string;
  /** Whether it structures a page people read, or an app people operate. */
  kind: "page" | "app";
  /** One line: what it is, and what it is for. */
  summary: string;
}

export const LAYOUTS: Record<LayoutKey, LayoutSpec> = {
  "split-hero": {
    name: "Split hero",
    kind: "page",
    summary:
      "two unequal columns — words on one side, an image or the product on the other — with later sections alternating sides. For a page that introduces one thing.",
  },
  "editorial-column": {
    name: "Editorial column",
    kind: "page",
    summary:
      "one narrow reading column with oversized headings, and images or quotes that break out to full width. For stories, articles, about pages.",
  },
  bento: {
    name: "Bento grid",
    kind: "page",
    summary:
      "a grid of tiles of different sizes, each making one point. For showing several features or facts at once without ranking them.",
  },
  "full-bleed-bands": {
    name: "Full-bleed bands",
    kind: "page",
    summary:
      "full-width horizontal bands stacked down the page, each with its own background and its own inner arrangement. For a long page with distinct chapters.",
  },
  poster: {
    name: "Poster",
    kind: "page",
    summary:
      "one enormous typographic statement fills the first screen, with almost nothing else; the details follow plainly below. For a launch, an event, a single bold claim.",
  },
  "index-list": {
    name: "Index list",
    kind: "page",
    summary:
      "the content as a ruled, numbered list or table, one row per item, revealing more on hover. For portfolios, directories, menus, archives.",
  },
  "sidebar-shell": {
    name: "Sidebar shell",
    kind: "app",
    summary:
      "a fixed navigation column on the left and a content area with its own header. For an app with several sections the user moves between.",
  },
  "topbar-workspace": {
    name: "Top-bar workspace",
    kind: "app",
    summary:
      "a slim bar across the top and one centred working area beneath it, with tabs for sub-views. For an app with two to four sections.",
  },
  "focus-column": {
    name: "Focus column",
    kind: "app",
    summary:
      "a single centred column, nothing beside it. For a tool that does one thing: a calculator, a timer, a form, a quiz.",
  },
  "master-detail": {
    name: "Master–detail",
    kind: "app",
    summary:
      "a list on the left, the selected item in full on the right. For mail, notes, records — anything browsed and then read or edited.",
  },
  "dashboard-grid": {
    name: "Dashboard grid",
    kind: "app",
    summary:
      "a row of key figures, then an uneven grid of charts and tables where the most important panel is the largest. For monitoring and reporting.",
  },
  board: {
    name: "Board",
    kind: "app",
    summary:
      "columns side by side that scroll horizontally, each holding cards. For kanban, pipelines, schedules, anything moved between stages.",
  },
  "split-tool": {
    name: "Split tool",
    kind: "app",
    summary:
      "controls or input on one side, the live result on the other. For converters, generators, editors, previews.",
  },
};
