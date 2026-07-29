import { Suspense, lazy, type ReactNode } from "react";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { hasRecording } from "@/src/features/marketing/data/replay";
import { Hero } from "@/src/features/marketing/sections/Hero";
import { MeteorDivider } from "@/src/features/marketing/motion/MeteorDivider";
import { NebulaDrift } from "@/src/features/marketing/motion/NebulaDrift";

/**
 * The public landing page.
 *
 * The hero ships in the initial chunk because it *is* the fold. Everything
 * below it is `React.lazy`, each behind a skeleton of its own committed height
 * — that fixed height is what keeps CLS at zero (§10) while the chunk is in
 * flight, and it is why the skeletons are sized rather than a spinner.
 *
 * Phase 3 adds the remaining bands (effort tiers, workspace tour, ship it, the
 * AI gateway, credits, mobile, FAQ and the final CTA) below the replay.
 *
 * Copy is constrained by the truth table in §9: everything claimed here ships
 * today. No deploy verb, no invented social proof, no uptime numbers.
 */

const CredibilityStrip = lazy(
  () => import("@/src/features/marketing/sections/CredibilityStrip"),
);
const HowItWorks = lazy(
  () => import("@/src/features/marketing/sections/HowItWorks"),
);
const BuildReplay = lazy(
  () => import("@/src/features/marketing/sections/BuildReplay"),
);

/** Reserves the band's box so nothing below it moves when the chunk lands. */
function Band({ minHeight, children }: { minHeight: number; children: ReactNode }) {
  return (
    <Suspense fallback={<div style={{ minHeight }} aria-hidden="true" />}>
      <div style={{ minHeight }}>{children}</div>
    </Suspense>
  );
}

export function Landing() {
  useDocumentMeta({
    title: "tau — turn a sentence into a running web app",
    exactTitle: true,
    description:
      "Describe what you want; tau plans it, writes it, runs it in a secure cloud sandbox, and streams every step to your screen. Start free with 25 credits — no card.",
    canonical: "/",
  });

  return (
    <div className="relative">
      {/* Anchored to the hero band rather than the whole page: three 90px-blur
          clouds spanning a long document would be a large, permanently
          composited layer for no visual gain below the fold. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[100svh]">
        <NebulaDrift />
      </div>

      <Hero />

      <Band minHeight={140}>
        <CredibilityStrip />
      </Band>

      <MeteorDivider className="mx-auto max-w-5xl" />

      <Band minHeight={1200}>
        <HowItWorks />
      </Band>

      <MeteorDivider className="mx-auto max-w-5xl" />

      {/* Gated on the fixture rather than rendered-then-hidden: the replay
          pulls ChatMarkdown, and with it react-markdown — ~48KB gzipped that
          the landing page has no business downloading for a band that has
          nothing to play. Checking here means the chunk is never requested. */}
      {hasRecording && (
        <>
          <MeteorDivider className="mx-auto max-w-5xl" />
          <Suspense fallback={<div style={{ minHeight: 900 }} aria-hidden="true" />}>
            <BuildReplay />
          </Suspense>
        </>
      )}
    </div>
  );
}

export default Landing;
