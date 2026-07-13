import { deepseek } from "@/lib/deepseek";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/publish";
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
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? "");
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
  const messages: MessageParam[] = prompts.map((prompt) => ({
    role: "user",
    content: prompt,
  }));

  // The last prompt is the actual task (personas are seeded before it).
  const task = prompts[prompts.length - 1] ?? "";
  const tag = `[sub-agent:${label}]`;
  console.log(`\n${tag} ▶ start — ${preview(task)}`);
  let turn = 0;
  let truncationRetries = 0;
  let intentNudges = 0;
  let lastContent = "";
  let meterFailures = 0;

  while (true) {
    if (turn >= maxSubagentTurns) {
      console.log(`${tag} ⏹ stopped — exceeded ${maxSubagentTurns} turns\n`);
      return lastContent || `Stopped: exceeded ${maxSubagentTurns} turns.`;
    }

    const stream = deepseek.chat.completions.stream({
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
      console.log(`${tag} turn ${turn} 💭 ${preview(assistant.content)}`);
    }

    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;

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
        await publish(
          jobId,
          {
            type: "credits_update",
            available: toCredits(meterResult.available),
            availableMicro: meterResult.available.toString(),
          },
          nextIndex(),
        );
      }
    } catch (err) {
      console.error(`[worker] sub-agent meter failed for job ${jobId}`, err);
      // Fail-closed once metering has failed repeatedly (see constant).
      if (
        env.CREDITS_ENFORCE &&
        ++meterFailures >= MAX_CONSECUTIVE_METER_FAILURES
      ) {
        holdExhausted = true;
      }
    }

    if (env.CREDITS_ENFORCE && holdExhausted) {
      console.log(`${tag} ⏹ stopped early — out of credits (turn ${turn})`);
      await publish(jobId, { type: "insufficient_credits" }, nextIndex());
      return assistant.content ?? "Stopped early: ran out of credits.";
    }

    // Truncated turn: don't accept it as the final summary — nudge to continue
    // in smaller pieces, giving up after a few consecutive truncations.
    if (isTruncated) {
      if (++truncationRetries > MAX_TRUNCATION_RETRIES) {
        console.log(`${tag} ⏹ stopped — truncated ${MAX_TRUNCATION_RETRIES}x\n`);
        return lastContent || "Stopped: response repeatedly hit the token limit.";
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
      console.log(`${tag} ✓ done — ${preview(assistant.content)}\n`);
      return assistant.content ?? "";
    }

    messages.push({
      role: "assistant",
      content: assistant.content,
      tool_calls: assistant.tool_calls,
    });

    for (const tc of toolCalls) {
      let input: unknown;
      try {
        input = tc.function.arguments
          ? JSON.parse(tc.function.arguments)
          : {};
      } catch {
        input = { _raw: tc.function.arguments };
      }

      console.log(`${tag}   ⚙ ${tc.function.name} ${preview(input, 160)}`);

      let output: unknown;
      try {
        output = await executeSubAgentTool(
          tc.function.name,
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          nextIndex,
        );
      } catch (err) {
        output = { error: err instanceof Error ? err.message : String(err) };
      }

      console.log(`${tag}   ↳ ${preview(output, 160)}`);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(output),
      });
    }
  }
};
