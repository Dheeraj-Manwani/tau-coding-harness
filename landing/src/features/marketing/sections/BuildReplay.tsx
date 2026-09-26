import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, PauseIcon, PlayIcon } from "lucide-react";

import { ChatMarkdown } from "@/src/components/ChatMarkdown";
import { ChatLoader } from "@/src/components/ui/tau-loader";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";
import {
  formatDuration,
  hasRecording,
  replay,
} from "@/src/features/marketing/data/replay";
import { ScrollReveal } from "@/src/features/marketing/motion/ScrollReveal";
import { Typewriter } from "@/src/features/marketing/motion/Typewriter";
import { useRafLoop } from "@/src/features/marketing/motion/useRafLoop";
import {
  applyReplayEvent,
  emptyView,
  snapshotView,
  viewAt,
  type ReplayView,
} from "./replay/reduce";

/**
 * §4.4: "This is a real run, replayed."
 *
 * The highest-value band on the page, and the only one whose content we are not
 * allowed to write: it plays back a genuine recorded job. If no recording has
 * been captured yet the band renders nothing at all (see `data/replay.ts`).
 *
 * The clock is a virtual playhead, not a queue of timeouts. That is what makes
 * scrubbing, pausing and the speed toggle work: every visible pane is a pure
 * function of "how far into the recording are we", so seeking backwards is just
 * replaying the fold from zero.
 *
 * The fold accumulates into a ref inside the animation loop and is *snapshotted*
 * into state on a 50ms tick. Two reasons: React never reads a mutating object
 * (the panes are plain state, safe under concurrent rendering), and a 60fps
 * `setState` of the whole transcript would spend the band's entire frame budget
 * on reconciliation for updates nobody can perceive.
 */

/** How often the panes are pushed to React while playing. */
const UI_TICK_MS = 50;
/** Lines of the active file the code pane shows. */
const CODE_LINES = 15;
const SPEEDS = [0.5, 1, 4] as const;
/** Autoplay fires once the band is this far into view. */
const AUTOPLAY_RATIO = 0.4;
/** Pause before a still-visible replay starts over. */
const LOOP_DELAY_MS = 1500;

