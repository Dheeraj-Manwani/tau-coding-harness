/**
 * What has to be true before a run is allowed to finish.
 *
 * A model decides it is done by producing a reply with no tool calls. That is
 * a judgement about the *task*, and it is usually right. It is not a check of
 * the things a run owes regardless of the task: that what it wrote follows the
 * app's design, that someone has looked at the result, that the changes were
 * verified, that the app's memory says what the app now is. Those are easy to
 * skip and invisible when skipped, so the harness holds the door: when the
 * model says it is finished, `finishItems` works out which of them are still
 * owed, and the loop sends them back as one message instead of ending the run.
 *
 * ## One message, each thing once
 *
 * Every pass through here costs the user a second closing message — they have
 * already been shown the summary the model thought was final. So:
 *
 *   - everything owed is asked for together, in the order it should be done,
 *     not one item per round trip;
 *   - each kind of item is raised at most once per run. If it is still unmet
 *     afterwards the run ends anyway: a gate that can loop is worse than a
 *     fault that gets through;
 *   - an item is only owed when the run did enough to warrant it. A colour
 *     tweak does not need a design review or a memory update.
 *
 * The system prompt asks for all of these up front, and a model that does them
 * unprompted never sees this. It is a backstop, not the plan.
 *
 * ## It may not hold a run open
 *
 * Working out what is owed means reading files from the sandbox and from
 * storage, and either can stall on a dead connection for minutes. The first
 * version had no limit, and a run that had already given its final answer sat
 * unfinished behind a read that never returned. So the whole check has a
 * deadline (`GATE_TIMEOUT_MS`), and so does the read behind each write-time
 * check: when the time is up the run goes on as if nothing were owed.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §4 and §5.
 */
import { prisma } from "@/lib/prisma";
import { getBlobText } from "@/lib/s3";
import type { Effort } from "@/generated/prisma/enums";
import { readOrNull, type FileSource } from "../lib/appStack";
import { log } from "../lib/log";
import { withDeadline } from "../lib/sandbox";
import {
  checkFile,
  findingKey,
  formatFindings,
  isCheckedPath,
  isScreenSource,
  type CheckContext,
  type Finding,
  type RuleId,
} from "../design/checks";
import { DESIGN_PATH } from "../design/designMd";
import { designReviewAvailable } from "../design/review";
import { MEMORY_PATH, appRelativePath, memoryProblems } from "./context/memoryFile";

// ── What a run has done ──────────────────────────────────────────────────────

/** What a run has done to the app so far. */
export interface WorkLog {
  /** Paths written by `create_file`, memory file excluded. */
  created: Set<string>;
  /** Paths changed by `edit_file`, memory file excluded. */
  edited: Set<string>;
  deleted: number;
  /** `add_backend` / `add_database` set something up. */
  stackGrew: boolean;
  /** The memory file was written or edited. */
  memoryTouched: boolean;
}

