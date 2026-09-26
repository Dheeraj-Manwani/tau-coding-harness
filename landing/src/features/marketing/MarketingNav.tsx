import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { ChevronDownIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";

/**
 * The marketing navbar (§4.0).
 *
 * Transparent over the hero, then it acquires glass past 80px of scroll. The
 * threshold is read from a `useScroll` subscription rather than a scroll
 * listener with `setState` on every frame: this only re-renders on the two
 * frames where the state actually flips.
 */

const GLASS_AFTER_PX = 80;

/**
 * The Product panel's six pillars. Each is a landing anchor plus the docs page
 * that covers it in depth.
 *
 * Anchors resolve as the bands land (Phases 2-3) and the docs hrefs when Phase
 * 5 writes the pages; both are declared here now so the panel has one shape and
 * one place to maintain. `ready` gates whether an entry is rendered as a live
 * link: shipping a nav full of links to nothing is worse than a shorter nav.
 */
interface Pillar {
  title: string;
  blurb: string;
  anchor: string;
  docs: string;
  ready: boolean;
}

const PILLARS: Pillar[] = [
  {
    title: "Build",
    blurb: "A sentence in, a running app out.",
    anchor: "/#how-it-works",
    docs: "/docs/start/quickstart",
    ready: false,
  },
  {
    title: "Workspace",
    blurb: "Chat, files, a real editor, live preview.",
    anchor: "/#workspace",
    docs: "/docs/workspace/overview",
    ready: false,
  },
  {
    title: "Ship",
    blurb: "Push to GitHub. Secrets stay behind.",
    anchor: "/#ship",
    docs: "/docs/ship/github",
    ready: false,
  },
  {
    title: "AI in your app",
    blurb: "Add smart features without extra setup.",
    anchor: "/#ai-gateway",
    docs: "/docs/ai/overview",
    ready: false,
  },
  {
    title: "Credits",
    blurb: "Pay for work done, not seats.",
    anchor: "/#credits",
    docs: "/docs/billing/credits",
    ready: false,
  },
  {
    title: "Mobile",
    blurb: "Start it on the train.",
    anchor: "/#mobile",
    docs: "/docs/mobile/overview",
    ready: false,
  },
];

const READY_PILLARS = PILLARS.filter((pillar) => pillar.ready);

function ProductMenu() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);

  // Hover menus need a grace period or the panel snaps shut as the pointer
  // crosses the gap between the trigger and the panel.
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const cancelClose = () => window.clearTimeout(closeTimer.current);

  return (
    <div
      className="relative"
      onPointerEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onPointerLeave={scheduleClose}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-silver-600 transition-colors hover:text-silver-900"
      >
        Product
        <ChevronDownIcon
          className={cn(
            "size-3.5 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onPointerEnter={cancelClose}
            onPointerLeave={scheduleClose}
            className="absolute left-1/2 top-full z-50 w-[min(34rem,90vw)] -translate-x-1/2 pt-3"
          >
            <div className="rounded-xl border border-silver-200 bg-space-overlay/95 p-2 shadow-2xl backdrop-blur-xl">
              {READY_PILLARS.length === 0 ? (
                <p className="px-3 py-4 text-sm text-silver-600">
                  A tour of every part of tau is on its way. In the meantime,{" "}
                  <Link to="/docs" className="text-blue-500 hover:underline">
                    the docs
                  </Link>{" "}
                  are the place to start.
                </p>
              ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {READY_PILLARS.map((pillar) => (
                    <Link
                      key={pillar.title}
                      to={pillar.anchor}
                      onClick={() => setOpen(false)}
                      className="rounded-lg px-3 py-2.5 transition-colors hover:bg-space-surface"
                    >
                      <span className="block text-sm font-medium text-silver-900">
                        {pillar.title}
                      </span>
                      <span className="block text-xs text-silver-600">
                        {pillar.blurb}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MarketingNav() {
  const { scrollY } = useScroll();
  const [glass, setGlass] = useState(false);
  const reduceMotion = useReduceMotion();

  useMotionValueEvent(scrollY, "change", (value) => {
    const next = value > GLASS_AFTER_PX;
    setGlass((current) => (current === next ? current : next));
  });

  return (
    <motion.header
      className="sticky top-0 z-50"
      animate={{
        backgroundColor: glass ? "rgba(7, 7, 15, 0.7)" : "rgba(7, 7, 15, 0)",
        borderBottomColor: glass ? "rgba(45, 55, 72, 0.6)" : "rgba(45, 55, 72, 0)",
        backdropFilter: glass ? "blur(20px)" : "blur(0px)",
      }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 260, damping: 30 }
      }
      style={{ borderBottomWidth: 1, borderBottomStyle: "solid" }}
    >
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3"
      >
        <Link
          to="/"
          aria-label="tau home"
          className="group flex items-center gap-2 rounded-md"
        >
          <span
            className="logo-mark logo-shimmer size-6"
            role="img"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-silver-900">tau</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          <ProductMenu />
          <Link
            to="/docs"
            className="rounded-md px-3 py-1.5 text-sm text-silver-600 transition-colors hover:text-silver-900"
          >
            Docs
          </Link>
          <Link
            to="/pricing"
            className="rounded-md px-3 py-1.5 text-sm text-silver-600 transition-colors hover:text-silver-900"
          >
            Pricing
          </Link>
        </div>

      </nav>
    </motion.header>
  );
}

export default MarketingNav;
