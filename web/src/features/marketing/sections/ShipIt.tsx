import { useState } from "react";

import { GithubMark } from "@/src/components/ui/github-mark";
import { cn } from "@/src/lib/utils";
import { ScrollReveal, Stagger } from "@/src/features/marketing/motion/ScrollReveal";
import { UplinkArc } from "@/src/features/marketing/motion/UplinkArc";

/**
 * §4.7 — "Push it to GitHub. Or just take it."
 *
 * The headline claim of this band is the one worth being precise about:
 * secret-path filtering is a *hard floor*, applied before your project's own
 * `.gitignore`. Deleting your `.gitignore` still cannot publish a key. §9 marks
 * that as shipped and safe to highlight, and the `.env` packet dissolving on
 * the shield is the animation that carries it.
 *
 * Note what this band does not say. There is no Deploy verb anywhere on it —
 * §9 forbids one until deploying exists.
 */

const COLUMNS = [
  {
    title: "Connect GitHub",
    copy: "Authorise once, then push from inside the project. No tokens to paste, no CLI to install.",
  },
  {
    title: "New PR, update a PR, or push direct",
    copy: "Commits are built through GitHub's Git Data API — there is no git binary in the sandbox and none is needed.",
  },
  {
    title: "Secrets can't leak",
    copy: "The tree builder filters secret paths first, as a hard floor, and only then applies your project's .gitignore. Deleting your .gitignore still cannot publish a key.",
  },
];

export function ShipIt() {
  const [pulses, setPulses] = useState(0);

  return (
    <section id="ship" className="mx-auto w-full max-w-6xl px-6 py-24">
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          It's your code
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Push it to GitHub. Or just take it.
        </h2>
      </ScrollReveal>

      <div className="mt-14 flex items-center gap-4">
        <span
          className="logo-mark size-8 shrink-0"
          role="img"
          aria-label="tau"
        />
        <UplinkArc
          className="h-28 flex-1"
          onArrive={() => setPulses((n) => n + 1)}
        />
        <span key={pulses} className={cn("shrink-0 text-silver-600", "github-pulse")}>
          {/* Re-keying on arrival restarts the pulse; the class is a one-shot. */}
          <GithubMark className="size-8" />
        </span>
      </div>

      <Stagger className="mt-12 grid gap-8 sm:grid-cols-3">
        {COLUMNS.map((column) => (
          <ScrollReveal key={column.title} asChildOfStagger>
            <h3 className="text-sm font-semibold text-silver-900">
              {column.title}
            </h3>
            <p className="mt-2 text-sm text-silver-600">{column.copy}</p>
          </ScrollReveal>
        ))}
      </Stagger>

      <ScrollReveal className="mt-10 text-sm text-silver-600">
        <p>
          The agent can also open a GitHub issue for you, straight from the
          conversation.
        </p>
      </ScrollReveal>
    </section>
  );
}

export default ShipIt;
