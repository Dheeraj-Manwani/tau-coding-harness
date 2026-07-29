import { Accordion } from "radix-ui";
import { ChevronDownIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { FAQ } from "@/src/features/marketing/data/faq";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";

/**
 * §4.11 — the FAQ.
 *
 * Radix's accordion, so the keyboard and screen-reader behaviour is right
 * without reinventing it. The open/close height animation is CSS driven by
 * Radix's own `--radix-accordion-content-height`, which means it costs one
 * composited transition rather than a measured JS animation per item.
 *
 * The answers live in `data/faq.ts`, where each one is annotated against §9.
 */
export function Faq() {
  return (
    <section id="faq" className="mx-auto w-full max-w-3xl px-6 py-24">
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          Questions
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          The things people ask first.
        </h2>
      </ScrollReveal>

      <Accordion.Root type="single" collapsible className="mt-12">
        {FAQ.map((item) => (
          <Accordion.Item
            key={item.question}
            value={item.question}
            className="border-b border-silver-200"
          >
            <Accordion.Header>
              <Accordion.Trigger className="group flex w-full items-center justify-between gap-4 py-5 text-left text-base font-medium text-silver-900 outline-none transition-colors hover:text-blue-300 focus-visible:text-blue-300">
                {item.question}
                <ChevronDownIcon className="size-4 shrink-0 text-silver-600 transition-transform duration-300 group-data-[state=open]:rotate-180" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="accordion-content overflow-hidden">
              <div className="relative pb-5 pl-4 pr-8 text-sm text-silver-600">
                {/* The left rule the answer unrolls against. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-blue-500/60 to-transparent"
                />
                <p>{item.answer}</p>
                {item.link && (
                  <Link
                    to={item.link.to}
                    className="mt-3 inline-block text-blue-500 hover:underline"
                  >
                    {item.link.label} →
                  </Link>
                )}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </section>
  );
}

export default Faq;
