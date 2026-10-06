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
  MAX_TRUNCATION_RETRIES,
  MAX_INTENT_NUDGES,
  INTENT_TO_CONTINUE_RE,
  TRUNCATION_NUDGE,
  budgetForEffort,
} from "../../config";
import { executeSubAgentTool } from "./tool-executor";
import { redactToolResult } from "@/worker/lib/redact";
import { cachedPromptTokens } from "../../context/tokens";
import { loadAppBrief } from "../../context/appBrief";
import type { Effort } from "@/generated/prisma/enums";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Fail-closed threshold: after this many consecutive metering failures while
// enforcing, stop the sub-agent as if the hold were exhausted so a persistent
// DB problem can't hand out unlimited free generation.
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

/** Collapse whitespace and cap length so terminal logs stay one-line-ish. */
function preview(value: unknown, max = 200): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Runs an isolated tool-calling loop for a sub-agent (its own message history,
 * never touching the main conversation) and returns its final text summary.
 *
 * `label` (e.g. "explorer") only tags the terminal logs so you can follow what
 * each dispatched sub-agent is doing without it leaking into the model context.
 */
export const executeSubAgentLoop = async (
  prompts: string[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
  model: string,
  effort: Effort,
  label = "sub-agent",
): Promise<string> => {
  const maxSubagentTurns = budgetForEffort(effort).maxSubagentTurns;
  // The app's memory and map, read fresh: the main agent may have changed the
  // app since its own copy was taken at the start of the request. Null for a
  // generation-1 project, whose persona tells the sub-agent to read the file.
  // Placed between the persona and the task so the task stays last.
  const brief = await loadAppBrief(projectId, "sub-agent");
  const seeded = brief
    ? [...prompts.slice(0, -1), brief, ...prompts.slice(-1)]
    : prompts;
  const messages: MessageParam[] = seeded.map((prompt) => ({
    role: "user",
    content: prompt,
  }));
  const tag = `[sub-agent:${label}]`;
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

  while (true) {
    if (turn >= maxSubagentTurns) {
      log.warn("subagent.finish", {
        jobId,
        label,
        turns: turn,
        reason: "turn_cap",
      });
      return lastContent || `Stopped: exceeded ${maxSubagentTurns} turns.`;
    }

    const stream = clientForModel(model).chat.completions.stream({
      model,
      max_tokens: MAX_TOKENS_FOR_SUBAGENT,
      tools,
      messages,
    });

    const completion = await stream.finalChatCompletion();
    const choice = completion.choices[0];
    if (!choice) throw new Error("Deepseek returned no completion choices");

    const assistant = choice.message;
    const toolCalls = (assistant.tool_calls ?? []).filter(
      (tc) => tc.type === "function",
    );
    const isToolTurn =
      choice.finish_reason === "tool_calls" && toolCalls.length > 0;
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
      log.warn("subagent.finish", {
        jobId,
        label,
        turns: turn,
        reason: "insufficient_credits",
      });
      // Terminal — and deduped: the main loop's own meter will reach the same
      // conclusion within a turn or two and try to publish it again.
      await publishTerminal(jobId, {
        type: "insufficient_credits",
        reason: "balance",
      });
      return assistant.content ?? "Stopped early: ran out of credits.";
    }

    // Truncated turn: don't accept it as the final summary — nudge to continue
    // in smaller pieces, giving up after a few consecutive truncations.
    if (isTruncated) {
      if (++truncationRetries > MAX_TRUNCATION_RETRIES) {
        log.warn("subagent.finish", {
          jobId,
          label,
          turns: turn,
          reason: "truncation_cap",
        });
        return (
          lastContent || "Stopped: response repeatedly hit the token limit."
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

    if (!isToolTurn) {
      log.info("subagent.finish", {
        jobId,
        label,
        turns: turn,
        reason: "done",
      });
      return assistant.content ?? "";
    }

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

      log.debug("subagent.tool", { jobId, label, tool: tc.function.name });

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
