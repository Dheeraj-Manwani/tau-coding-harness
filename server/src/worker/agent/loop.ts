import type OpenAI from "openai";
import { clientForModel } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getNextSequence } from "@/lib/sequence";
import { meter, type MeterResult } from "@/lib/credits";
import { toCredits, MIN_SPEND_TO_START_MICRO } from "@/lib/pricing";
import { bus } from "@/lib/bus";
import { publish, publishTerminal, makeIndexer } from "../lib/publish";
import { captureException, log } from "../lib/log";
import { captureAppScreenshot } from "../lib/screenshot";
import { markProjectWorkspaceStarted } from "../lib/projectWorkspace";
import { putScreenshot } from "@/lib/s3";
import type { Sandbox } from "../lib/sandbox";
import { TOOL_DEFINITIONS } from "./tools/tools";

export type SandboxRef = { current: Sandbox | null };
import { executeTool } from "./tools/executor";
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
import { SUMMARY_HEADER } from "./context/summarize";
import {
  createCalibration,
  estimateStringTokens,
  estimateTokens,
  estimateTokensCalibrated,
  recalibrate,
} from "./context/tokens";
import type { Entry } from "./context/types";
import { toTemplateKey } from "../templates/registry";
import type { Tool } from "./tools/tools";
import type { Effort } from "@/generated/prisma/enums";

type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type FunctionToolCall =
  OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

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
  // "dispatch_implementer",
]);

// Planning/todo-tracking tools are dropped for LOW: the calls themselves cost
// turns on a tight budget, and the multi-phase discipline they encourage is
// aimed at longer work LOW isn't meant to take on. HIGH/MAX keep all three.
const LOW_EXCLUDED_TOOLS = new Set<string>([
  "create_plan",
  "add_todos",
  "update_todo",
]);

function toolsForEffort(
  effort: Effort,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const defs =
    effort === "LOW"
      ? TOOL_DEFINITIONS.filter((t) => !LOW_EXCLUDED_TOOLS.has(t.function.name))
      : TOOL_DEFINITIONS;
  return defs as unknown as OpenAI.Chat.Completions.ChatCompletionTool[];
}

