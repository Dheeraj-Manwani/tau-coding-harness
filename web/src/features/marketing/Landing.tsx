import { Suspense, lazy, type ReactNode } from "react";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { hasRecording } from "@/src/features/marketing/data/replay";
import { Hero } from "@/src/features/marketing/sections/Hero";
import { MeteorDivider } from "@/src/features/marketing/motion/MeteorDivider";
import { NebulaDrift } from "@/src/features/marketing/motion/NebulaDrift";

/**
 * The public landing page — the fourteen bands of §4.
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

const CredibilityStrip = lazy(
  () => import("@/src/features/marketing/sections/CredibilityStrip"),
);
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
const Credits = lazy(() => import("@/src/features/marketing/sections/Credits"));
const MobileSection = lazy(
  () => import("@/src/features/marketing/sections/MobileSection"),
);
const Faq = lazy(() => import("@/src/features/marketing/sections/Faq"));
const FinalCta = lazy(
  () => import("@/src/features/marketing/sections/FinalCta"),
);

/** Reserves the band's box so nothing below it moves when the chunk lands. */
function Band({ minHeight, children }: { minHeight: number; children: ReactNode }) {
  return (
    <Suspense fallback={<div style={{ minHeight }} aria-hidden="true" />}>
      <div style={{ minHeight }}>{children}</div>
    </Suspense>
  );
}

function Divider() {
  return <MeteorDivider className="mx-auto max-w-5xl" />;
}

export function Landing() {
  useDocumentMeta({
    title: "tau — turn a sentence into a running web app",
    exactTitle: true,
    description:
      "Describe what you want; tau plans it, writes it, runs it in a secure cloud sandbox, and streams every step to your screen. Start free with 200 credits — no card.",
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

      <Divider />

      <Band minHeight={1200}>
        <HowItWorks />
      </Band>

      {/* Gated on the fixture rather than rendered-then-hidden: the replay
          pulls ChatMarkdown, and with it react-markdown — ~48KB gzipped that
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

      <Band minHeight={980}>
        <Credits />
      </Band>

      <Divider />

      <Band minHeight={700}>
        <MobileSection />
      </Band>

      <Divider />

      <Band minHeight={780}>
        <Faq />
      </Band>

      <Band minHeight={520}>
        <FinalCta />
      </Band>
    </div>
  );
}

export default Landing;
