import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { APP_ORIGIN, APP_HOME } from "@/src/lib/routes";

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`storm-nav ${scrolled ? "scrolled" : ""}`}>
      <nav className="storm-container storm-nav-inner" aria-label="Main">
        <Link to="/" className="storm-brand" aria-label="tau home">
          <span className="logo-mark" aria-hidden="true" />
          {/* TAU */}
        </Link>
        <div
          id="storm-navigation"
          className={`storm-nav-links ${open ? "open" : ""}`}
          onClick={() => setOpen(false)}
        >
          <a href="/#how-it-works">Product ▾</a>
          <Link to="/docs">Docs</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/changelog">Changelog</Link>
        </div>
        <div className="storm-nav-actions">
          <a href={`${APP_ORIGIN}/login`}>Sign in</a>
          <a href={APP_HOME} className="start-building">
            Start building
          </a>
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label="Toggle navigation"
            aria-expanded={open}
            aria-controls="storm-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? "×" : "☰"}
          </button>
        </div>
      </nav>
    </header>
  );
}
export default MarketingNav;
