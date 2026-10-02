import { useState } from "react";

import { ElectricBorder } from "@/src/components/ui/electric-border";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { appPath } from "@/src/lib/routes";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";

/**
 * §4.12: "Full burn".
 *
 * The composer comes back with the border always on, and the starfield warps
 * when the CTA is hovered. Warp is used in exactly two places on the page: the
 * nav CTA and here: because a warp that fires everywhere stops meaning
 * "forward" and starts meaning "background".
 *
 * The headline is deliberately the same sentence as the real app's Home
 * (`pages/Home.tsx`): the last thing you read out here is the first thing you
 * read in there.
 */

export function FinalCta() {
  const reduceMotion = useReduceMotion();
  const [prompt, setPrompt] = useState("");

  const submit = () => {
    const message = prompt.trim();
    window.location.assign(appPath(message || undefined));
  };

  return (
    <section className="relative mx-auto w-full max-w-3xl px-6 py-20 md:py-24 text-center">
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

      <ScrollReveal className="mt-5 flex flex-col items-center gap-3">
        <p className="text-xs text-silver-600">
          Type your idea and press send. Your first 300 credits are free.
        </p>
      </ScrollReveal>
    </section>
  );
}

export default FinalCta;
