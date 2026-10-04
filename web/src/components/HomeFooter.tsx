import { ArrowUpRightIcon } from "lucide-react";
import { LANDING_DOCS, LANDING_HOME, LANDING_PRICING, LANDING_PRIVACY, LANDING_TERMS } from "@/src/lib/routes";

export function HomeFooter() {
  return (
    <footer className="relative z-10 mx-auto mt-12 w-full max-w-5xl px-6 pb-8">
      <div className="flex flex-col justify-between gap-8 border-t border-border pt-10 sm:flex-row">
        <div>
          <a href={LANDING_HOME} aria-label="Tau home" className="inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight"><span className="logo-mark size-6" aria-hidden="true" />tau</a>
          <p className="mt-3 text-sm text-muted-foreground">A little curiosity. Something real.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">Your next idea is closer than you think.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-start gap-x-7 gap-y-4 text-xs text-muted-foreground">
          <a href={LANDING_DOCS} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">Docs<ArrowUpRightIcon className="size-3" /></a>
          <a href={LANDING_PRICING} className="transition-colors hover:text-foreground">Pricing</a>
          <a href={LANDING_PRIVACY} className="transition-colors hover:text-foreground">Privacy</a>
          <a href={LANDING_TERMS} className="transition-colors hover:text-foreground">Terms</a>
        </nav>
      </div>
      <div className="mt-10 flex items-center justify-between gap-4 text-[10px] text-muted-foreground/70"><span>© {new Date().getFullYear()} tau</span><span>describe it. build it.</span></div>
    </footer>
  );
}
