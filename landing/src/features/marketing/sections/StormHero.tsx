import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { appPath } from "@/src/lib/routes";
import type { Effort } from "@/src/features/project/types";
import { ElectricBorder } from "@/src/components/ui/electric-border";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { SpaceCanvas, type SpaceCanvasHandle } from "./SpaceCanvas";

/** Mirrors the old composer's rotating suggestions, before any text is typed. */
const SUGGESTIONS = [
  "Build me a personal finance dashboard with charts…",
  "Create a landing page for my coffee shop…",
  "Make a kanban board with drag-and-drop…",
  "Design a portfolio site with a blog…",
  "Build a real-time chat app with rooms…",
  "Spin up an admin panel for my store…",
];

export function StormComposer({
  compact = false,
  /** Disables the placeholder rotation/glitch and the MAX electric border. */
  calm = false,
  onStrike,
  formRef,
}: {
  compact?: boolean;
  calm?: boolean;
  onStrike?: () => void;
  formRef?: RefObject<HTMLFormElement | null>;
}) {
  const [prompt, setPrompt] = useState("");
  const [effort, setEffort] = useState<Effort>("HIGH");
  const [suggestion, setSuggestion] = useState(0);
  const reduceMotion = useReduceMotion();
  const showPlaceholder = prompt.length === 0;

  useEffect(() => {
    if (calm || !showPlaceholder || reduceMotion) return;
    const id = setInterval(
      () => setSuggestion((i) => (i + 1) % SUGGESTIONS.length),
      4000,
    );
    return () => clearInterval(id);
  }, [calm, showPlaceholder, reduceMotion]);

  return (
    <ElectricBorder
      active={!calm && effort === "MAX"}
      reducedMotion={reduceMotion}
      color="#60a5fa"
      borderRadius={compact ? 10 : 14}
    >
      <form
        ref={formRef}
        className={`storm-composer ${(calm ? effort !== "LOW" : effort === "HIGH") ? "is-charged" : ""} ${compact ? "compact" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          onStrike?.();
          window.location.assign(appPath(prompt.trim() || undefined));
        }}
      >
        <div className="composer-field">
          <textarea
            aria-label="Describe the app you want to build"
            rows={compact ? 1 : 2}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          {showPlaceholder &&
            (calm ? (
              <span className="composer-placeholder is-static" aria-hidden="true">
                {SUGGESTIONS[0]}
              </span>
            ) : (
              <span
                key={suggestion}
                className="composer-placeholder"
                aria-hidden="true"
              >
                {SUGGESTIONS[suggestion]}
              </span>
            ))}
        </div>
        <div className="composer-controls">
          <span className="mono composer-label">YOUR IDEA STARTS HERE</span>
          <div className="effort-controls">
            <span className="mono">EFFORT</span>
            <div className="effort-group" role="group" aria-label="Build effort">
              {(["LOW", "HIGH", "MAX"] as const).map((tier) => (
                <button
                  type="button"
                  key={tier}
                  aria-pressed={effort === tier}
                  onClick={() => setEffort(tier)}
                >
                  {tier}
                </button>
              ))}
            </div>
            <button className="strike" type="submit">
              Strike ↗
            </button>
          </div>
        </div>
      </form>
    </ElectricBorder>
  );
}

export function Hero() {
  const stormRef = useRef<SpaceCanvasHandle>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  return (
    <section id="overview" className="storm-hero">
      <SpaceCanvas ref={stormRef} target={() => composerRef.current} />
      <div className="storm-container hero-content">
        <Link className="gateway-badge mono" to="/docs/ai/overview">
          <b>NEW</b> AI GATEWAY IS IN BETA →
        </Link>
        <div className="hero-grid">
          <h1>
            Describe it.
            <br />
            <span data-text="Build it.">Build it.</span>
          </h1>
          <div className="hero-copy">
            <p>
              One sentence in. tau plans the work, writes real code and runs it
              in a live sandbox while you watch every step.
            </p>
            <div className="mono forecast">
              ● FORECAST · 100% CHANCE OF SHIPPING
            </div>
            <div className="hero-links">
              <Link className="outline-link" to="/docs">
                Read the docs
              </Link>
              <Link to="/pricing">See pricing →</Link>
            </div>
          </div>
        </div>
        <StormComposer
          onStrike={() => stormRef.current?.pulse()}
          formRef={composerRef}
        />
        <div className="hero-meta mono">
          <span>● HIGH EFFORT · READY TO BUILD</span>
          <span>300 FREE CREDITS · NO CARD · YOUR CODE, YOURS TO KEEP</span>
        </div>
        <a className="scroll-cue mono" href="#how-it-works">
          SCROLL<span>↓</span>
        </a>
      </div>
    </section>
  );
}
