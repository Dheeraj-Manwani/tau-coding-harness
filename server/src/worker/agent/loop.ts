import type OpenAI from "openai";
import { clientForModel } from "@/lib/kimi";
import { imageGenerationAvailable } from "@/lib/openrouter";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getNextSequence } from "@/lib/sequence";
import { meter, type MeterResult } from "@/lib/credits";
import { toCredits, MIN_SPEND_TO_START_MICRO } from "@/lib/pricing";
import { bus } from "@/lib/bus";
import { publish, makeIndexer } from "../lib/publish";
import { captureException, log } from "../lib/log";
import { captureAppScreenshot } from "../lib/screenshot";
import { markProjectWorkspaceStarted } from "../lib/projectWorkspace";
import { putScreenshot } from "@/lib/s3";
import type { Sandbox } from "../lib/sandbox";
import { waitForPreviewHttp, previewSupportsHealth } from "../lib/previewReadiness";
import {
  BASE_APP_TOOLS,
  PROVISION_SANDBOX_BASE_TOOL,
  TOOL_DEFINITIONS,
} from "./tools/tools";

export type SandboxRef = { current: Sandbox | null };
import { executeTool } from "./tools/executor";
import { projectSecretNames } from "@/lib/projectSecrets";
import {
  FinishReason,
  MessageRole,
  MessageType,
  ToolCallStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  MAX_TOKENS,
  MAX_TRUNCATION_RETRIES,
  MAX_INTENT_NUDGES,
  contextBudgetForModel,
  INTENT_TO_CONTINUE_RE,
  TRUNCATION_NUDGE,
  PREVIEW_PORT,
  buildSystemPrompt,
  modelForEffort,
  budgetForEffort,
} from "./config";
import { manageContext } from "./context/manager";
import { requestText, restoredEntry } from "./context/restore";
import { loadStandingNote } from "./context/standing";
import { loadPlan, unfinishedPlanNote } from "./plan";
import { createClearingState } from "./context/clearing";
import { jobIdsIn, reasoningOf, shapeHistory } from "./context/history";
import { deliverDocs, docStateFrom } from "./docs/delivery";
import {
  isMemoryPath,
  loadAppBrief,
  loadAppBriefParts,
  memoryProblems,
  renderAppBrief,
} from "./context/appBrief";
import {
  DESIGN_CHECK_TAIL,
  createWorkLog,
  findingsForWrite,
  finishItems,
  gateMessage,
  noteWork,
  type GateState,
} from "./finishGate";
import { designContextOf } from "../design";
import { formatFindings } from "../design/checks";
import {
  cachedPromptTokens,
  createCalibration,
  estimateStringTokens,
  estimateTokens,
  estimateTokensCalibrated,
  recalibrate,
} from "./context/tokens";
import type { Entry } from "./context/types";
import {
  TEMPLATES,
  resolveTemplateKey,
  type TemplateGeneration,
} from "../templates/registry";
import type { Tool } from "./tools/tools";
import type { Effort } from "@/generated/prisma/enums";

type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type FunctionToolCall =
  OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

/**
 * What the agent is told when it has used all its turns. It has no tools on
 * this turn, so it cannot start anything it would then leave half done.
 */
export const TURN_CAP_NUDGE =
  "You have used all the turns this request allows, and can make no more tool calls. Write your closing message to the user now, in plain language: what is built and working, what you did not get to, and what to ask for next to finish. Do not apologise at length, and do not describe files or tools.";

function isFunctionToolCall(tc: ToolCall): tc is FunctionToolCall {
  return tc.type === "function";
}

// Fail-closed threshold: after this many consecutive metering failures while
// enforcing, stop the job as if the hold were exhausted so a persistent DB
// problem can't hand out unlimited free generation.
const MAX_CONSECUTIVE_METER_FAILURES = 3;

/** meter() with one immediate retry; idempotent per (jobId, sequence), so a
 *  retried turn is never double-charged. */
async function meterWithRetry(
  ...args: Parameters<typeof meter>
): Promise<MeterResult> {
  try {
    return await meter(...args);
  } catch {
    return await meter(...args);
  }
}

const SUBAGENT_TOOLS = new Set<string>([
  "dispatch_explorer",
  "dispatch_debugger",
  "dispatch_verifier",
  "dispatch_design_reviewer",
  "dispatch_implementer",
]);

// Planning/todo-tracking tools are dropped for LOW: the calls themselves cost
// turns on a tight budget, and the multi-phase discipline they encourage is
// aimed at longer work LOW isn't meant to take on. HIGH/MAX keep all three.
const LOW_EXCLUDED_TOOLS = new Set<string>([
  "create_plan",
  "add_todos",
  "update_todo",
  // A design review is a second model looking at screenshots: worth its cost
  // on a build someone asked to be done well, not on a quick one.
  "dispatch_design_reviewer",
]);

