import { Fragment, lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Zap } from "lucide-react";
import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { appPath } from "@/src/lib/routes";
import { Hero } from "./sections/StormHero";
import XRayLens from "./sections/XRayLens";
import { hasRecording } from "./data/replay";
import "./storm.css";

const BuildReplay = lazy(() => import("./sections/BuildReplay"));

const MARQUEE_ITEMS = [
  {
    label: "Finance dashboard",
    prompt: "Build me a personal finance dashboard with charts…",
  },
  {
    label: "Coffee shop site",
    prompt: "Create a landing page for my coffee shop…",
  },
  { label: "Kanban board", prompt: "Make a kanban board with drag-and-drop…" },
  {
    label: "Portfolio with a blog",
    prompt: "Design a portfolio site with a blog…",
  },
  { label: "Real-time chat", prompt: "Build a real-time chat app with rooms…" },
  {
    label: "Store admin panel",
    prompt: "Spin up an admin panel for my store…",
  },
  {
    label: "Habit tracker",
    prompt: "Build a habit tracker with streaks and reminders…",
  },
  {
    label: "Recipe box",
    prompt: "Make a recipe box where I can save and tag recipes…",
  },
];

export default function Landing() {
  const [ribbonHover, setRibbonHover] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const copyPrompt = (text: string, key: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedItem(key);
        setTimeout(() => setCopiedItem((c) => (c === key ? null : c)), 1400);
      })
      .catch(() => {});
  };
  const buildPrompt = (text: string) => {
    window.location.assign(appPath(text));
  };

  useDocumentMeta({
    title: "Tau",
    exactTitle: true,
    description:
      "Describe what you want and tau turns it into a working app while you watch. Start free with 300 credits and no card.",
    canonical: "/",
  });
  return (
    <div className="storm-landing">
      <Hero />
      <div
        className={`storm-marquee ${ribbonHover ? "paused" : ""} ${hoveredItem ? "spotlight" : ""}`}
        onMouseEnter={() => setRibbonHover(true)}
        onMouseLeave={() => setRibbonHover(false)}
      >
        <div>
          {Array.from({ length: 2 }, (_, i) => (
            <Fragment key={i}>
              {MARQUEE_ITEMS.flatMap((item, j) => {
                const key = `${i}-${j}`;
                return [
                  <span
                    key={`t-${key}`}
                    className={`marquee-item ${hoveredItem === key ? "is-active" : ""}`}
                    aria-hidden={i === 1 ? "true" : undefined}
                    onMouseEnter={() => setHoveredItem(key)}
                    onMouseLeave={() =>
                      setHoveredItem((h) => (h === key ? null : h))
                    }
                  >
                    <span
                      className={
                        j % 2 === 0 ? "marquee-hollow" : "marquee-solid"
                      }
                    >
                      {item.label}
                    </span>
                    {hoveredItem === key && (
                      <span className="marquee-actions">
                        <button
                          type="button"
                          onClick={() => copyPrompt(item.prompt, key)}
                        >
                          {copiedItem === key ? "Copied" : "Copy prompt"}
                        </button>
                        <button
                          type="button"
                          onClick={() => buildPrompt(item.prompt)}
                        >
                          Build it
                        </button>
                      </span>
                    )}
                  </span>,
                  <span
                    key={`b-${key}`}
                    className="marquee-bolt"
                    aria-hidden="true"
                  >
                    <Zap />
                  </span>,
                ];
              })}
            </Fragment>
          ))}
        </div>
        <div className="marquee-fade" />
      </div>
      <section id="how-it-works" className="storm-container storm-band">
        <div className="eyebrow">// HOW IT WORKS</div>
        <h2>
          Four strikes to
          <br />
          <span>a running app</span>
        </h2>
        <div className="steps-grid">
          <div className="step-connector" aria-hidden="true">
            <span />
          </div>
          <article>
            <div className="step-number">01</div>
            <h3>Share your idea</h3>
            <p>
              Type a sentence, attach a sketch or a screenshot, and set the
              effort.
            </p>
            <div className="step-preview">
              <div className="step-composer-text">
                Make a kanban board with drag-and-drop
                <span className="step-caret" aria-hidden="true" />
              </div>
              <div className="step-composer-row">
                <span className="step-pills">
                  <span>LOW</span>
                  <span className="is-active">HIGH</span>
                  <span>MAX</span>
                </span>
                <span className="step-strike-mini">Strike ↗</span>
              </div>
            </div>
          </article>
          <article>
            <div className="step-number">02</div>
            <h3>See the plan</h3>
            <p>
              tau writes a todo list before any code, then ticks items off as it
              goes.
            </p>
            <div className="step-preview">
              <div className="step-plan-head">PLAN · 2 / 4</div>
              <div className="step-plan-row">
                <span className="check">✓</span>Board and card models
              </div>
              <div className="step-plan-row">
                <span className="check">✓</span>Drag between columns
              </div>
              <div className="step-plan-row is-active">
                <span className="step-shimmer-logo" aria-hidden="true" />
                <span className="step-shimmer-text">is thinking…</span>
              </div>
              {/* <div className="step-plan-row is-empty">
                <span>○</span>Empty states
              </div> */}
            </div>
          </article>
          <article>
            <div className="step-number">03</div>
            <h3>Watch it build</h3>
            <p>
              Files, commands and decisions stream into the chat. Reload and you
              lose nothing.
            </p>
            <div className="step-preview">
              <div className="step-build-row">
                <span>write</span> src/Board.tsx
              </div>
              <div className="step-build-row">
                <span>write</span> src/useBoard.ts
              </div>
              <div className="step-build-row step-build-run">
                <span>run</span> npm run build
              </div>
              <div className="step-plan-row is-active">
                <span className="step-shimmer-logo" aria-hidden="true" />
                <span className="step-shimmer-text">is working…</span>
              </div>
              <div className="step-progress" aria-hidden="true">
                {Array.from({ length: 10 }, (_, k) => (
                  <span key={k} className={k < 6 ? "lit" : ""} />
                ))}
              </div>
            </div>
          </article>
          <article>
            <div className="step-number is-final">04</div>
            <h3>Try it, improve it</h3>
            <p>
              Your app runs on a live URL. Ask for changes or edit the code
              yourself.
            </p>
            <div className="step-preview">
              <div className="step-browser-bar">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span className="url">kanban.tauai.pro</span>
              </div>
              <div className="step-live-area">
                <div className="step-board-loader" aria-hidden="true">
                  <span className="step-spinner" />
                  <span className="step-shimmer-text">Building…</span>
                </div>
                <div className="step-board" aria-hidden="true">
                  <div className="step-board-col">
                    <span className="step-board-head">To do</span>
                    <div className="step-board-card" />
                  </div>
                  <div className="step-board-col">
                    <span className="step-board-head">Doing</span>
                    <div className="step-board-card" />
                    <div className="step-board-card" />
                  </div>
                  <div className="step-board-col">
                    <span className="step-board-head">Done</span>
                    <div className="step-board-card" />
                  </div>
                </div>
                <span className="step-live-badge">● LIVE</span>
              </div>
            </div>
          </article>
        </div>
      </section>
      <XRayLens />
      {hasRecording && (
        <Suspense fallback={<div style={{ minHeight: 480 }} />}>
          <BuildReplay />
        </Suspense>
      )}
      <section id="ship" className="storm-container storm-band split-band">
        <div>
          <div className="eyebrow">// SHIP IT</div>
          <h2>
            Grounded
            <br />
            <span>in GitHub</span>
          </h2>
          <p>
            Nothing is locked inside tau. Push your code to GitHub and keep your
            credentials out of the export.
          </p>
          <div className="ship-steps">
            <h3>01　Connect once</h3>
            <p>Push as a new PR, an update to one, or straight to a branch.</p>
            <h3>02　Keep your code</h3>
            <p>Your project is yours to edit and build on.</p>
            <h3>03　Secrets stay grounded</h3>
            <p>Credential-shaped files are filtered from exports.</p>
          </div>
          <Link className="outline-link" to="/docs/ship/github">
            Explore GitHub export →
          </Link>
        </div>
        <div className="ship-diagram">
          <div className="ship-node">τ</div>
          <div className="ship-line" />
          <div className="ship-output">
            <h3>
              GITHUB <small>OPEN</small>
            </h3>
            <pre>PR #14 · kanban-board{"\n"}+412 −18 · 9 files</pre>
            <div className="secret-note mono">
              ⊘ .env · STAYS IN THE SANDBOX
            </div>
          </div>
        </div>
      </section>
      <section id="mobile" className="storm-container storm-band split-band">
        <div>
          <div className="eyebrow">// MOBILE</div>
          <h2>
            Start on the train.
            <br />
            <span>Finish at your desk.</span>
          </h2>
          <p>
            The tau app covers prompting, following the build and checking the
            preview. The code editor and GitHub stay on desktop, on purpose.
          </p>
        </div>
        <div className="phone-demo">
          <div className="mono">
            τ <span>kanban-board</span>
          </div>
          <div className="chat-bubble">Add a due date to each card</div>
          <p>On it. Adding a date field and a “due soon” badge.</p>
          <div className="phone-preview mono">live preview</div>
          <div className="mock-input">Ask for a change…</div>
        </div>
      </section>
      <section className="storm-cta storm-band">
        <div className="storm-container">
          <a
            href={appPath()}
            aria-label="Describe the app. Its brain comes with it. Build an AI app."
            className="block"
          >
            <img
              src="/bottom-cta.png"
              alt="Describe the app. Its brain comes with it. Build an AI app."
              className="h-auto w-full"
            />
          </a>
        </div>
      </section>
    </div>
  );
}