interface Marker {
  at: number;
  label: string;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function BuildReplay() {
  const reduceMotion = useReduceMotion();
  const sectionRef = useRef<HTMLElement>(null);

  const events = replay.events;
  const duration = replay.meta.durationMs;

  const viewRef = useRef<ReplayView>(emptyView());
  const cursorRef = useRef(0);
  const timeRef = useRef(0);
  const lastUiPushRef = useRef(0);
  const inViewRef = useRef(false);
  // Mirrors `started` for the observer, which must not resubscribe when it flips.
  const startedRef = useRef(false);

  const [view, setView] = useState<ReplayView>(emptyView);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const [started, setStarted] = useState(false);

  /** Milestones worth marking on the scrub bar. */
  const markers = useMemo<Marker[]>(() => {
    const found: Marker[] = [];
    let seenFile = false;
    for (const entry of events) {
      const { type } = entry.event;
      if (type === "plan_created") found.push({ at: entry.at, label: "Plan" });
      if (type === "file_start" && !seenFile) {
        seenFile = true;
        found.push({ at: entry.at, label: "First file" });
      }
      if (type === "preview_ready") found.push({ at: entry.at, label: "Preview" });
    }
    return found;
  }, [events]);

  /**
   * The finished state, computed once. Doubles as the reduced-motion frame and
   * as the poster the band shows before anyone has pressed play.
   */
  const finalView = useMemo(
    () => viewAt(events, Number.MAX_SAFE_INTEGER),
    [events],
  );

  const seek = useCallback(
    (ms: number) => {
      timeRef.current = ms;
      viewRef.current = viewAt(events, ms);
      const next = events.findIndex((entry) => entry.at > ms);
      cursorRef.current = next === -1 ? events.length : next;
      setView(snapshotView(viewRef.current));
      setTime(ms);
    },
    [events],
  );

  useRafLoop(
    (delta, now) => {
      timeRef.current += delta * speed;

      while (
        cursorRef.current < events.length &&
        events[cursorRef.current]!.at <= timeRef.current
      ) {
        applyReplayEvent(viewRef.current, events[cursorRef.current]!);
        cursorRef.current += 1;
      }

      if (timeRef.current >= duration) {
        timeRef.current = duration;
        setView(snapshotView(viewRef.current));
        setTime(duration);
        setPlaying(false);
        // Loop only for someone still watching it.
        window.setTimeout(() => {
          if (!inViewRef.current) return;
          seek(0);
          setPlaying(true);
        }, LOOP_DELAY_MS);
        return;
      }

      if (now - lastUiPushRef.current >= UI_TICK_MS) {
        lastUiPushRef.current = now;
        setView(snapshotView(viewRef.current));
        setTime(timeRef.current);
      }
    },
    playing && events.length > 0,
  );

  // Autoplay once, when it is genuinely on screen.
  useEffect(() => {
    const element = sectionRef.current;
    if (!element || events.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        inViewRef.current = entry.isIntersecting;
        if (
          entry.isIntersecting &&
          entry.intersectionRatio >= AUTOPLAY_RATIO &&
          !startedRef.current &&
          !reduceMotion
        ) {
          startedRef.current = true;
          setStarted(true);
          setPlaying(true);
        }
      },
      { threshold: [0, AUTOPLAY_RATIO, 1] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [events.length, reduceMotion]);

  if (!hasRecording) return null;

  // Before anyone has pressed play: and always, under reduced motion: the
  // band shows its finished frame rather than three empty panes.
  const shown = started ? view : finalView;
  const shownTime = started ? time : duration;
  const codeBody = shown.activeFileContent
    .split("\n")
    .slice(0, CODE_LINES)
    .join("\n");

  const togglePlay = () => {
    startedRef.current = true;
    if (!playing) {
      if (!started || timeRef.current >= duration) seek(0);
      setStarted(true);
      setPlaying(true);
      return;
    }
    setPlaying(false);
  };

  return (
    <section
      id="replay"
      ref={sectionRef}
      className="mx-auto w-full max-w-6xl px-6 py-24"
    >
      <ScrollReveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-500">
          See a real build
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Watch a real app come together.
        </h2>
        <p className="mt-4 font-mono text-xs text-silver-600">
          {replay.meta.files} files · {formatDuration(duration)} · built with{" "}
          {replay.meta.effort.toLowerCase()} effort
        </p>
      </ScrollReveal>

      <div className="mt-12 overflow-hidden rounded-2xl border border-silver-200 bg-space-surface shadow-2xl">
        <div className="grid min-h-[26rem] grid-cols-1 divide-y divide-silver-200 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
          {/* ── Chat ─────────────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col gap-3 overflow-hidden p-4">
            <PaneLabel>Chat</PaneLabel>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden text-sm">
              {shown.messages.map((message, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl px-3 py-2",
                    message.role === "user"
                      ? "self-end bg-space-overlay text-silver-900"
                      : "text-silver-600",
                  )}
                >
                  {message.role === "user" ? (
                    message.text
                  ) : (
                    <ChatMarkdown content={message.text} compact />
                  )}
                </div>
              ))}
              {shown.thinking && <ChatLoader text={shown.thinking} />}
              {shown.todos.length > 0 && (
                <ul className="mt-1 space-y-1.5 rounded-xl border border-silver-200 p-3">
                  {shown.planName && (
                    <li className="mb-2 text-xs font-medium text-silver-900">
                      {shown.planName}
                    </li>
                  )}
                  {shown.todos.map((todo, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-silver-600"
                    >
                      <span
                        className={cn(
                          "mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
                          todo.done
                            ? "border-flux bg-flux/15 text-flux"
                            : "border-silver-400",
                        )}
                      >
                        {todo.done && <CheckIcon className="size-2.5" />}
                      </span>
                      <span className={cn(todo.done && "text-silver-900")}>
                        {todo.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ── Files + code ─────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col overflow-hidden p-4">
            <PaneLabel>Files</PaneLabel>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {shown.files.map((path, i) => (
                <li
                  key={path}
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-[0.7rem] transition-colors duration-500",
                    i === shown.files.length - 1
                      ? "border-blue-500/60 text-blue-300"
                      : "border-silver-200 text-silver-600",
                  )}
                >
                  {fileName(path)}
                </li>
              ))}
            </ul>
            <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg bg-space-void p-3">
              <p className="mb-2 font-mono text-[0.7rem] text-silver-400">
                {shown.activeFile ?? "-"}
              </p>
              <pre className="overflow-hidden whitespace-pre-wrap break-all font-mono text-[0.7rem] leading-relaxed text-silver-600">
                <Typewriter text={codeBody} active={started} />
              </pre>
            </div>
            {shown.shell.length > 0 && (
              <div className="mt-2 rounded-lg bg-space-void p-2 font-mono text-[0.65rem] leading-relaxed text-silver-400">
                {shown.shell.map((line, i) => (
                  <div key={i} className="truncate">
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Preview ──────────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col overflow-hidden p-4">
            <PaneLabel>Preview</PaneLabel>
            <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-space-void">
              {shown.previewUrl ? (
                <PreviewReveal image={replay.meta.previewImage} />
              ) : (
                <ChatLoader text="Getting the preview ready" />
              )}
            </div>
          </div>
        </div>

        {/* ── Transport ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-t border-silver-200 px-4 py-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause replay" : "Play replay"}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-space-overlay text-silver-900 transition-colors hover:bg-space-overlay/70"
          >
            {playing ? (
              <PauseIcon className="size-3.5" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
          </button>

          <div className="relative min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={duration}
              step={100}
              value={Math.min(shownTime, duration)}
              onChange={(e) => {
                startedRef.current = true;
                setStarted(true);
                setPlaying(false);
                seek(Number(e.target.value));
              }}
              aria-label="Scrub the replay"
              className="w-full accent-[var(--blue-500)]"
            />
            {markers.map((marker) => (
              <span
                key={`${marker.label}-${marker.at}`}
                title={marker.label}
                aria-hidden="true"
                className="pointer-events-none absolute top-0 h-1.5 w-px bg-silver-400"
                style={{ left: `${(marker.at / duration) * 100}%` }}
              />
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSpeed(option)}
                aria-pressed={speed === option}
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-mono text-[0.7rem] transition-colors",
                  speed === option
                    ? "bg-space-overlay text-silver-900"
                    : "text-silver-600 hover:text-silver-900",
                )}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PaneLabel({ children }: { children: string }) {
  return (
    <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-silver-400">
      {children}
    </p>
  );
}

/** Blur-to-sharp on the finished app, once the sandbox reports a live URL. */
function PreviewReveal({ image }: { image: string | null }) {
  const reduceMotion = useReduceMotion();
  const [sharp, setSharp] = useState(reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;
    const frame = requestAnimationFrame(() => setSharp(true));
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion]);

  if (!image) {
    return (
      <p className="px-4 text-center text-xs text-silver-600">
        Your app appears here as it comes to life
      </p>
    );
  }

  return (
    <img
      src={image}
      alt="The finished app running in Tau"
      loading="lazy"
      className="size-full object-cover object-top transition-[filter,opacity] duration-[400ms]"
      style={{
        filter: sharp ? "blur(0px)" : "blur(12px)",
        opacity: sharp ? 1 : 0.4,
      }}
    />
  );
}

export default BuildReplay;
