/**
 * Records a real build's SSE stream into the landing page's replay fixture.
 *
 * The §4.4 band on the landing page claims "this is a real run, replayed". That
 * claim is only true if the transcript came off a live job, so this exists
 * instead of anyone hand-authoring `replay.json`. Run it against a job you have
 * just started and let it record to completion.
 *
 *   bun run landing/scripts/capture-replay.ts --job <jobId> --token <accessToken>
 *
 * Getting the two arguments:
 *   • Start a build in the web app.
 *   • jobId: the network tab's `/jobs/<id>/stream` request, or the `jobId` in
 *     the response to `POST /project/init`.
 *   • token: in the browser console on the app, the in-memory access token is
 *     what the stream URL already carries as `?token=`. Copy it from that URL.
 *
 * Options:
 *   --api <url>     API base. Defaults to $API_URL, then http://localhost:3000.
 *   --out <path>    Output. Defaults to the landing page's fixture.
 *   --prompt <text> The sentence that started the build; goes in the header.
 *   --effort <tier> LOW | HIGH | MAX. Defaults to HIGH.
 *
 * What it scrubs: every id that identifies a real user, project, job or
 * sandbox: tool-call ids, preview hostnames, and any absolute sandbox paths.
 * What it keeps: the shape and the timing, because those are the point.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Args {
  job?: string;
  token?: string;
  api?: string;
  out?: string;
  prompt?: string;
  effort?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "") as keyof Args | undefined;
    if (key) args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const apiUrl = args.api ?? process.env["API_URL"] ?? "http://localhost:3000";
// Anchored to this file, not the cwd. It used to be a bare "web/src/..." path
// that only resolved when run from the repo root; the script lives inside
// landing/, so cwd-relative would silently write to the wrong place.
const DEFAULT_OUT = resolve(
  import.meta.dir,
  "..",
  "src/features/marketing/data/replay.json",
);
const outPath = args.out ? resolve(args.out) : DEFAULT_OUT;

const { job: jobId, token } = args;
if (!jobId || !token) {
  console.error(
    "Usage: bun run landing/scripts/capture-replay.ts --job <jobId> --token <accessToken>",
  );
  process.exit(1);
}

/** Replaces anything that could identify a real user, project or sandbox. */
function scrub<T>(value: T): T {
  if (typeof value === "string") {
    return value
      // E2B sandbox hostnames leak the sandbox id.
      .replace(/https?:\/\/[a-z0-9-]+\.e2b\.app[^\s"']*/gi, "https://preview.example")
      // Absolute sandbox paths.
      .replace(/\/home\/user\/app\//g, "")
      // Bare uuids anywhere in prose or tool payloads.
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "redacted",
      ) as unknown as T;
  }
  if (Array.isArray(value)) return value.map(scrub) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // Tool-call ids correlate a replay back to a real job.
      out[key] = key === "toolCallId" ? "call" : scrub(item);
    }
    return out as T;
  }
  return value;
}

interface Recorded {
  at: number;
  event: Record<string, unknown>;
}

const recorded: Recorded[] = [];
const startedAt = Date.now();

const url =
  `${apiUrl}/jobs/${encodeURIComponent(jobId)}/stream` +
  `?token=${encodeURIComponent(token)}&lastEventIndex=-1`;

console.error(`[capture] connecting to ${apiUrl}/jobs/${jobId}/stream`);

const response = await fetch(url, { headers: { accept: "text/event-stream" } });
const body = response.body;
if (!response.ok || !body) {
  console.error(`[capture] stream failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const reader = body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let finished = false;

function handleLine(line: string): void {
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (!payload) return;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return;
  }
  recorded.push({ at: Date.now() - startedAt, event: scrub(event) });
  const type = event["type"];
  if (typeof type === "string") {
    process.stderr.write(`\r[capture] ${recorded.length} events (${type})   `);
    if (type === "done" || type === "error" || type === "cancelled") finished = true;
  }
}

while (!finished) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) handleLine(line);
}
await reader.cancel().catch(() => {});

const files = new Set<string>();
for (const { event } of recorded) {
  if (event["type"] === "file_start" && typeof event["path"] === "string") {
    files.add(event["path"]);
  }
}
const turns = recorded.filter((r) => r.event["type"] === "thinking").length;

const fixture = {
  recorded: true,
  meta: {
    prompt: args.prompt ?? "",
    effort: (args.effort ?? "HIGH").toUpperCase(),
    turns,
    files: files.size,
    durationMs: recorded.length > 0 ? recorded[recorded.length - 1]!.at : 0,
    // Capture a screenshot of the finished app separately and drop the path in.
    previewImage: null,
  },
  events: recorded,
};

writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.error(
  `\n[capture] wrote ${recorded.length} events (${files.size} files, ${turns} turns) to ${outPath}`,
);
console.error(
  "[capture] review it for anything identifying before committing, then " +
    "screenshot the finished app into landing/src/features/marketing/assets/ and " +
    "set meta.previewImage.",
);
