/**
 * The loop a sub-agent runs in: its own conversation, never the main one, and
 * a written report back.
 *
 * It is a smaller copy of the main loop and for a long time had fewer of its
 * safeguards, which is the wrong way round — a sub-agent is sent to read
 * widely, on the apps large enough to need one. Four of them are here now
 * (doc/CONTEXT_AND_MEMORY_PLAN.md §7, item 9):
 *
 *   - **its persona is a system message**, and written for the app it is
 *     working in (`config.ts`). It used to be the first of two user messages,
 *     which a model weighs as something a person said rather than as what it
 *     is;
 *   - **its context is bounded**, by the same sticky, batched clearing the
 *     main loop uses (`context/clearing.ts`). Without it every file an
 *     explorer read stayed in its context, whole, for the rest of its run;
 *   - **it always ends with a report.** A sub-agent that ran out of turns used
 *     to return whatever it had said last — typically "Let me check one more
 *     file". It now gets one more turn, without tools, to write up what it
 *     found;
 *   - **the report is capped** before it enters the main conversation, where
 *     it is never cleared.
 */
import { clientForModel } from "@/lib/kimi";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { publish, publishTerminal } from "@/worker/lib/publish";
import { captureException, log } from "@/worker/lib/log";
import { meter, type MeterResult } from "@/lib/credits";
import { toCredits } from "@/lib/pricing";
import type Sandbox from "e2b";
import type OpenAI from "openai";
import {
  MAX_TOKENS_FOR_SUBAGENT,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TRUNCATION_RETRIES,
  MAX_INTENT_NUDGES,
  INTENT_TO_CONTINUE_RE,
  TRUNCATION_NUDGE,
  budgetForEffort,
  contextBudgetForModel,
} from "../../config";
import { executeSubAgentTool } from "./tool-executor";
import { redactToolResult } from "@/worker/lib/redact";
import {
  applyClearing,
  createClearingState,
  planClearing,
  type ClearingState,
} from "../../context/clearing";
import { cachedPromptTokens, estimateTokens } from "../../context/tokens";
import { loadAppBrief } from "../../context/appBrief";
import { headTail } from "../functions/output";
import type { Effort } from "@/generated/prisma/enums";
import {
  MAX_REPORT_CHARS,
  appKindOf,
  subAgentPersona,
  type SubAgentKind,
} from "./config";
import { toolsFor } from "./tool-sets";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Fail-closed threshold: after this many consecutive metering failures while
// enforcing, stop the sub-agent as if the hold were exhausted so a persistent
// DB problem can't hand out unlimited free generation.
const MAX_CONSECUTIVE_METER_FAILURES = 3;

/**
 * A sub-agent's context, as a share of the model's and never more than a fixed
 * size. Smaller than the main loop's on purpose: a sub-agent's whole value is
 * that its reading does not have to be carried around afterwards, and one that
 * needs more than this to answer a question has been asked too large a one.
 */
const SUBAGENT_CONTEXT_SHARE = 0.5;
const SUBAGENT_CONTEXT_MAX_TOKENS = 120_000;
/** Clearing starts at this share of the sub-agent's context, and clears down to the next. */
const SUBAGENT_CLEAR_AT = 0.75;
const SUBAGENT_CLEAR_TO = 0.5;

/** How many tokens a sub-agent's conversation may hold for a model. */
export function subAgentContextTokens(model: string): number {
  return Math.min(
    contextBudgetForModel(model) * SUBAGENT_CONTEXT_SHARE,
    SUBAGENT_CONTEXT_MAX_TOKENS,
  );
}

/**
 * The messages to send this turn: the conversation with whatever has been
 * cleared left cleared, and another batch cleared if it has grown past the
 * mark. `clearing` is the sub-agent's own, kept for its whole run.
 */
export function boundedContext(
  messages: MessageParam[],
  clearing: ClearingState,
  limitTokens: number,
): MessageParam[] {
  let ctx = applyClearing(messages, clearing);
  const now = estimateTokens(ctx);
  if (now > limitTokens * SUBAGENT_CLEAR_AT) {
    const added = planClearing(messages, clearing, {
      tokensNow: now,
      targetTokens: limitTokens * SUBAGENT_CLEAR_TO,
      tokensPerChar: 1 / 4,
      maxToolResultTokens: MAX_TOOL_RESULT_TOKENS,
    });
    if (added > 0) ctx = applyClearing(messages, clearing);
  }
  return ctx;
}

