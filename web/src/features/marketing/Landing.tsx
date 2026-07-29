import { Link } from "react-router-dom";

import { Button } from "@/src/components/ui/button";
import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { MeteorDivider } from "@/src/features/marketing/motion/MeteorDivider";
import { NebulaDrift } from "@/src/features/marketing/motion/NebulaDrift";
import { ScrollReveal, Stagger } from "@/src/features/marketing/motion/ScrollReveal";

/**
 * The public landing page.
 *
 * Phase 0 stands it up as a single honest band on top of the finished motion
 * foundation — the shared starfield, the drifting nebula, the house reveal.
 * Phases 1-3 replace this with the fourteen bands in §4; nothing below is meant
 * to survive that.
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
      <NebulaDrift />

      <section className="relative mx-auto flex min-h-[80svh] max-w-3xl flex-col items-center justify-center px-6 py-24 text-center">
        <Stagger className="flex flex-col items-center gap-6">
          <ScrollReveal asChildOfStagger>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
              Prompt → running app
            </p>
          </ScrollReveal>

          <ScrollReveal asChildOfStagger>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
              Describe it. <span className="text-cosmic">tau builds it.</span>
            </h1>
          </ScrollReveal>

          <ScrollReveal asChildOfStagger>
            <p className="max-w-xl text-pretty text-silver-600">
              Tau turns a sentence into a real, running web app — planned, coded,
              and previewed live in a secure cloud sandbox. Watch it work, edit
              the code, push to GitHub.
            </p>
          </ScrollReveal>

          <ScrollReveal asChildOfStagger>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/signup">Start building free</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/docs">Read the docs</Link>
              </Button>
            </div>
          </ScrollReveal>

          <ScrollReveal asChildOfStagger>
            <p className="text-xs text-silver-600">
              25 free credits on signup · No card required · Your code, yours to
              take
            </p>
          </ScrollReveal>
        </Stagger>
      </section>

      <MeteorDivider className="mx-auto max-w-5xl" />
    </div>
  );
}

export default Landing;
