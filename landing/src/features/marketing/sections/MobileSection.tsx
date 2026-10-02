import { useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";

import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";

/**
 * §4.10: "Start it on the train. Finish it at your desk."
 *
 * The second column is the one that earns trust: it says plainly what mobile
 * does *not* do. The code editor and file tree are web-only, and saying so is
 * worth more than hiding it: a user who discovers a gap themselves assumes
 * there are others.
 */

const PRESENT = [
  "Your projects and conversations",
  "Camera, photos, and files",
  "Your choice of pace",
  "Live app previews",
  "Credits and billing",
  "Your app's AI key",
  "GitHub access",
];

const ABSENT = [
  "The code editor",
  "The file tree",
];

export function MobileSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReduceMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const smooth = useSpring(scrollYProgress, { stiffness: 60, damping: 22 });
  const rotateY = useTransform(smooth, [0, 1], [4, -4]);

  return (
    <section
      id="mobile"
      ref={sectionRef}
      className="mx-auto w-full max-w-6xl px-6 py-20 md:py-24"
    >
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          Build from anywhere
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Start it on the train. Finish it at your desk.
        </h2>
      </ScrollReveal>

      <div className="mt-14 grid items-center gap-12 lg:grid-cols-[auto_1fr]">
        <div className="flex justify-center" style={{ perspective: 1200 }}>
          <motion.div
            style={reduceMotion ? undefined : { rotateY }}
            className="relative h-[26rem] w-[13rem] rounded-[2rem] border border-silver-400/60 bg-space-surface p-3 shadow-2xl"
          >
            {/* Rim light on the near edge. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-blue-500/25"
            />
            <div className="flex h-full flex-col gap-2 overflow-hidden rounded-[1.5rem] bg-space-void p-3">
              <div className="mx-auto h-1 w-10 rounded-full bg-silver-200" />
              <div className="mt-2 space-y-2">
                <Bubble w="70%" />
                <Bubble w="88%" tone="blue" />
                <Bubble w="52%" />
                <Bubble w="76%" tone="blue" />
                <Bubble w="60%" />
              </div>
              <div className="mt-auto h-9 rounded-xl border border-silver-200" />
            </div>
          </motion.div>
        </div>

        <div className="grid gap-10 sm:grid-cols-2">
          <ScrollReveal>
            <h3 className="text-sm font-semibold text-silver-900">
              What's on mobile
            </h3>
            <ul className="mt-3 space-y-1.5 text-sm text-silver-600">
              {PRESENT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </ScrollReveal>
          <ScrollReveal>
            <h3 className="text-sm font-semibold text-silver-900">
              Better on a bigger screen
            </h3>
            <ul className="mt-3 space-y-1.5 text-sm text-silver-600">
              {ABSENT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-silver-600">
              Those live on the web, where there's a keyboard. Open the same
              project on your desktop and pick up mid-build.
            </p>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

function Bubble({ w, tone }: { w: string; tone?: "blue" }) {
  return (
    <div
      className={`h-6 rounded-lg ${tone === "blue" ? "ml-auto bg-blue-500/20" : "bg-space-overlay"}`}
      style={{ width: w }}
    />
  );
}

export default MobileSection;
