import { AnimatePresence, motion } from "motion/react";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { TextAnimate } from "@/src/components/ui/text-animate";
import { EffortDropdown } from "@/src/features/composer/EffortDropdown";
import { LightningComposer } from "@/src/features/composer/LightningComposer";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import type { Effort } from "@/src/features/project/types";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { MagneticButton } from "@/src/features/marketing/motion/MagneticButton";
import { TauWatermark } from "@/src/features/marketing/motion/TauWatermark";
import { useCosmos } from "@/src/features/marketing/motion/cosmos";
import { APP_SIGNUP, signupPath } from "@/src/lib/routes";

/**
 * The hero (§4.1).
 *
 * The centrepiece is a working replica of the real composer — the same
 * `PromptComposer` chrome, the same `LightningComposer` wrapper, the same
 * `EffortDropdown`. A visitor can arm MAX and watch the bolt lap the border
 * exactly as it does inside the product, before they have an account. That is
 * the single most persuasive thing we can put above the fold, and it costs
 * nothing to let them play with it.
 *
 * Submitting does not build. It carries the prompt to signup, so the visitor
 * has already written their idea before they have made an account, and the
 * first thing they see after verifying is their own sentence waiting in the
 * builder.
 *
 * Attachments are the one piece of chrome that stays inert: the paperclip
 * renders in its real disabled state rather than opening a file picker that
 * would have nowhere to upload to.
 */

/** Mirrors SUGGESTIONS in pages/Home.tsx — the same carousel, before signup. */
const SUGGESTIONS = [
  "Build me a personal finance dashboard with charts…",
  "Create a landing page for my coffee shop…",
  "Make a kanban board with drag-and-drop…",
  "Design a portfolio site with a blog…",
  "Build a real-time chat app with rooms…",
  "Spin up an admin panel for my store…",
];

/** Matches MaxStarField's ramp on Home: the same sky, roughly 1.6× as dense. */
const MAX_DENSITY_BOOST = 1.6;

export function Hero() {
  const reduceMotion = useReduceMotion();
  const cosmos = useCosmos();

  const [prompt, setPrompt] = useState("");
  const [effort, setEffort] = useState<Effort>("LOW");
  const [suggestion, setSuggestion] = useState(0);

  const maxActive = effort === "MAX";
  const showPlaceholder = prompt.length === 0;

  // Arming MAX packs the shared starfield tighter, exactly as it does in the
  // app. The landing page and the product agree about what MAX looks like.
  useEffect(() => {
    cosmos.setDensityBoost(maxActive ? MAX_DENSITY_BOOST : 1);
    return () => cosmos.setDensityBoost(1);
  }, [cosmos, maxActive]);

  useEffect(() => {
    if (!showPlaceholder || reduceMotion) return;
    const id = setInterval(
      () => setSuggestion((i) => (i + 1) % SUGGESTIONS.length),
      5000,
    );
    return () => clearInterval(id);
  }, [showPlaceholder, reduceMotion]);

  const submit = () => {
    const message = prompt.trim();
    window.location.assign(signupPath(message || undefined));
  };

  return (
    <section
      id="overview"
      className="relative mx-auto flex min-h-[88svh] w-full max-w-3xl flex-col items-center justify-center px-6 pb-20 pt-16 text-center"
    >
      {/* MAX vignette: the frame edge breathes blue while the big model is
          armed. Sits behind everything and never intercepts a pointer. */}
      <AnimatePresence>
        {maxActive && !reduceMotion && (
          <motion.div
            key="max-vignette"
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 -z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.35, 0.6, 0.35] }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 4, repeat: Infinity, ease: "easeInOut" },
            }}
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 45%, rgba(59,130,246,0.18) 100%)",
            }}
          />
        )}
      </AnimatePresence>

      {/* The τ mark ignites once on mount and then holds as a watermark. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[18%] -translate-x-1/2"
      >
        <TauWatermark size={96} />
      </div>

      <p className="relative text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
        Prompt → running app
      </p>

      <h1 className="relative mt-5 text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
        {reduceMotion ? (
          <>
            Describe it. <span className="text-cosmic">tau builds it.</span>
          </>
        ) : (
          <TextAnimate
            as="span"
            by="word"
            animation="blurInUp"
            startOnView={false}
            once
            duration={0.6}
            className="inline"
          >
            Describe it. tau builds it.
          </TextAnimate>
        )}
      </h1>

      <p className="relative mt-5 max-w-xl text-pretty text-silver-600">
        Tau turns a sentence into a real, running web app — planned, coded, and
        previewed live in a secure cloud sandbox. Watch it work, edit the code,
        push to GitHub. No setup, no scaffolding, no boilerplate.
      </p>

      {/* The composer replica. */}
      <motion.div
        className="relative mt-10 w-full text-left"
        initial={reduceMotion ? false : { opacity: 0, y: 24, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.6, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <LightningComposer active={maxActive}>
          <PromptComposer
            value={prompt}
            onChange={setPrompt}
            onSubmit={submit}
            ariaLabel="Describe the app you want to build"
            minRows={3}
            maxRows={8}
            rightSlot={
              <EffortDropdown effort={effort} onChange={setEffort} />
            }
            overlay={
              showPlaceholder ? (
                <TextAnimate
                  key={suggestion}
                  as="span"
                  by="character"
                  animation="slideLeft"
                  startOnView={false}
                  once
                  className="pointer-events-none absolute left-2 top-1 text-base text-muted-foreground"
                >
                  {SUGGESTIONS[suggestion]!}
                </TextAnimate>
              ) : null
            }
          />
        </LightningComposer>
      </motion.div>

      <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
        <MagneticButton
          to={APP_SIGNUP}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Start building free
          <span aria-hidden="true"> →</span>
        </MagneticButton>
        <Link
          to="/docs"
          className="rounded-lg border border-silver-200 px-5 py-2.5 text-sm font-medium text-silver-900 transition-colors hover:border-silver-400 hover:bg-space-overlay"
        >
          Read the docs
        </Link>
      </div>

      <p className="relative mt-5 text-xs text-silver-600">
        300 free credits on signup · No card required · Your code, yours to take
      </p>

      <ScrollCue />
    </section>
  );
}

/** A chevron that bobs, with a light trail falling out of it. */
function ScrollCue() {
  const reduceMotion = useReduceMotion();
  if (reduceMotion) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1"
    >
      <motion.span
        animate={{ y: [0, 6, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <ChevronDownIcon className="size-4 text-silver-600" />
      </motion.span>
      <span className="relative block h-8 w-px overflow-hidden">
        <motion.span
          className="absolute inset-x-0 h-4 bg-gradient-to-b from-transparent via-blue-300 to-transparent"
          animate={{ y: ["-100%", "200%"] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeIn" }}
        />
      </span>
    </div>
  );
}

export default Hero;
