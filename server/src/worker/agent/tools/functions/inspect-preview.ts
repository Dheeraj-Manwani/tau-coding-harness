import type Sandbox from "e2b";
import { env } from "@/lib/env";
import { log } from "@/worker/lib/log";
import {
  inspectPreview,
  normalizePath,
  previewInspectAvailable,
  type InspectOptions,
} from "@/worker/lib/previewInspect";
import type { PreviewReport } from "@/worker/lib/previewReport";
import type { PageAction } from "@/worker/lib/screenshot";
import { PREVIEW_PORT } from "../../config";

/** The most things one inspection will do to a page before reading it. */
export const MAX_INSPECT_STEPS = 4;

/**
 * Inspections each run has asked for, main agent and sub-agents together.
 *
 * Kept in memory rather than counted from stored tool calls, as picture
 * generation counts its own, because a sub-agent's calls are not stored and
 * the limit is for the run as a whole. A restart forgets the count; a run does
 * not survive a restart either.
 */
const used = new Map<string, { count: number; at: number }>();
const FORGET_AFTER_MS = 3 * 60 * 60 * 1000;

function countFor(jobId: string): number {
  return used.get(jobId)?.count ?? 0;
}

function noteOne(jobId: string): number {
  const now = Date.now();
  for (const [id, entry] of used) {
    if (now - entry.at > FORGET_AFTER_MS) used.delete(id);
  }
  const count = countFor(jobId) + 1;
  used.set(jobId, { count, at: now });
  return count;
}

/** For tests. */
export function resetInspectionCounts(): void {
  used.clear();
}

/** The steps as the page will be asked to do them; anything malformed is dropped. */
export function parseSteps(steps: unknown): PageAction[] {
  if (!Array.isArray(steps)) return [];
  const actions: PageAction[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const { click, fill, with: value } = step as { click?: unknown; fill?: unknown; with?: unknown };
    if (typeof click === "string" && click.trim()) {
      actions.push({ click: click.trim().slice(0, 80) });
    } else if (typeof fill === "string" && fill.trim() && typeof value === "string") {
      actions.push({ fill: fill.trim().slice(0, 80), with: value.slice(0, 120) });
    }
    if (actions.length >= MAX_INSPECT_STEPS) break;
  }
  return actions;
}

interface Deps {
  available: () => boolean;
  inspect: (origin: string, options: InspectOptions) => Promise<PreviewReport>;
  maxPerRun: number;
}

const REAL: Deps = {
  available: previewInspectAvailable,
  inspect: inspectPreview,
  maxPerRun: env.PREVIEW_INSPECT_MAX_PER_RUN,
};

/**
 * `inspect_preview`: open a route of the app in tau's browser and return what
 * its developer tools would show (worker/lib/previewInspect.ts).
 *
 * Makes no model call. What it costs is context: the result is read again on
 * every later step, which is why a run has a limited number of them and why
 * the result is built small.
 */
export async function inspectPreviewTool(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  deps: Deps = REAL,
) {
  if (!deps.available()) {
    return {
      unavailable: true,
      error:
        "tau cannot open the app in a browser on this instance. Check it the other ways: type-check, and `curl` the page and any API route. Do not call this again.",
    };
  }
  if (countFor(jobId) >= deps.maxPerRun) {
    return {
      refused: true,
      error: `This request has used its ${deps.maxPerRun} inspections. Do not call this again: work from what the earlier ones found.`,
    };
  }

  const { path, steps, viewport, verbose } = (input ?? {}) as {
    path?: unknown;
    steps?: unknown;
    viewport?: unknown;
    verbose?: unknown;
  };
  const route = normalizePath(path);
  const count = noteOne(jobId);
  const started = Date.now();
  const report = await deps.inspect(`https://${sandbox.getHost(PREVIEW_PORT)}`, {
    path: route,
    steps: parseSteps(steps),
    viewport: viewport === "mobile" ? "mobile" : "desktop",
    verbose: verbose === true,
  });
  log.info("preview.inspect", {
    jobId,
    path: route,
    status: report.status,
    exceptions: report.exceptions?.length ?? 0,
    failedRequests: report.network?.failed.length ?? 0,
    ms: Date.now() - started,
    count,
  });

  const left = deps.maxPerRun - count;
  return { ...report, ...(left <= 3 ? { inspectionsLeft: left } : {}) };
}
