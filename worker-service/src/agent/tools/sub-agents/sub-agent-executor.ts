import { deepseek } from "@/lib/deepseek";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/publish";
import { meter } from "@/lib/credits";
import type Sandbox from "e2b";
import type OpenAI from "openai";
import { MAX_TOKENS_FOR_SUBAGENT } from "../../config";
import { executeSubAgentTool } from "./tool-executor";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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
  label = "sub-agent",
): Promise<string> => {
  const messages: MessageParam[] = prompts.map((prompt) => ({
    role: "user",
    content: prompt,
  }));

  // The last prompt is the actual task (personas are seeded before it).
  const task = prompts[prompts.length - 1] ?? "";
  const tag = `[sub-agent:${label}]`;
  console.log(`\n${tag} ▶ start — ${preview(task)}`);
  let turn = 0;

  while (true) {
    const stream = deepseek.chat.completions.stream({
      model: env.DEEPSEEK_MODEL,
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

    turn++;
    if (assistant.content?.trim()) {
      console.log(`${tag} turn ${turn} 💭 ${preview(assistant.content)}`);
    }

    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;

    await prisma.tokenUsage.create({
      data: {
        userId,
        projectId,
        jobId,
        model: env.DEEPSEEK_MODEL,
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
      const meterResult = await meter(
        userId,
        jobId,
        env.DEEPSEEK_MODEL,
        inputTokens,
        outputTokens,
        -nextIndex(),
        { enforce: env.CREDITS_ENFORCE },
      );
      holdExhausted = meterResult.holdExhausted;
    } catch (err) {
      console.error(`[worker] sub-agent meter failed for job ${jobId}`, err);
    }

    if (env.CREDITS_ENFORCE && holdExhausted) {
      console.log(`${tag} ⏹ stopped early — out of credits (turn ${turn})`);
      await publish(jobId, { type: "insufficient_credits" }, nextIndex());
      return assistant.content ?? "Stopped early: ran out of credits.";
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
