import { useRef, useState } from "react";
import { LockIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { OrbitRing } from "@/src/features/marketing/motion/OrbitRing";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";
import { Typewriter } from "@/src/features/marketing/motion/Typewriter";
import { useIsVisible } from "@/src/features/marketing/motion/useRafLoop";

/**
 * §4.8: "Your generated app can call an LLM."
 *
 * Carries a **Beta** chip, and that is a deliberate decision, not decoration.
 * §13's open question #2 said to label this Beta until the end-to-end run in
 * `AI_FOR_GENERATED_APPS.md` §9 Phase A is green, and as of writing that
 * document still records "no end-to-end agent run has happened: every piece is
 * verified alone". Every part of this ships; nothing has yet driven the whole
 * path. The chip is what makes the difference honest. Remove it when the run
 * goes green, not before.
 *
 * The code block is lifted from the shipped recipe in that same document rather
 * than written from memory: including `{ prompt }` in and `data.text` out,
 * which is the shape the gateway actually serves.
 */

const SNIPPET = `// server/index.ts: inside the app tau built for you
const res = await fetch(\`\${process.env.TAU_AI_URL}/chat\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: \`Bearer \${process.env.TAU_API_KEY}\`,
  },
  body: JSON.stringify({ prompt: \`Summarize:\\n\\n\${text}\` }),
})

const { text: summary } = await res.json()`;

const FACTS = [
  {
    title: "One key, handled safely",
    copy: "Tau gives your app one protected key. You can replace it or set a daily spending limit whenever you like.",
  },
  {
    title: "Easy to add",
    copy: "Ask Tau to add AI to your app and it handles the connection for you. Existing OpenAI-style apps can connect too.",
  },
  {
    title: "Clear spending",
    copy: "Your billing page shows what you spent building and what your app spent using AI, separately.",
  },
];

export function AiGateway() {
  const sectionRef = useRef<HTMLElement>(null);
  const visible = useIsVisible(sectionRef, "-10%");
  const [revealed, setRevealed] = useState(false);

  return (
    <section
      id="ai-gateway"
      ref={sectionRef}
      className="mx-auto w-full max-w-6xl px-6 py-24"
    >
      <ScrollReveal className="text-center">
        <p className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          AI for the apps you build
          <span className="rounded-full border border-silver-400 px-2 py-0.5 text-[0.6rem] tracking-normal text-silver-600">
            Beta
          </span>
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Give your app a little intelligence.
          <br />
          No extra account. No fiddly setup.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-silver-600">
          Ask Tau to add AI and it takes care of the connection, the key, and the
          setup. Everything is billed against the
          same credits that paid for the build.
        </p>
      </ScrollReveal>

      <div className="mt-14 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="relative">
          {/* The gateway motif, orbiting behind the code. */}
          <div className="pointer-events-none absolute -right-16 -top-16 opacity-40">
            <OrbitRing size={280} />
          </div>
          <pre className="relative overflow-x-auto rounded-2xl border border-silver-200 bg-space-void p-5 font-mono text-[0.72rem] leading-relaxed text-silver-600">
            <Typewriter text={SNIPPET} active={visible} />
          </pre>
        </div>

        <div className="flex flex-col gap-4">
          {/* The key card: masked until you ask, and asking needs re-auth. */}
          <div className="rounded-2xl border border-silver-200 bg-space-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-silver-400">
                Your app's AI key
              </p>
              <span className="flex items-center gap-1 rounded-full border border-silver-400 px-2 py-0.5 text-[0.6rem] text-silver-600">
                <LockIcon className="size-2.5" />
                Confirm to reveal
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className={cn(
                "mt-3 w-full overflow-hidden rounded-lg border border-silver-200 bg-space-void px-3 py-2 text-left font-mono text-xs transition-colors hover:border-silver-400",
                revealed ? "text-silver-900" : "text-silver-600",
              )}
            >
              {revealed ? "tau_sk_live_ab12cd34" : "tau_sk_live_••••••••"}
            </button>
            <p className="mt-2 text-xs text-silver-600">
              Replace it any time. Tau keeps the old one working briefly so your
              app does not suddenly stop.
            </p>
          </div>

          {FACTS.map((fact) => (
            <div key={fact.title}>
              <h3 className="text-sm font-semibold text-silver-900">
                {fact.title}
              </h3>
              <p className="mt-1 text-sm text-silver-600">{fact.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default AiGateway;