function toolsForRun(
  effort: Effort,
  generation: TemplateGeneration,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  // A sub-agent that writes code is on trial (ENABLE_IMPLEMENTER, off by default).
  const implementerOnTrial = (t: { function: { name: string } }) =>
    t.function.name !== "dispatch_implementer" || env.ENABLE_IMPLEMENTER;
  const byEffort = (
    effort === "LOW"
      ? TOOL_DEFINITIONS.filter((t) => !LOW_EXCLUDED_TOOLS.has(t.function.name))
      : [...TOOL_DEFINITIONS]
  ).filter(implementerOnTrial);

  // Without a key for it there is no tool for making pictures, rather than a
  // tool that always says no. And never on a quick build: it costs real money.
  const withoutPictures = (t: { function: { name: string } }) =>
    t.function.name !== "generate_image" || (effort !== "LOW" && imageGenerationAvailable());
  // Generation 2 has no stack to choose, so its `provision_sandbox` takes no
  // `template` argument (replaced in place to keep the tool order stable), and
  // it grows a backend or database through two tools generation 1 never sees.
  // The list is the same at every stack level, so adding a backend mid-project
  // does not change the tools the provider has cached.
  const defs =
    generation === 2
      ? [
          ...byEffort.map((t) =>
            t.function.name === "provision_sandbox"
              ? PROVISION_SANDBOX_BASE_TOOL
              : t,
          ),
          ...BASE_APP_TOOLS.filter(withoutPictures),
        ]
      : byEffort;
  return defs as unknown as OpenAI.Chat.Completions.ChatCompletionTool[];
}

const FILE_MUTATING_TOOLS = new Set<string>([
  "create_file",
  "generate_image",
  "edit_file",
  "delete_file",
  "dispatch_implementer",
  "add_backend",
  "add_database",
]);

const TOOL_SCHEMA_TOKENS = estimateStringTokens(
  JSON.stringify(TOOL_DEFINITIONS),
);

async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Includes the browser navigation timeout plus the deliberately generous
// render-settle/retry window in captureAppScreenshot().
const SCREENSHOT_BUDGET_MS = 60_000;

export async function captureProjectScreenshot(
  projectId: string,
  userId: string,
  url: string,
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("screenshot budget exceeded")),
      SCREENSHOT_BUDGET_MS,
    ),
  );

  await Promise.race([
    (async () => {
      const jpeg = await captureAppScreenshot(url);
      const key = await putScreenshot(userId, projectId, jpeg);
      await prisma.project.update({
        where: { id: projectId },
        data: { previewImageKey: key, previewImageUpdatedAt: new Date() },
      });
      log.info("screenshot.capture.success", {
        projectId,
        bytes: jpeg.length,
      });
    })(),
    timeout,
  ]);
}

function deriveTitle(content: string | null): string {
  const text = (content ?? "").trim();
  if (!text) return "Untitled";
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const title = firstLine.split(/\s+/).slice(0, 5).join(" ");
  return title.slice(0, 80) || "Untitled";
}

interface StoredToolResult {
  tool_call_id: string;
  content: string;
}

/**
 * Make a reloaded history legal for the completions API, in both directions:
 *
 *  - every `tool_calls` entry gets an answer (a run that died mid-tool-turn
 *    persisted the assistant row but never the results), and
 *  - every `tool` message has a preceding assistant that actually asked for it
 *    (an orphan is just as fatal, and can survive a partial delete or a
 *    hand-edited history).
 *
 * Without the second half the array looks balanced right up until the request
 * 400s, which surfaces to the user as "the next prompt is broken forever".
 */
export function balanceToolResults(entries: Entry[]): Entry[] {
  // Ids the immediately-preceding assistant actually requested. Reset at every
  // non-tool entry, so a `tool` message stranded after a user turn is dropped.
  let requested = new Set<string>();
  const out: Entry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    if (entry.param.role === "tool") {
      if (!requested.has(entry.param.tool_call_id)) continue; // orphan
      out.push(entry);
      continue;
    }

    out.push(entry);

    const param = entry.param;
    requested =
      param.role === "assistant" && param.tool_calls
        ? new Set(param.tool_calls.map((tc) => tc.id))
        : new Set();

    if (param.role !== "assistant") continue;
    const toolCalls = param.tool_calls;
    if (!toolCalls || toolCalls.length === 0) continue;

    // Ids answered by the contiguous run of tool messages that follow.
    const answered = new Set<string>();
    for (let j = i + 1; j < entries.length; j++) {
      const next = entries[j]!.param;
      if (next.role !== "tool") break;
      answered.add(next.tool_call_id);
    }

    for (const tc of toolCalls) {
      if (answered.has(tc.id)) continue;
      out.push({
        param: {
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            error: "The previous run ended before this tool finished.",
          }),
        },
        seq: entry.seq,
      });
    }
  }
  return out;
}

