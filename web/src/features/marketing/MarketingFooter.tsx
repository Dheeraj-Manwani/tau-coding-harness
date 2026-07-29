import { Link } from "react-router-dom";

import { MeteorDivider } from "@/src/features/marketing/motion/MeteorDivider";

/**
 * The marketing footer (§4.13): columns over a faint horizon glow — the planet
 * you have been orbiting — with a meteor occasionally crossing the top rule.
 *
 * Kept separate from `SiteFooter` rather than expanding it. `SiteFooter` also
 * renders inside `AppShell`, whose layout is a fixed `100svh` box with a single
 * scrolling pane; dropping a five-column footer in there would eat the
 * builder's viewport for no benefit to someone already signed in.
 *
 * Every entry declares `ready`. Destinations that later phases build (the
 * landing anchors, /changelog, /status, the docs pages) are listed now so the
 * map lives in one place, but only live links are rendered — a footer full of
 * 404s costs more trust than a short footer.
 */

interface FooterLink {
  label: string;
  /** Internal route, or an absolute `mailto:` / `https:` URL. */
  href: string;
  ready: boolean;
}

interface FooterColumn {
  title: string;
  links: FooterLink[];
}

const COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "/#overview", ready: false },
      { label: "Effort tiers", href: "/#effort", ready: false },
      { label: "AI gateway", href: "/#ai-gateway", ready: false },
      { label: "Pricing", href: "/pricing", ready: true },
      { label: "Mobile", href: "/#mobile", ready: false },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "Documentation", href: "/docs", ready: true },
      { label: "Quickstart", href: "/docs/start/quickstart", ready: false },
      { label: "Effort tiers", href: "/docs/build/effort-tiers", ready: false },
      { label: "API reference", href: "/docs/reference/api", ready: false },
      { label: "Troubleshooting", href: "/docs/help/troubleshooting", ready: false },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Changelog", href: "/changelog", ready: false },
      { label: "Status", href: "/status", ready: false },
      { label: "Roadmap", href: "/roadmap", ready: false },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Contact", href: "mailto:support@usetau.dev", ready: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy", ready: true },
      { label: "Terms", href: "/terms", ready: true },
      { label: "Refunds", href: "/terms#refunds", ready: false },
    ],
  },
];

const LINK_CLASS =
  "text-sm text-silver-600 transition-colors hover:text-silver-900";

function FooterEntry({ link }: { link: FooterLink }) {
  if (link.href.startsWith("mailto:") || link.href.startsWith("http")) {
    return (
      <a href={link.href} className={LINK_CLASS}>
        {link.label}
      </a>
    );
  }
  return (
    <Link to={link.href} className={LINK_CLASS}>
      {link.label}
    </Link>
  );
}

export function MarketingFooter() {
  const columns = COLUMNS.map((column) => ({
    ...column,
    links: column.links.filter((link) => link.ready),
  })).filter((column) => column.links.length > 0);

  return (
    <footer className="horizon-glow relative isolate mt-24 overflow-hidden">
      <MeteorDivider />

      <div className="relative mx-auto w-full max-w-6xl px-6 py-14">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <Link to="/" className="flex items-center gap-2" aria-label="tau home">
              <span className="logo-mark size-6" role="img" aria-hidden="true" />
              <span className="text-sm font-semibold text-silver-900">tau</span>
            </Link>
            <p className="mt-3 text-sm text-silver-600">
              Describe what you want. Tau plans it, writes it, and runs it in a
              secure cloud sandbox.
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-4"
          >
            {columns.map((column) => (
              <div key={column.title}>
                <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-silver-900">
                  {column.title}
                </h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <FooterEntry link={link} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p className="mt-12 text-xs text-silver-600">
          © {new Date().getFullYear()} Tau. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export default MarketingFooter;
