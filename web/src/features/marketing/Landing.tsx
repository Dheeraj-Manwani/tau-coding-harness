import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { Hero } from "@/src/features/marketing/sections/Hero";
import { NebulaDrift } from "@/src/features/marketing/motion/NebulaDrift";

/**
 * The public landing page.
 *
 * Phase 1 is nav, hero and footer — the first version that is shippable on its
 * own. The remaining bands of §4 (how it works, the build replay, effort tiers,
 * the workspace tour, ship it, the AI gateway, credits, mobile, FAQ and the
 * final CTA) land in Phases 2 and 3 and slot in below `<Hero/>`.
 *
 * Copy is constrained by the truth table in §9: everything claimed here ships
 * today. No deploy verb, no invented social proof, no uptime numbers.
 */
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
    </div>
  );
}

export default Landing;