/** A report cut to what the main conversation should carry, keeping its start and end. */
export function capReport(report: string): string {
  const capped = headTail(report.trim(), MAX_REPORT_CHARS);
  return capped.truncated
    ? `${capped.text}\n\n[tau: this report was longer than ${MAX_REPORT_CHARS.toLocaleString("en-US")} characters and its middle was cut.]`
    : capped.text;
}

/**
 * What a sub-agent is told about how long it has. A model that does not know
 * it has a limit works until it hits it: a verifier given a broad scope read
 * the whole app and used every one of its forty turns to report "PASS".
 */
export function turnBudgetNote(maxTurns: number): string {
  return `You have at most ${maxTurns} turns, and most tasks need far fewer. Ask for several files or commands in one turn where you can, do the checks that matter most first, and write your report as soon as the task is answered — do not keep reading to be thorough.`;
}

/** What a sub-agent is told when it has used its turns. */
export const FINAL_REPORT_NUDGE =
  "You have used all your turns and can make no more tool calls. Write your final report now, in the output format you were given, from what you have found so far. Say plainly what you established, and what you did not get to.";

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

export interface SubAgentRun {
  kind: SubAgentKind;
  /** What it is being asked to do, in the main agent's words. */
  task: string;
  sandbox: Sandbox;
  jobId: string;
  projectId: string;
  userId: string;
  nextIndex: () => number;
  model: string;
  effort: Effort;
}

/**
 * Runs an isolated tool-calling loop for a sub-agent (its own message history,
 * never touching the main conversation) and returns its final report.
 */
