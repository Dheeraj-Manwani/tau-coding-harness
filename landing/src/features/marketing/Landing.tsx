import { Suspense, lazy, type ReactNode } from "react";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { hasRecording } from "@/src/features/marketing/data/replay";
import { Hero } from "@/src/features/marketing/sections/Hero";

/**
 * The public landing page: the fourteen bands of §4.
 *
 * The hero ships in the initial chunk because it *is* the fold. Everything
 * below it is `React.lazy` behind a skeleton of its own committed height; that
 * fixed height is what keeps CLS at zero (§10) while a chunk is in flight, and
 * it is why the skeletons are sized rather than spinners.
 *
 * Copy across every band is constrained by the truth table in §9. In
 * particular: nothing here uses a Deploy verb, no band claims two-way GitHub
 * sync, ZIP export or a gallery, there is no invented social proof, and the AI
 * gateway carries a Beta chip until its end-to-end run is green.
 */

const HowItWorks = lazy(
  () => import("@/src/features/marketing/sections/HowItWorks"),
);
const BuildReplay = lazy(
  () => import("@/src/features/marketing/sections/BuildReplay"),
);
const EffortTiers = lazy(
  () => import("@/src/features/marketing/sections/EffortTiers"),
);
const WorkspaceTour = lazy(
  () => import("@/src/features/marketing/sections/WorkspaceTour"),
);
const ShipIt = lazy(() => import("@/src/features/marketing/sections/ShipIt"));
const AiGateway = lazy(
  () => import("@/src/features/marketing/sections/AiGateway"),
);
const MobileSection = lazy(
  () => import("@/src/features/marketing/sections/MobileSection"),
);
const FinalCta = lazy(
  () => import("@/src/features/marketing/sections/FinalCta"),
);

/** Reserves the band's box so nothing below it moves when the chunk lands. */
function Band({ minHeight, children }: { minHeight: number; children: ReactNode }) {
  return (
    <Suspense fallback={<div style={{ minHeight: Math.min(minHeight, 480) }} aria-hidden="true" />}>
      {children}
    </Suspense>
  );
}

function Divider() {
  return <div aria-hidden="true" className="mx-auto h-px max-w-6xl bg-border/60" />;
}

export function Landing() {
  useDocumentMeta({
    // Bare site name on the tab for the home screen; every other screen
    // follows "<Screen> | Tau" via the hook's default suffix.
    title: "Tau",
    exactTitle: true,
    description:
      "Describe what you want and tau turns it into a working app while you watch. Start free with 300 credits and no card.",
    canonical: "/",
  });

  return (
    <div className="relative">


      <Hero />

      <Divider />

      <Band minHeight={1200}>
        <HowItWorks />
      </Band>

      {/* Gated on the fixture rather than rendered-then-hidden: the replay
          pulls ChatMarkdown, and with it react-markdown: ~48KB gzipped that
          the landing page has no business downloading for a band that has
          nothing to play. Checking here means the chunk is never requested. */}
      {hasRecording && (
        <>
          <Divider />
          <Suspense fallback={<div style={{ minHeight: 900 }} aria-hidden="true" />}>
            <BuildReplay />
          </Suspense>
        </>
      )}

      <Divider />

      <Band minHeight={900}>
        <EffortTiers />
      </Band>

      <Divider />

      <Band minHeight={800}>
        <WorkspaceTour />
      </Band>

      <Divider />

      <Band minHeight={620}>
        <ShipIt />
      </Band>

      <Divider />

      <Band minHeight={760}>
        <AiGateway />
      </Band>

      <Divider />

      <Band minHeight={700}>
        <MobileSection />
      </Band>

      <Divider />

      <Band minHeight={520}>
        <FinalCta />
      </Band>
    </div>
  );
}

export default Landing;
