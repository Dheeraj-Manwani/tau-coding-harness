import type {
  PreviewRuntimeError,
  PreviewRuntimeErrorEntry,
} from "@/src/features/project/types";

/**
 * Reading the errors a preview reports about itself.
 *
 * They arrive by `postMessage` from the monitor tau puts in every preview
 * page, and end up in a prompt. The message is checked for its origin before
 * it gets here; this checks its shape. A generated app runs in that frame too
 * and can post whatever it likes from the same origin, so nothing is taken on
 * trust: only the fields the API accepts, each within the API's limits, and no
 * more entries than it takes. Anything else is dropped rather than sent on to
 * be refused.
 *
 * Limits mirror `runtimeErrorSchema` in the API.
 */

const KINDS: ReadonlySet<string> = new Set(["error", "rejection", "script"]);
const MAX_ERRORS = 5;
const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;
const MAX_AT = 500;
const MAX_PATH = 500;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function entry(raw: unknown): PreviewRuntimeErrorEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, message, stack, at, count } = raw as Record<string, unknown>;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  const said = text(message, MAX_MESSAGE);
  if (!said) return null;
  const trace = text(stack, MAX_STACK);
  const where = text(at, MAX_AT);
  return {
    kind: kind as PreviewRuntimeErrorEntry["kind"],
    message: said,
    ...(trace ? { stack: trace } : {}),
    ...(where ? { at: where } : {}),
    ...(typeof count === "number" && Number.isInteger(count) && count > 1
      ? { count: Math.min(count, 1_000_000) }
      : {}),
  };
}

/** The errors in a monitor message, or null when it carries none worth sending. */
export function parseRuntimeError(data: unknown): PreviewRuntimeError | null {
  if (!data || typeof data !== "object") return null;
  const { errors, path } = data as { errors?: unknown; path?: unknown };
  if (!Array.isArray(errors)) return null;
  // The first five that are usable, not the usable ones among the first five.
  const list = errors
    .slice(0, 50)
    .map(entry)
    .filter((e): e is PreviewRuntimeErrorEntry => e !== null)
    .slice(0, MAX_ERRORS);
  if (list.length === 0) return null;
  const route = text(path, MAX_PATH);
  return { ...(route?.startsWith("/") ? { path: route } : {}), errors: list };
}