const FILE_MUTATING_TOOLS = new Set<string>([
  "create_file",
  "edit_file",
  "delete_file",
  "dispatch_implementer",
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

interface StoredAssistant {
  content: string | null;
  tool_calls: ToolCall[] | null;
}

interface StoredToolResult {
  tool_call_id: string;
  content: string;
}

/** Content of a hidden USER_EDIT row — a manual edit the user made in the code
 *  editor. Written by the api (`saveProjectFile`). See doc/USER_CODE_EDITING.md. */
interface StoredUserEdit {
  path: string;
  diff: string;
  truncated: boolean;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Render a hidden USER_EDIT row as a user-role turn.
 *
 * The user's edit is already applied to the file — this is a notification, not
 * a request, and the prompt says so explicitly to stop the model "helpfully"
 * re-applying or reverting it. We send the diff rather than the content because
 * the model can always `read_file` the live sandbox for bytes; what it can't do
 * is notice that something moved.
 */
function userEditPrompt(edit: StoredUserEdit): string {
  const stat = `+${edit.linesAdded}/-${edit.linesRemoved}`;
  if (edit.truncated) {
    return `[The user manually edited ${edit.path} in the code editor (${stat} lines). This is not a request — the change is already applied to the file. The diff was too large to include in full; re-read the file before relying on your memory of it.]\n\n${edit.diff}`;
  }
  return `[The user manually edited ${edit.path} in the code editor (${stat} lines). This is not a request — the change is already applied to the file. Unified diff:]\n\n${edit.diff}`;
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

async function loadHistory(projectId: string): Promise<Entry[]> {
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

  const entries: Entry[] = [];

  if (checkpoint) {
    entries.push({
      param: {
        role: "system",
        content: `${SUMMARY_HEADER}${checkpoint.summary}`,
      },
      seq: null,
    });
  }

  for (const row of rows) {
    if (row.type === MessageType.TOOL_RES) {
      const results = row.content as unknown as StoredToolResult[];
      for (const r of results) {
        entries.push({
          param: {
            role: "tool",
            tool_call_id: r.tool_call_id,
            content: r.content,
          },
          seq: row.sequence,
        });
      }
    } else if (row.role === MessageRole.ASSISTANT) {
      const stored = row.content as unknown as StoredAssistant;
      const hasToolCalls = !!stored.tool_calls?.length;
      const hasContent =
        typeof stored.content === "string" && stored.content.trim().length > 0;
      // Skip empty assistant rows — e.g. the anchor row a PREVIEW job writes to
      // hang a fragment on, or a final turn the model ended with null content.
      // Replaying one sends `{ role: "assistant" }` with neither content nor
      // tool_calls, which the completions API rejects with a 400.
      if (!hasToolCalls && !hasContent) continue;
      entries.push({
        param: {
          role: "assistant",
          content: stored.content,
          ...(stored.tool_calls?.length
            ? { tool_calls: stored.tool_calls }
            : {}),
        },
        seq: row.sequence,
      });
    } else if (row.role === MessageRole.USER && row.type === MessageType.USER) {
      entries.push({
        param: {
          role: "user",
          content:
            row.content as unknown as OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"],
        },
        seq: row.sequence,
      });
    } else if (row.type === MessageType.USER_EDIT) {
      // Hidden row: the model sees it, the chat transcript doesn't (web's
      // toConversation has no branch for this type). doc/USER_CODE_EDITING.md.
      entries.push({
        param: {
          role: "user",
          content: userEditPrompt(row.content as unknown as StoredUserEdit),
        },
        seq: row.sequence,
      });
    }
  }

  return balanceToolResults(entries);
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
  const tools = toolsForEffort(effort);
  const deadline = Date.now() + budget.maxWallClockMs;
  // Declared out here so the catch can report which turn the run died on —
  // "failed on turn 1" and "failed on turn 180" are very different incidents.
  let turn = 0;

  try {
    // Determine which template the agent is (or will be) working in. A template
    // is "selected" once files have been scaffolded against it — before that the
    // agent still gets to pick it via provision_sandbox, so it sees the chooser.
    const [project, fileCount] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { templateKey: true },
      }),
      prisma.projectFile.count({ where: { projectId } }),
    ]);
    const selected = fileCount > 0;
    const systemPrompt = buildSystemPrompt({
      templateKey: toTemplateKey(project?.templateKey),
      selected,
      effort,
    });

    let entries: Entry[] = [
      { param: { role: "system", content: systemPrompt }, seq: null },
      ...(await loadHistory(projectId)),
    ];
    let truncationRetries = 0;
    let intentNudges = 0;
    let meterFailures = 0;
    let summarizations = 0;

    let filesChanged = false;
    let verifierRan = false;
    let maxVerifyForced = false;
    const calibration = createCalibration();

    type StopReason = Exclude<CleanFinishReason, "DONE">;
    let stopReason: StopReason | null = null;

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

      if (reason !== FinishReason.CANCELLED) {
        // Terminal: the client finalizes on this and stops the shimmer. The
        // `cancelled` frame is owned by the runner's cancel handler instead.
        await publishTerminal(jobId, {
          type: "insufficient_credits",
          reason: reason === FinishReason.BUDGET ? "budget" : "balance",
        });
      }
    };

    while (true) {
      if (!stopReason && bus.isCancelled(jobId)) {
        stopReason = FinishReason.CANCELLED;
      }
      if (stopReason) break;

      if (turn++ >= budget.maxAgentTurns) {
        throw new AgentStopError(
          FinishReason.TURN_CAP,
          `Agent exceeded ${budget.maxAgentTurns} turns without finishing`,
        );
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

      const mgmt = await manageContext(entries, { model, calibration });
      entries = mgmt.entries;

      if (mgmt.summarized) {
        summarizations++;
        const s = mgmt.summarized;
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
        estimateTokensCalibrated(mgmt.ctx, calibration) + TOOL_SCHEMA_TOKENS;
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
      bus.setPhase(jobId, "llm", {
        turn,
        model,
        sandboxId: sandboxRef.current?.sandboxId ?? null,
      });

      const stream = clientForModel(model).chat.completions.stream({
        model,
        max_tokens: MAX_TOKENS,
        tools,
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

      // Ground-truth correction: compare what we guessed for this exact payload
      // (messages + tool schema) against what the model actually reports.
      if (inputTokens > 0) {
        recalibrate(
          calibration,
          estimateTokens(mgmt.ctx) + TOOL_SCHEMA_TOKENS,
          inputTokens,
        );
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

      if (
        !isToolTurn &&
        effort === "MAX" &&
        filesChanged &&
        !verifierRan &&
        !maxVerifyForced
      ) {
        maxVerifyForced = true;
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
              "Before you finish: you're on MAX effort and changed files this " +
              "run but haven't verified them. Dispatch `dispatch_verifier` over " +
              "everything you changed (build + spot-check the affected flows), " +
              "fix anything it reports, then give your brief final summary.",
          },
          seq: null,
        });
        continue;
      }

      if (!isToolTurn) {
        let previewUrl: string | null = null;
        if (sandboxRef.current) {
          const host = sandboxRef.current.getHost(PREVIEW_PORT);
          previewUrl = `https://${host}`;
          await markProjectWorkspaceStarted(projectId);
          await publish(jobId, { type: "preview_ready", url: previewUrl });

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

        // `done` tells clients that every completion side effect is visible.
        // Keep it after the thumbnail write so an immediate project-list
        // refetch cannot race the DB update and cache a null/old cover.
        await publishTerminal(jobId, { type: "done" });
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
        const toolName = tc.function.name;
        const toolCallId = tc.id;

        if (FILE_MUTATING_TOOLS.has(toolName)) filesChanged = true;
        if (toolName === "dispatch_verifier") verifierRan = true;

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
          );
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