/**
 * Load the history the model is sent for a project.
 *
 * The shaping — earlier requests cleared, each request's effort note attached
 * — is `shapeHistory` in context/history.ts; this does the three queries it
 * needs and makes the result legal for the API.
 *
 * @param currentJob the request being run. Its own rows are replayed in full,
 *                   and its effort is used directly rather than looked up.
 *                   `note` is attached to the message that started it.
 *                   Omitted by callers outside a run (chat summarize, the
 *                   context-usage figure), for which every request is earlier.
 */
export async function loadHistory(
  projectId: string,
  currentJob?: { id: string; effort: Effort; note?: string | null },
): Promise<Entry[]> {
  const checkpoint = await prisma.contextCheckpoint.findFirst({
    where: { projectId },
    orderBy: { upToSequence: "desc" },
  });

  const rows = await prisma.message.findMany({
    where: {
      projectId,
      ...(checkpoint ? { sequence: { gt: checkpoint.upToSequence } } : {}),
    },
    orderBy: { sequence: "asc" },
  });

  const jobIds = jobIdsIn(rows);
  const jobs =
    jobIds.length > 0
      ? await prisma.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, effort: true },
        })
      : [];
  const effortByJob = new Map<string, Effort>(jobs.map((j) => [j.id, j.effort]));
  if (currentJob) effortByJob.set(currentJob.id, currentJob.effort);

  return balanceToolResults(
    shapeHistory(rows, {
      checkpointSummary: checkpoint?.summary,
      currentJobId: currentJob?.id,
      effortByJob,
      currentRequestNote: currentJob?.note,
    }),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A run stopped by one of the agent's own guard rails rather than by an
 * underlying failure. Carries the specific {@link FinishReason} so the runner
 * records *why* the job died instead of flattening every guard rail into
 * `ERROR` — the whole point of the column is telling a model that loops
 * (`TURN_CAP`) from one that overruns its response limit (`TRUNCATION_CAP`)
 * from one that hangs (`WALL_CLOCK`).
 */
export class AgentStopError extends Error {
  constructor(
    readonly finishReason: FinishReason,
    message: string,
  ) {
    super(message);
    this.name = "AgentStopError";
  }
}

/** The reasons a run can end *without* throwing — see `Job.finishReason`. */
export type CleanFinishReason = Extract<
  FinishReason,
  "DONE" | "BUDGET" | "INSUFFICIENT_CREDITS" | "CANCELLED"
>;

export async function runAgentLoop(
  jobId: string,
  projectId: string,
  userId: string,
  prompt: string,
  effort: Effort,
  initialSandbox?: Sandbox,
): Promise<CleanFinishReason> {
  void prompt;
  const sandboxRef: SandboxRef = { current: initialSandbox ?? null };
  const nextIndex = makeIndexer(jobId);
  const model = modelForEffort(effort);
  const budget = budgetForEffort(effort);
  const deadline = Date.now() + budget.maxWallClockMs;
  // Declared out here so the catch can report which turn the run died on —
  // "failed on turn 1" and "failed on turn 180" are very different incidents.
  let turn = 0;

  try {
    // Determine which template the agent is (or will be) working in. A template
    // is "selected" once files have been scaffolded against it — before that the
    // agent still gets to pick it via provision_sandbox, so it sees the chooser.
    const [project, fileCount, secretNames] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { templateKey: true },
      }),
      prisma.projectFile.count({ where: { projectId } }),
      projectSecretNames(projectId),
    ]);
    const selected = fileCount > 0;
    // Same resolution `provisionSandbox` does, so the stack the prompt
    // describes is the one the sandbox boots. The agent's own `template`
    // argument is not known yet; on generation 1 an unselected project shows
    // the stack chooser instead, so the key does not matter until it is.
    const templateKey = resolveTemplateKey({
      storedKey: project?.templateKey,
      locked: selected,
      newProjectGeneration: env.TEMPLATE_GENERATION,
    });
    const generation = TEMPLATES[templateKey].generation;
    const tools = toolsForRun(effort, generation);
    // No `effort` here: it travels with each request's own message (see
    // context/history.ts), so the system prompt is the same at every effort.
    const systemPrompt = buildSystemPrompt({
      templateKey,
      selected,
      secretNames,
    });

    // The app's memory file and a computed map of the app, handed over with
    // the request so the run does not open by reading them (context/appBrief.ts).
    // Null on generation 1, and for an app that does not exist yet — that one
    // gets it from `provision_sandbox` instead, below.
    let briefGiven = false;
    const briefParts =
      generation === 2 && selected ? await loadAppBriefParts(projectId) : null;
    const brief = briefParts ? renderAppBrief(briefParts, "request") : null;
    if (brief) briefGiven = true;
    // The app's design, for checking what this run writes against it
    // (design/checks.ts). Null when the app has no DESIGN.md: with no design
    // there is nothing to have stepped outside of.
    let design = designContextOf(briefParts?.design);
    // Design faults already reported this run, so a fault is not repeated on
    // every later save of the same file.
    const reportedFindings = new Set<string>();
    log.info("job.brief", {
      jobId,
      projectId,
      given: brief !== null,
      chars: brief?.length ?? 0,
    });

    // If the request before this one stopped part-way, what it had planned
    // and how far it got (agent/plan.ts).
    const previousPlan = await unfinishedPlanNote(projectId, jobId).catch(() => null);
    if (previousPlan) log.info("job.previous_plan", { jobId, projectId });
    // What the user has told tau to do every time, in their settings
    // (context/standing.ts). First, so it frames everything after it.
    const standing = await loadStandingNote(projectId);
    const requestNote = [standing, brief, previousPlan].filter(Boolean).join("\n\n") || null;

    let entries: Entry[] = [
      { param: { role: "system", content: systemPrompt }, seq: null },
      ...(await loadHistory(projectId, { id: jobId, effort, note: requestNote })),
    ];
    let truncationRetries = 0;
    let intentNudges = 0;
    let meterFailures = 0;
    let summarizations = 0;

    let filesChanged = false;
    let verifierRan = false;
    let reviewerRan = false;
    // What this run did to the app, and which end-of-run items have been
    // raised already (finishGate.ts).
    const work = createWorkLog();
    const gate: GateState = new Set();
    // The tool schema is a fixed part of every request, counted apart from the messages.
    const calibration = createCalibration(TOOL_SCHEMA_TOKENS);
    // What has been cleared from the model-facing context so far this run.
    // Carried across turns so a decision, once made, is never undone.
    const clearing = createClearingState();
    // Which guides are already in the conversation, so tau attaches each one
    // once (docs/delivery.ts). Generation 1 carries its instructions in the
    // system prompt and gets no attachments.
    let docs =
      generation === 2 ? docStateFrom(entries.map((e) => e.param)) : null;
    // Running totals for the end-of-run cache summary.
    let totalInputTokens = 0;
    let totalCachedTokens = 0;

    type StopReason = Exclude<CleanFinishReason, "DONE">;
    let stopReason: StopReason | null = null;
    // The run has used its turns and is being given one more, without tools, to
    // say where it got to (`TURN_CAP_NUDGE`).
    let wrappingUp = false;

    const finishRun = async (reason: StopReason): Promise<void> => {
      const notice =
        reason === FinishReason.CANCELLED
          ? "⏹️ Stopped. This run was halted before the task finished — send another message to continue."
          : reason === FinishReason.BUDGET
            ? "⚠️ This run reached its per-request credit budget and was stopped before finishing. Send another message to continue where it left off."
            : "⚠️ Out of credits — this run was stopped before the task finished. Add credits, then send another message to continue.";

      await prisma.$transaction(async (tx) => {
        const seq = await getNextSequence(tx, projectId);
        await tx.message.create({
          data: {
            project: { connect: { id: projectId } },
            job: { connect: { id: jobId } },
            role: MessageRole.ASSISTANT,
            type: MessageType.RESULT,
            content: { content: notice } as unknown as Prisma.InputJsonValue,
            sequence: seq,
          },
        });
      });

      // The runner emits the terminal frame only after Job.status and
      // finishReason have been committed, so a refresh cannot see an active
      // job after receiving an end-of-run event.
    };

    while (true) {
      if (!stopReason && bus.isCancelled(jobId)) {
        stopReason = FinishReason.CANCELLED;
      }
      if (stopReason) break;

      if (turn++ >= budget.maxAgentTurns) {
        // Stopping here with nothing said leaves the user with a half-built app
        // and no idea how far it got. One more turn, with no tools to call, in
        // which it reports. The run still ends as a turn-cap stop afterwards.
        wrappingUp = true;
        entries.push({ param: { role: "user", content: TURN_CAP_NUDGE }, seq: null });
      }

      // Wall-clock backstop. `maxAgentTurns` bounds a *progressing* loop; it
      // does nothing for one wedged inside a single turn (a stalled model
      // stream, a sandbox command that never returns). Without this a job can
      // hold RUNNING — and the user's shimmer — indefinitely.
      if (Date.now() > deadline) {
        throw new AgentStopError(
          FinishReason.WALL_CLOCK,
          `Agent exceeded its ${Math.round(budget.maxWallClockMs / 60_000)}-minute time budget`,
        );
      }

      // Liveness. Bumped before the expensive part of the turn so the reaper can
      // tell "still working" from "the process that owned this job is gone".
      await prisma.job
        .update({
          where: { id: jobId },
          data: { lastHeartbeatAt: new Date(), currentTurn: turn },
        })
        .catch((err) =>
          captureException(err, { jobId, detail: "heartbeat update failed" }),
        );

      const mgmt = await manageContext(entries, {
        model,
        calibration,
        clearing,
        // What a summary would otherwise lose, put back exactly. Read at the
        // moment of the summary: `docs` still lists the guides the summary is
        // about to drop, and the brief is the app as this run has left it.
        restore: async () => {
          const state = {
            request: await requestText(projectId, jobId).catch(() => null),
            effort,
            plan: await loadPlan(jobId).catch(() => null),
            work:
              generation === 2
                ? { created: [...work.created], edited: [...work.edited], deleted: work.deleted }
                : null,
            guides: docs ? [...docs.loaded] : [],
            standing: await loadStandingNote(projectId),
            brief: generation === 2 ? await loadAppBrief(projectId, "restored") : null,
          };
          const entry = restoredEntry(state);
          log.info("context.restored", {
            jobId,
            projectId,
            turn,
            request: state.request !== null,
            todos: state.plan?.todos.length ?? 0,
            filesChanged: state.work ? state.work.created.length + state.work.edited.length : 0,
            guides: state.guides,
            brief: state.brief !== null,
            chars: String(entry.param.content).length,
          });
          return entry;
        },
      });
      entries = mgmt.entries;

      if (mgmt.summarized) {
        summarizations++;
        const s = mgmt.summarized;
        // The summary replaced the results that carried the guides, so they
        // are no longer in front of the model: look again, and let the next
        // trigger attach them afresh.
        if (docs) docs = docStateFrom(entries.map((e) => e.param));
        try {
          await prisma.contextCheckpoint.create({
            data: {
              projectId,
              jobId,
              upToSequence: s.upToSequence,
              summary: s.summary,
              tokensBefore: s.tokensBefore,
              tokensAfter: s.tokensAfter,
            },
          });
        } catch (err) {
          captureException(err, {
            jobId,
            projectId,
            detail: "failed to persist context checkpoint",
          });
        }

        try {
          const summarySeq = -summarizations;
          await prisma.tokenUsage.create({
            data: {
              userId,
              projectId,
              jobId,
              model,
              inputTokens: s.usage.inputTokens,
              outputTokens: s.usage.outputTokens,
            },
          });
          const mr = await meterWithRetry(
            userId,
            jobId,
            model,
            s.usage.inputTokens,
            s.usage.outputTokens,
            summarySeq,
            { enforce: env.CREDITS_ENFORCE },
          );
          if (env.CREDITS_ENFORCE) {
            await publish(jobId, {
              type: "credits_update",
              available: toCredits(mr.available),
              availableMicro: mr.available.toString(),
            });
          }
        } catch (err) {
          captureException(err, {
            jobId,
            userId,
            detail: "failed to meter summarization",
          });
        }
        await publish(jobId, {
          type: "context_summarized",
          upToSequence: s.upToSequence,
          tokensBefore: s.tokensBefore,
          tokensAfter: s.tokensAfter,
        });
      }

      if (mgmt.compacted) {
        await publish(jobId, {
          type: "context_compacted",
          tokensBefore: mgmt.compacted.tokensBefore,
          tokensAfter: mgmt.compacted.tokensAfter,
        });
      }

      const contextTokens =
        estimateTokensCalibrated(mgmt.ctx, calibration);
      const contextBudget = contextBudgetForModel(model);
      log.info("job.turn", {
        jobId,
        projectId,
        turn,
        model,
        contextTokens,
        contextBudget,
        contextPct: Number(((contextTokens / contextBudget) * 100).toFixed(1)),
      });
      // Live feed for the context-usage ring (doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md).
      // `triggeredAutoRun` is set only on the turn that actually ran compaction/
      // summarization, so the frontend knows to flash rather than just update.
      await publish(jobId, {
        type: "context_usage",
        usagePercent: Number(((contextTokens / contextBudget) * 100).toFixed(1)),
        tokensUsed: contextTokens,
        tokensBudget: contextBudget,
        ...(mgmt.summarized
          ? { triggeredAutoRun: "summarize" as const }
          : mgmt.compacted
            ? { triggeredAutoRun: "compact" as const }
            : {}),
      });
      bus.setPhase(jobId, "llm", {
        turn,
        model,
        sandboxId: sandboxRef.current?.sandboxId ?? null,
      });

      const stream = clientForModel(model).chat.completions.stream({
        model,
        max_tokens: MAX_TOKENS,
        ...(wrappingUp ? {} : { tools }),
        messages: mgmt.ctx,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          await publish(jobId, { type: "llm_chunk", content: delta });
          process.stdout.write(delta);
        }
      }

      const completion = await stream.finalChatCompletion();
      const choice = completion.choices[0];
      if (!choice) throw new Error("Deepseek returned no completion choices");

      const assistant = choice.message;
      const toolCalls = (assistant.tool_calls ?? []).filter(isFunctionToolCall);
      const isToolTurn =
        choice.finish_reason === "tool_calls" && toolCalls.length > 0;
      // The model hit MAX_TOKENS mid-response — the turn is incomplete and any
      // tool call it started has truncated (invalid-JSON) arguments.
      const isTruncated = choice.finish_reason === "length";

      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;

      // How much of this request the provider served from its prefix cache.
      // Cached input is billed at a fraction of the normal rate, so this — not
      // the raw input count — is what says whether the context is being kept
      // stable from turn to turn. Logged only: metering is unchanged.
      const cachedTokens = cachedPromptTokens(completion.usage);
      totalInputTokens += inputTokens;
      totalCachedTokens += cachedTokens;
      log.info("job.usage", {
        jobId,
        projectId,
        turn,
        model,
        inputTokens,
        cachedTokens,
        cachedPct:
          inputTokens > 0
            ? Number(((cachedTokens / inputTokens) * 100).toFixed(1))
            : 0,
        outputTokens,
      });

      // Ground-truth correction: compare what we guessed for this exact payload
      // (messages + tool schema) against what the model actually reports.
      if (inputTokens > 0) {
        recalibrate(calibration, estimateTokens(mgmt.ctx), inputTokens);
      }

      const { assistantMessageId, sequence } = await prisma.$transaction(
        async (tx) => {
          const seq = await getNextSequence(tx, projectId);
          const created = await tx.message.create({
            data: {
              project: { connect: { id: projectId } },
              job: { connect: { id: jobId } },
              role: MessageRole.ASSISTANT,
              type: isToolTurn ? MessageType.TOOL_REQ : MessageType.RESULT,
              content: {
                content: assistant.content,
                // Persist the *filtered* calls — the ones we actually answer
                // below. Storing the raw list would replay a tool_call with no
                // matching tool result for any non-function call, which the
                // completions API rejects outright.
                //
                // Never persist a truncated/partial tool call either: on a
                // recovery reload it is an assistant tool_call with no result.
                tool_calls: isToolTurn ? toolCalls : null,
                // The model's own reasoning, which DeepSeek wants back with every
                // tool-call turn it is shown again. Without it a later request
                // (a resumed run, any follow-up) is refused with a 400.
                ...reasoningOf(assistant),
              } as unknown as Prisma.InputJsonValue,
              sequence: seq,
              inputTokens,
              outputTokens,
            },
          });

          await tx.tokenUsage.create({
            data: {
              userId,
              projectId,
              jobId,
              model,
              inputTokens,
              outputTokens,
            },
          });

          return { assistantMessageId: created.id, sequence: seq };
        },
      );

      let holdExhausted = false;
      let meterAvailable: bigint | null = null;
      try {
        const meterResult = await meterWithRetry(
          userId,
          jobId,
          model,
          inputTokens,
          outputTokens,
          sequence,
          { enforce: env.CREDITS_ENFORCE },
        );
        holdExhausted = meterResult.holdExhausted;
        meterAvailable = meterResult.available;
        meterFailures = 0;
        // Live balance tick: let the UI's CreditsWidget count down turn by turn
        // instead of waiting for its 60s poll.
        if (env.CREDITS_ENFORCE) {
          await publish(jobId, {
            type: "credits_update",
            available: toCredits(meterResult.available),
            availableMicro: meterResult.available.toString(),
          });
        }
      } catch (err) {
        captureException(err, {
          jobId,
          userId,
          sequence,
          detail: "meter failed",
        });
        // Fail-closed once metering has failed repeatedly (see constant).
        if (
          env.CREDITS_ENFORCE &&
          ++meterFailures >= MAX_CONSECUTIVE_METER_FAILURES
        ) {
          holdExhausted = true;
        }
      }

      // The report is written and charged for; now the run ends as it always did.
      if (wrappingUp) {
        throw new AgentStopError(
          FinishReason.TURN_CAP,
          `Agent exceeded ${budget.maxAgentTurns} turns without finishing`,
        );
      }

      if (env.CREDITS_ENFORCE && isToolTurn && !stopReason) {
        if (holdExhausted) {
          stopReason = FinishReason.BUDGET;
        } else if (
          meterAvailable !== null &&
          meterAvailable < MIN_SPEND_TO_START_MICRO
        ) {
          stopReason = FinishReason.INSUFFICIENT_CREDITS;
        }
      }

      // Truncated turn: the response was cut off at MAX_TOKENS. Don't treat it
      // as "done" — feed the partial text back and nudge the model to continue
      // in smaller pieces. Give up after a few consecutive truncations.
      if (isTruncated) {
        if (++truncationRetries > MAX_TRUNCATION_RETRIES) {
          throw new AgentStopError(
            FinishReason.TRUNCATION_CAP,
            `Response truncated at the token limit ${MAX_TRUNCATION_RETRIES} times in a row`,
          );
        }
        if (assistant.content?.trim()) {
          entries.push({
            param: { role: "assistant", content: assistant.content },
            seq: null,
          });
        }
        entries.push({
          param: { role: "user", content: TRUNCATION_NUDGE },
          seq: null,
        });
        continue;
      }
      truncationRetries = 0;

      // Non-tool turn that merely narrates intent ("Let me write the page…")
      // without acting — nudge it to actually use its tools, up to a cap.
      if (
        !isToolTurn &&
        intentNudges < MAX_INTENT_NUDGES &&
        INTENT_TO_CONTINUE_RE.test((assistant.content ?? "").trim())
      ) {
        intentNudges++;
        if (assistant.content?.trim()) {
          entries.push({
            param: { role: "assistant", content: assistant.content },
            seq: null,
          });
        }
        entries.push({
          param: {
            role: "user",
            content:
              "Continue and actually perform the work using your tools — don't " +
              "just describe what you're about to do. If the task is genuinely " +
              "complete, reply with your brief final summary.",
          },
          seq: null,
        });
        continue;
      }

      // The model says it is done. Before taking its word, see what the run
      // still owes — design faults in what it wrote, a look at the result, a
      // verification pass, the app's memory — and send all of it back at once.
      // Each kind is raised at most once, so this cannot loop.
      if (!isToolTurn) {
        const owed = await finishItems(
          {
            generation,
            effort,
            work,
            filesChanged,
            verifierRan,
            reviewerRan,
            design,
            reported: reportedFindings,
            sandbox: sandboxRef.current,
            projectId,
            userId,
          },
          gate,
        );
        if (owed.length > 0) {
          log.info("job.finish_gate", {
            jobId,
            projectId,
            turn,
            owed: owed.map((item) => `${item.kind}: ${item.reason}`),
          });
          if (assistant.content?.trim()) {
            entries.push({
              param: { role: "assistant", content: assistant.content },
              seq: null,
            });
          }
          entries.push({
            param: { role: "user", content: gateMessage(owed) },
            seq: null,
          });
          continue;
        }
      }

      if (!isToolTurn) {
        let previewUrl: string | null = null;
        if (sandboxRef.current) {
          const host = sandboxRef.current.getHost(PREVIEW_PORT);
          previewUrl = `https://${host}`;
          await waitForPreviewHttp(previewUrl);
          await markProjectWorkspaceStarted(projectId);
          await publish(jobId, { type: "preview_ready", url: previewUrl, healthCheck: await previewSupportsHealth(previewUrl), readyAt: new Date().toISOString() });

          await prisma.fragment.create({
            data: {
              message: { connect: { id: assistantMessageId } },
              job: { connect: { id: jobId } },
              sandboxUrl: previewUrl,
              title: deriveTitle(assistant.content),
            },
          });
        }

        if (previewUrl) {
          if (env.SCREENSHOT_ENABLED) {
            log.info("screenshot.capture.start", { jobId, projectId });
            await captureProjectScreenshot(projectId, userId, previewUrl).catch(
              (err) =>
                captureException(err, {
                  jobId,
                  projectId,
                  detail: "screenshot failed",
                }),
            );
          } else {
            // This used to be a silent skip, making a deployment typo look
            // exactly like a broken browser or R2 upload.
            log.warn("screenshot.capture.disabled", { jobId, projectId });
          }
        }

        // The runner publishes `done` after it persists the terminal Job row.
        // The thumbnail has already been written before we return there.
        break;
      }

      // Push the filtered calls, not `assistant.tool_calls`: only these get a
      // `tool` reply below, and every tool_call in the array must be answered
      // before the next request or the API 400s the whole turn.
      entries.push({
        param: {
          role: "assistant",
          content: assistant.content,
          tool_calls: toolCalls,
        },
        seq: sequence,
      });

      // Execute one tool call end to end (persist row, publish req/res, run it)
      // and return its stored result. Safe to call concurrently.
      const runOne = async (
        tc: FunctionToolCall,
      ): Promise<StoredToolResult> => {
        if (bus.isCancelled(jobId)) {
          return { tool_call_id: tc.id, content: JSON.stringify({ cancelled: true }) };
        }
        const toolName = tc.function.name;
        const toolCallId = tc.id;

        if (FILE_MUTATING_TOOLS.has(toolName)) filesChanged = true;
        if (toolName === "dispatch_verifier") verifierRan = true;
        if (toolName === "dispatch_design_reviewer") reviewerRan = true;

        let input: unknown;
        try {
          input = tc.function.arguments
            ? JSON.parse(tc.function.arguments)
            : {};
        } catch {
          input = { _raw: tc.function.arguments };
        }

        const toolCallRow = await prisma.toolCall.create({
          data: {
            message: { connect: { id: assistantMessageId } },
            toolCallId,
            toolName,
            input: input as Prisma.InputJsonValue,
            status: ToolCallStatus.RUNNING,
            startedAt: new Date(),
          },
        });

        await publish(jobId, { type: "tool_req", toolName, toolCallId, input });
        bus.setPhase(
          jobId,
          SUBAGENT_TOOLS.has(toolName)
            ? (`subagent:${toolName.replace("dispatch_", "")}` as const)
            : (`tool:${toolName}` as const),
        );

        let output: unknown;
        try {
          output = await executeTool(
            toolName as Tool,
            input,
            sandboxRef,
            jobId,
            projectId,
            userId,
            nextIndex,
            model,
            effort,
            toolCallRow.id,
          );
          if (generation === 2) {
            noteWork(work, toolName, input, output);
            // An app that did not exist when the request started could not be
            // described then. It exists now: hand over the same block.
            if (toolName === "provision_sandbox" && !briefGiven) {
              const created = await loadAppBriefParts(projectId);
              if (created && isPlainRecord(output) && !("error" in output)) {
                briefGiven = true;
                design = designContextOf(created.design);
                output = { ...output, app: renderAppBrief(created, "provisioned") };
              }
            }
            // What was just written, checked against the app's design while it
            // is still the file in hand.
            if (design && isPlainRecord(output) && !("error" in output)) {
              const found = await findingsForWrite(
                design,
                reportedFindings,
                toolName,
                input,
                sandboxRef.current,
              ).catch(() => []);
              if (found.length > 0) {
                log.info("job.design_check", {
                  jobId,
                  projectId,
                  turn,
                  rules: [...new Set(found.map((f) => f.rule))],
                  count: found.length,
                });
                output = {
                  ...output,
                  designCheck: `Saved. tau checked this file against the app's design and found:\n${formatFindings(found, 8)}\n${DESIGN_CHECK_TAIL}`,
                };
              }
            }
            // The file was just written whole, so its limits can be checked
            // here rather than at the end of the run.
            if (toolName === "create_file" && isPlainRecord(input) && isMemoryPath(input.path)) {
              const problems =
                typeof input.content === "string" ? memoryProblems(input.content) : [];
              if (problems.length > 0 && isPlainRecord(output) && !("error" in output)) {
                output = {
                  ...output,
                  memoryNote: `Saved, but fix this now: ${problems.join("; and ")}.`,
                };
              }
            }
          }
          if (docs) {
            const withDocs = deliverDocs(docs, toolName, input, output);
            output = withDocs.output;
            for (const d of withDocs.delivered) {
              log.info("job.doc", {
                jobId,
                projectId,
                turn,
                doc: d.name,
                via: d.via,
                tool: toolName,
                ...(d.repeat ? { repeat: true } : {}),
              });
            }
          }
          await prisma.toolCall.update({
            where: { id: toolCallRow.id },
            data: {
              status: ToolCallStatus.SUCCESS,
              output: output as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          output = { error: message };
          await prisma.toolCall.update({
            where: { id: toolCallRow.id },
            data: {
              status: ToolCallStatus.FAILED,
              error: message,
              completedAt: new Date(),
            },
          });
        }

        await publish(jobId, { type: "tool_res", toolCallId, output });
        const live = bus.registryEntry(jobId);
        if (live) bus.setPhase(jobId, "llm", { toolCallCount: live.toolCallCount + 1 });
        return { tool_call_id: toolCallId, content: JSON.stringify(output) };
      };

      const toolResults: StoredToolResult[] = new Array(toolCalls.length);
      let i = 0;
      while (i < toolCalls.length) {
        if (SUBAGENT_TOOLS.has(toolCalls[i]!.function.name)) {
          const start = i;
          while (
            i < toolCalls.length &&
            SUBAGENT_TOOLS.has(toolCalls[i]!.function.name)
          ) {
            i++;
          }
          const batch = toolCalls.slice(start, i);
          const batchResults = await runPool(
            batch,
            budget.maxParallelSubagents,
            (tc) => runOne(tc),
          );
          for (let k = 0; k < batchResults.length; k++) {
            toolResults[start + k] = batchResults[k]!;
          }
        } else {
          toolResults[i] = await runOne(toolCalls[i]!);
          i++;
        }
      }

      const toolResSequence = await prisma.$transaction(async (tx) => {
        const sequence = await getNextSequence(tx, projectId);
        await tx.message.create({
          data: {
            project: { connect: { id: projectId } },
            job: { connect: { id: jobId } },
            role: MessageRole.USER,
            type: MessageType.TOOL_RES,
            content: toolResults as unknown as Prisma.InputJsonValue,
            sequence,
          },
        });
        return sequence;
      });

      for (const r of toolResults) {
        entries.push({
          param: {
            role: "tool",
            tool_call_id: r.tool_call_id,
            content: r.content,
          },
          seq: toolResSequence,
        });
      }
    }

    log.info("job.cache", {
      jobId,
      projectId,
      model,
      turns: turn,
      inputTokens: totalInputTokens,
      cachedTokens: totalCachedTokens,
      cachedPct:
        totalInputTokens > 0
          ? Number(((totalCachedTokens / totalInputTokens) * 100).toFixed(1))
          : 0,
    });

    if (stopReason) {
      await finishRun(stopReason);
      return stopReason;
    }
    return FinishReason.DONE;
  } catch (err) {
    // Deliberately no terminal frame here. The runner owns that decision: it
    // may still retry this job, and a frame emitted now would close the
    // client's stream and orphan the retry (§2.4). `markFailed` publishes once
    // the runner has actually given up.
    captureException(err, { jobId, projectId, userId, effort, model, turn });
    throw err;
  }
}
