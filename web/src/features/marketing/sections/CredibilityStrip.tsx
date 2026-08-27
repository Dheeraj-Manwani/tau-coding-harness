import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";

/**
 * §4.2 — the credibility strip.
 *
 * These are the things tau actually runs on, not customers. §9's first hard
 * rule is no fake social proof: no invented logos, no "trusted by" counts. A
 * stack you can verify is worth more than a wall of borrowed marks, and it is
 * the only version of this band we are allowed to ship.
 *
 * The marquee is a CSS translation on a duplicated row — no JS, no rAF. The
 * second copy exists purely so the loop has something to scroll into; it is
 * hidden from assistive tech so the list isn't read out twice.
 */

const STACK = [
  "E2B sandboxes",
  "DeepSeek",
  "Moonshot Kimi",
  "Cloudflare R2",
  "Postgres",
  "Razorpay",
];

function Row({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <ul
      aria-hidden={ariaHidden}
      className="flex shrink-0 items-center gap-12 pr-12"
    >
      {STACK.map((item) => (
        <li
          key={item}
          className="whitespace-nowrap text-sm font-medium text-silver-400 transition-colors duration-300 hover:text-silver-900"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function CredibilityStrip() {
  const reduceMotion = useReduceMotion();

  return (
    <section className="py-10" aria-label="What tau is built on">
      <p className="mb-6 text-center text-xs uppercase tracking-[0.18em] text-silver-600">
        Built on
      </p>
      <div
        className={cn(
          "relative overflow-hidden",
          // Fade both edges so items enter and leave rather than being clipped.
          "[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]",
        )}
      >
        {reduceMotion ? (
          // The static frame is a plain, centred, wrapping list — everything is
          // legible at once, which is what the marquee was trying to achieve.
          <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {STACK.map((item) => (
              <li key={item} className="text-sm font-medium text-silver-400">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <div className="marquee flex w-max">
            <Row />
            <Row ariaHidden />
          </div>
        )}
      </div>
    </section>
  );
}

export default CredibilityStrip;