export function createWorkLog(): WorkLog {
  return {
    created: new Set(),
    edited: new Set(),
    deleted: 0,
    stackGrew: false,
    memoryTouched: false,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Record one finished tool call. Failed calls changed nothing. */
export function noteWork(
  work: WorkLog,
  tool: string,
  input: unknown,
  output: unknown,
): void {
  if (!isPlainRecord(output) || "error" in output) return;
  const path =
    isPlainRecord(input) && typeof input.path === "string"
      ? appRelativePath(input.path)
      : null;

  if (tool === "create_file" || tool === "edit_file") {
    if (!path) return;
    if (path === MEMORY_PATH) work.memoryTouched = true;
    else (tool === "create_file" ? work.created : work.edited).add(path);
  } else if (tool === "delete_file") {
    work.deleted++;
  } else if (tool === "add_backend" || tool === "add_database") {
    if (!output.alreadySetUp) work.stackGrew = true;
  }
}

/**
 * Whether a run changed the app enough that its memory should have changed
 * too. Deliberately not "any file changed": a color tweak or a copy fix leaves
 * nothing to record. New files, removed files, a new server or database, or
 * edits spread over several files are what a later request would want to have
 * been told about.
 */
export function isSubstantialWork(work: WorkLog): boolean {
  return (
    work.stackGrew ||
    work.created.size > 0 ||
    work.deleted > 0 ||
    work.edited.size >= 4
  );
}

/**
 * Whether a run built or reshaped a screen, as opposed to adjusting one. A new
 * page or component, or edits across three or more of them, changes what the
 * app looks like enough to be worth looking at; one edited file usually does
 * not.
 */
export function reshapedScreens(work: WorkLog): boolean {
  if ([...work.created].some(isScreenSource)) return true;
  return [...work.edited].filter(isScreenSource).length >= 3;
}

// ── Design checks ────────────────────────────────────────────────────────────

/**
 * The checks cannot tell drift from a request. "Make the banner bright red" is
 * the user's to ask, and the answer is not to refuse it but to make it part of
 * the design, where the theme panel and the next request can see it.
 */
const USER_ASKED_EXCEPTION =
  "If the user asked for one of these in so many words — a particular colour, a typeface — keep it, but as part of the design: put it in `src/index.css`, add a line for it under `## Notes for this app` in `.tau/DESIGN.md`, and use it from there rather than writing it into a screen.";

/** How long the end-of-run checks may take before the run finishes without them. */
export const GATE_TIMEOUT_MS = 20_000;
/** How long reading back a file just edited may take before its check is skipped. */
const WRITE_CHECK_TIMEOUT_MS = 8_000;

/** What follows the findings in a `designCheck` on a file just saved. */
export const DESIGN_CHECK_TAIL = `Fix these now. ${USER_ASKED_EXCEPTION}`;

/**
 * Check a file the agent has just written, and return what is newly wrong.
 *
 * Run after every write so a fault is reported while the file is still what
 * the agent is working on. `reported` remembers what has been said, so editing
 * a file with an old fault in it does not report that fault again on every
 * save — the end-of-run pass (`finishItems`) is where anything left over is
 * raised a second time.
 */
export async function findingsForWrite(
  ctx: CheckContext,
  reported: Set<string>,
  tool: string,
  input: unknown,
  sandbox: FileSource | null,
): Promise<Finding[]> {
  if (tool !== "create_file" && tool !== "edit_file") return [];
  if (!isPlainRecord(input) || typeof input.path !== "string") return [];
  const path = appRelativePath(input.path);
  if (!isCheckedPath(path)) return [];

  // A whole-file write is in hand; an edit has to be read back.
  const text =
    tool === "create_file" && typeof input.content === "string"
      ? input.content
      : sandbox
        ? await withDeadline(
            readOrNull(sandbox, path),
            WRITE_CHECK_TIMEOUT_MS,
            `reading ${path} back`,
          ).catch(() => null)
        : null;
  if (text === null) return [];

  const fresh = checkFile(path, text, ctx).filter((f) => !reported.has(findingKey(f)));
  for (const f of fresh) reported.add(findingKey(f));
  return fresh;
}

/**
 * Faults that can be right to leave in: the user asked for an emoji, or for a
 * gradient headline, in so many words. The agent is told about each when it
 * writes one, with that way out. If it is still there at the end, the agent
 * chose to keep it — and asking again only puts a second closing message in
 * front of the user, saying so.
 */
const KEPT_BY_CHOICE: ReadonlySet<RuleId> = new Set(["emoji-icon", "gradient-text"]);

/**
 * Everything still wrong in the files a run touched, and in its dependencies.
 *
 * Checked against the design as it stands now, not as it was when the run
 * began: an agent that added a typeface the user asked for, and named it in
 * `DESIGN.md` as the check tells it to, has made that typeface part of the
 * design.
 */
export async function outstandingFindings(
  ctx: CheckContext,
  work: WorkLog,
  sandbox: FileSource,
  reported: ReadonlySet<string> = new Set(),
): Promise<Finding[]> {
  const paths = new Set(
    [...work.created, ...work.edited].filter(isCheckedPath),
  );
  // Dependencies arrive through `bun add` in a shell, which no file tool sees.
  paths.add("package.json");

  const designText = await readOrNull(sandbox, DESIGN_PATH);
  const now: CheckContext = designText ? { ...ctx, designText } : ctx;

  const all = await Promise.all(
    [...paths].map(async (path) => {
      const text = await readOrNull(sandbox, path);
      return text === null ? [] : checkFile(path, text, now);
    }),
  );
  return all
    .flat()
    .filter((f) => !(KEPT_BY_CHOICE.has(f.rule) && reported.has(findingKey(f))));
}

// ── The gate ─────────────────────────────────────────────────────────────────

export type GateKind = "design_check" | "design_review" | "verify" | "memory";

export interface GateItem {
  kind: GateKind;
  /** For the run log. */
  reason: string;
  /** The instruction, as a markdown list item body. */
  text: string;
}

/** Which kinds have already been raised this run. */
export type GateState = Set<GateKind>;

export interface GateInput {
  generation: 1 | 2;
  effort: Effort;
  work: WorkLog;
  /** Any file-changing tool ran (includes sub-agent writes the work log cannot see). */
  filesChanged: boolean;
  verifierRan: boolean;
  reviewerRan: boolean;
  /** The app's design, when it has one; null turns the design checks off. */
  design: CheckContext | null;
  /** Design faults the agent has already been shown this run (`findingsForWrite`). */
  reported: ReadonlySet<string>;
  sandbox: FileSource | null;
  projectId: string;
  userId: string;
}

async function memoryItem(input: GateInput): Promise<GateItem | null> {
  const { work } = input;
  if (!work.memoryTouched) {
    if (!isSubstantialWork(work)) return null;
    return {
      kind: "memory",
      reason: "stale",
      text: `**Update the app's memory.** This request changed what the app is made of, and \`${MEMORY_PATH}\` — all the next request will know beyond the code — was not updated. Rewrite the sections that changed so it describes the app as it is now; keep all six sections, and keep it short.`,
    };
  }
  // Edits are not checked as they happen (the result is not in hand), so look
  // at what was actually saved.
  try {
    const row = await prisma.projectFile.findUnique({
      where: { projectId_path: { projectId: input.projectId, path: MEMORY_PATH } },
      select: { contentHash: true },
    });
    if (!row) return null;
    const problems = memoryProblems(
      await getBlobText(input.userId, input.projectId, row.contentHash),
    );
    if (problems.length === 0) return null;
    return {
      kind: "memory",
      reason: "invalid",
      text: `**Fix the app's memory file.** \`${MEMORY_PATH}\` needs attention: ${problems.join("; and ")}.`,
    };
  } catch {
    // Never hold a finished run over a check that could not be made.
    return null;
  }
}

/**
 * What the run still owes, in the order to do it. Marks each returned kind as
 * raised in `state`, so a second call returns only what is new.
 *
 * Never throws and never takes longer than `timeoutMs`: if what is owed cannot
 * be worked out in time, nothing is, and nothing is marked as raised.
 */
export async function finishItems(
  input: GateInput,
  state: GateState,
  timeoutMs = GATE_TIMEOUT_MS,
): Promise<GateItem[]> {
  let items: GateItem[];
  try {
    items = await withDeadline(owedItems(input, state), timeoutMs, "the end-of-run checks");
  } catch (err) {
    log.warn("job.finish_gate.skipped", {
      projectId: input.projectId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  for (const item of items) state.add(item.kind);
  return items;
}

/**
 * Order matters: fix what the checks found before having it looked at, have it
 * looked at before verifying, and write the memory last, when the app has
 * stopped changing.
 */
async function owedItems(input: GateInput, state: ReadonlySet<GateKind>): Promise<GateItem[]> {
  const items: GateItem[] = [];
  const designed = input.generation === 2 && input.sandbox !== null;

  if (designed && input.design && !state.has("design_check")) {
    const findings = await outstandingFindings(
      input.design,
      input.work,
      input.sandbox!,
      input.reported,
    ).catch(() => [] as Finding[]);
    if (findings.length > 0) {
      items.push({
        kind: "design_check",
        reason: `${findings.length} finding${findings.length === 1 ? "" : "s"}`,
        text: `**Fix these design faults**, which tau found in the files you changed:\n${formatFindings(findings)}\n${USER_ASKED_EXCEPTION}`,
      });
    }
  }

  if (
    designed &&
    input.effort !== "LOW" &&
    !input.reviewerRan &&
    !state.has("design_review") &&
    reshapedScreens(input.work) &&
    designReviewAvailable()
  ) {
    items.push({
      kind: "design_review",
      reason: "screens reshaped, not reviewed",
      text: "**Have the result looked at.** You built or reshaped screens and nobody has seen them rendered. Call `dispatch_design_reviewer` with the routes concerned, then fix what it reports.",
    });
  }

  if (
    input.effort === "MAX" &&
    input.filesChanged &&
    !input.verifierRan &&
    !state.has("verify")
  ) {
    items.push({
      kind: "verify",
      reason: "MAX effort, not verified",
      text: "**Verify the changes.** You are on MAX effort and changed files without verifying them. Dispatch `dispatch_verifier` over everything you changed (build, then spot-check the affected flows) and fix anything it reports.",
    });
  }

  if (designed && !state.has("memory")) {
    const item = await memoryItem(input);
    if (item) items.push(item);
  }

  return items;
}

/** The message sent back in place of finishing. */
export function gateMessage(items: readonly GateItem[]): string {
  const body =
    items.length === 1
      ? `Before you finish, one thing is still owed.\n\n${items[0]!.text}`
      : `Before you finish, ${items.length} things are still owed. Do them in this order.\n\n${items
          .map((item, i) => `${i + 1}. ${item.text}`)
          .join("\n\n")}`;
  return `${body}\n\nThen close with one short sentence for the user, in plain language. Do not repeat the summary you already gave, and do not mention this note or any file.`;
}
