import type { Effort, JobEvent } from "@/src/features/project/types";
import raw from "./replay.json";

/**
 * The recorded transcript behind §4.4.
 *
 * **This fixture must be recorded, never written.** §9's first hard rule bans
 * invented proof, and a hand-authored "real build" is exactly that: it would
 * be a fabricated demo presented as a genuine run. `scripts/capture-replay.ts`
 * records one from a live job's SSE stream and scrubs the ids out.
 *
 * Until someone runs it, `recorded` is false and the band does not render.
 * A missing section is honest; a fake one is not.
 */

export interface ReplayEvent {
  /** Milliseconds from the start of the job. */
  at: number;
  event: JobEvent;
}

export interface ReplayMeta {
  /** The prompt that started the build. */
  prompt: string;
  effort: Effort;
  turns: number;
  files: number;
  durationMs: number;
  /** Path under `assets/` to a screenshot of the finished app, if captured. */
  previewImage: string | null;
}

export interface ReplayFixture {
  recorded: boolean;
  meta: ReplayMeta;
  events: ReplayEvent[];
}

export const replay = raw as ReplayFixture;

/** The band renders only when there is a genuine recording behind it. */
export const hasRecording = replay.recorded && replay.events.length > 0;

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
}