export const executeSubAgentLoop = async (run: SubAgentRun): Promise<string> => {
  const { kind, sandbox, jobId, projectId, userId, nextIndex, model, effort } = run;
  const label = kind;
  const maxSubagentTurns = budgetForEffort(effort).maxSubagentTurns;

  const app = await appKindOf(projectId);
  const tools = toolsFor(kind, app.generation);
  // The app's memory and map, read fresh: the main agent may have changed the
  // app since its own copy was taken at the start of the request. Null for a
  // generation-1 project, whose persona tells the sub-agent to read the file.
  // Ahead of the task, so the task is the last thing it reads.
  const brief = await loadAppBrief(projectId, "sub-agent");
  const messages: MessageParam[] = [
    { role: "system", content: subAgentPersona(kind, app) },
    {
      role: "user",
      content: `${brief ? `${brief}\n\n## Your task\n` : ""}${run.task}\n\n${turnBudgetNote(maxSubagentTurns)}`,
    },
  ];
  const clearing = createClearingState();
  const contextLimit = subAgentContextTokens(model);

  log.info("subagent.start", {
    jobId,
    projectId,
    label,
    model,
    effort,
    brief: brief !== null,
  });
  let turn = 0;
  let truncationRetries = 0;
  let intentNudges = 0;
  let lastContent = "";
  let meterFailures = 0;
  // Set once the turns are used up: the next turn is the report, without tools.
  let reporting = false;

  const finish = (report: string, reason: string, level: "info" | "warn" = "info"): string => {
    log[level]("subagent.finish", {
      jobId,
      label,
      turns: turn,
      reason,
      cleared: clearing.replacements.size,
      reportChars: report.length,
    });
    return capReport(report);
  };

  while (true) {
    if (turn >= maxSubagentTurns && !reporting) {
      reporting = true;
      messages.push({ role: "user", content: FINAL_REPORT_NUDGE });
    }

    const stream = clientForModel(model).chat.completions.stream({
      model,
      max_tokens: MAX_TOKENS_FOR_SUBAGENT,
      ...(reporting ? {} : { tools }),
      messages: boundedContext(messages, clearing, contextLimit),
    });

    const completion = await stream.finalChatCompletion();
    const choice = completion.choices[0];
    if (!choice) throw new Error("Deepseek returned no completion choices");

    const assistant = choice.message;
    const toolCalls = (assistant.tool_calls ?? []).filter(
      (tc) => tc.type === "function",
    );
    const isToolTurn =
      !reporting && choice.finish_reason === "tool_calls" && toolCalls.length > 0;
    // Cut off at MAX_TOKENS_FOR_SUBAGENT — the turn (and any tool call it began)
    // is incomplete.
    const isTruncated = choice.finish_reason === "length";

    turn++;
    if (assistant.content?.trim()) {
      lastContent = assistant.content;
      log.debug("subagent.turn", { jobId, label, turn });
    }

    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;
    // Same figure the main loop logs as `job.usage`; see there for why.
    log.info("subagent.usage", {
      jobId,
      label,
      turn,
      model,
      inputTokens,
      cachedTokens: cachedPromptTokens(completion.usage),
      outputTokens,
    });

    await prisma.tokenUsage.create({
      data: {
        userId,
        projectId,
        jobId,
        model,
        inputTokens,
        outputTokens,
      },
    });

    let holdExhausted = false;
    try {
      // Negative sequence namespace: the main loop keys its metering off
      // Message.sequence (always >= 0 via getNextSequence), so a negative,
      // per-job-monotonic value here can never collide with it while still
      // being unique across every turn of every sub-agent dispatched in this job.
      const meterResult = await meterWithRetry(
        userId,
        jobId,
        model,
        inputTokens,
        outputTokens,
        -nextIndex(),
        { enforce: env.CREDITS_ENFORCE },
      );
      holdExhausted = meterResult.holdExhausted;
      meterFailures = 0;
      // Live balance tick (see main loop) — sub-agent turns spend too.
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
        label,
        detail: "sub-agent meter failed",
      });
      // Fail-closed once metering has failed repeatedly (see constant).
      if (
        env.CREDITS_ENFORCE &&
        ++meterFailures >= MAX_CONSECUTIVE_METER_FAILURES
      ) {
        holdExhausted = true;
      }
    }

    if (env.CREDITS_ENFORCE && holdExhausted) {
      // Terminal — and deduped: the main loop's own meter will reach the same
      // conclusion within a turn or two and try to publish it again.
      await publishTerminal(jobId, {
        type: "insufficient_credits",
        reason: "balance",
      });
      return finish(
        assistant.content ?? "Stopped early: ran out of credits.",
        "insufficient_credits",
        "warn",
      );
    }

    // The report turn: whatever came back is the report.
    if (reporting) {
      return finish(
        assistant.content?.trim() ||
          lastContent ||
          `Stopped: used all ${maxSubagentTurns} turns without reaching a conclusion.`,
        "turn_cap",
        "warn",
      );
    }

    // Truncated turn: don't accept it as the final summary — nudge to continue
    // in smaller pieces, giving up after a few consecutive truncations.
    if (isTruncated) {
      if (++truncationRetries > MAX_TRUNCATION_RETRIES) {
        return finish(
          lastContent || "Stopped: response repeatedly hit the token limit.",
          "truncation_cap",
          "warn",
        );
      }
      if (assistant.content?.trim()) {
        messages.push({ role: "assistant", content: assistant.content });
      }
      messages.push({ role: "user", content: TRUNCATION_NUDGE });
      continue;
    }
    truncationRetries = 0;

    // Guard against the "Let me write the file…" preamble that ends the turn
    // with no tool call — nudge it to actually act before accepting text as done.
    if (
      !isToolTurn &&
      intentNudges < MAX_INTENT_NUDGES &&
      INTENT_TO_CONTINUE_RE.test((assistant.content ?? "").trim())
    ) {
      intentNudges++;
      if (assistant.content?.trim()) {
        messages.push({ role: "assistant", content: assistant.content });
      }
      messages.push({
        role: "user",
        content:
          "Continue and actually perform the work using your tools — don't just " +
          "describe what you're about to do. If the task is genuinely complete, " +
          "reply with your brief final summary.",
      });
      continue;
    }

    if (!isToolTurn) return finish(assistant.content ?? "", "done");

    // The filtered calls, not the raw list — only these get a `tool` reply
    // below, and an unanswered tool_call 400s the next request.
    messages.push({
      role: "assistant",
      content: assistant.content,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      let input: unknown;
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        input = { _raw: tc.function.arguments };
      }

      log.debug("subagent.tool", {
        jobId,
        label,
        tool: tc.function.name,
        args: (tc.function.arguments ?? "").slice(0, 160),
      });

      let output: unknown;
      try {
        // Same redaction as the main executor: a sub-agent that runs `env` or
        // reads `.env` must not pull a key into its context (or its summary).
        output = await redactToolResult(
          projectId,
          await executeSubAgentTool(
            tc.function.name,
            input,
            sandbox,
            jobId,
            projectId,
            userId,
            nextIndex,
          ),
        );
      } catch (err) {
        output = { error: err instanceof Error ? err.message : String(err) };
      }

      log.debug("subagent.tool.done", {
        jobId,
        label,
        tool: tc.function.name,
      });

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(output),
      });
    }
  }
};
