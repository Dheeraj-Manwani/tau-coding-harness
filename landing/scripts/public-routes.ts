/**
 * The public routes, in one place.
 *
 * Both `build-docs-index.ts` (which emits `sitemap.xml`) and `prerender.ts`
 * (which writes static HTML) read from here. Keeping the list in one module is
 * what stops the sitemap advertising a URL the prerender never rendered: the
 * failure mode being a crawler served an empty shell for a page it was told
 * about.
 *
 * Doc routes are not listed: they come from the content tree, so the two
 * consumers derive them from the generated index instead.
 */

export interface PublicRoute {
  path: string;
  /** sitemap `<priority>`. Relative weight only; crawlers treat it as a hint. */
  priority: number;
  /** sitemap `<changefreq>`. */
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
}

/** Everything public that is not a docs page. */
export const STATIC_ROUTES: PublicRoute[] = [
  { path: "/", priority: 1.0, changefreq: "weekly" },
  { path: "/pricing", priority: 0.9, changefreq: "monthly" },
  { path: "/docs", priority: 0.9, changefreq: "weekly" },
  { path: "/changelog", priority: 0.6, changefreq: "weekly" },
  { path: "/privacy", priority: 0.3, changefreq: "yearly" },
  { path: "/terms", priority: 0.3, changefreq: "yearly" },
];

/**
 * Public but deliberately excluded from both the sitemap and the prerender.
 *
 * These routes live on app.tauai.pro and are intentionally absent from the
 * public-site sitemap and prerender output.
 */
export const EXCLUDED_ROUTES = [
  "/login",
  "/signup",
  "/auth/callback",
  "/checkout",
  "/verify-email",
  "/verify-pending",
];

/** Where the built site is served from. Overridable for a staging origin. */
export function siteOrigin(): string {
  return (process.env["SITE_ORIGIN"] ?? "https://tauai.pro").replace(/\/+$/, "");
}
