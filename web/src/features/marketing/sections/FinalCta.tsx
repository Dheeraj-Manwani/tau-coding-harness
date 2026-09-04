import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ElectricBorder } from "@/src/components/ui/electric-border";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { PROMPT_PARAM } from "@/src/lib/promptHandoff";
import { MagneticButton } from "@/src/features/marketing/motion/MagneticButton";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";
import { useCosmos } from "@/src/features/marketing/motion/cosmos";

/**
 * §4.12 — "Full burn".
 *
 * The composer comes back with the border always on, and the starfield warps
 * when the CTA is hovered. Warp is used in exactly two places on the page — the
 * nav CTA and here — because a warp that fires everywhere stops meaning
 * "forward" and starts meaning "background".
 *
 * The headline is deliberately the same sentence as the real app's Home
 * (`pages/Home.tsx`): the last thing you read out here is the first thing you
 * read in there.
 */

/** Long enough to read as acceleration, short enough not to be a light show. */
const WARP_MS = 1100;

export function FinalCta() {
  const navigate = useNavigate();
  const cosmos = useCosmos();
  const reduceMotion = useReduceMotion();
  const [prompt, setPrompt] = useState("");

  const submit = () => {
    const message = prompt.trim();
    navigate(
      message
        ? `/signup?${PROMPT_PARAM}=${encodeURIComponent(message)}`
        : "/signup",
    );
  };

  return (
    <section className="relative mx-auto w-full max-w-3xl px-6 py-28 text-center">
      <ScrollReveal>
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          What do you want to build?
        </h2>
      </ScrollReveal>

      <ScrollReveal className="mt-10 text-left">
        <ElectricBorder
          active
          reducedMotion={reduceMotion}
          color="#3b82f6"
          borderRadius={16}
        >
          <PromptComposer
            value={prompt}
            onChange={setPrompt}
            onSubmit={submit}
            ariaLabel="Describe the app you want to build"
            minRows={2}
            maxRows={6}
            placeholder="Describe your idea…"
          />
        </ElectricBorder>
      </ScrollReveal>

      <ScrollReveal className="mt-8 flex flex-col items-center gap-3">
        <MagneticButton
          to="/signup"
          onPointerEnter={() => cosmos.warp(WARP_MS)}
          className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Start building free
          <span aria-hidden="true"> →</span>
        </MagneticButton>
        <p className="text-xs text-silver-600">
          200 credits on signup, no card.
        </p>
      </ScrollReveal>
    </section>
  );
}

export default FinalCta;
