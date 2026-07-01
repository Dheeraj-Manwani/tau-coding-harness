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

/**
 * Runs an isolated tool-calling loop for a sub-agent (its own message history,
 * never touching the main conversation) and returns its final text summary.
 */
export const executeSubAgentLoop = async (
  prompts: string[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  nextIndex: () => number,
): Promise<string> => {
  const messages: MessageParam[] = prompts.map((prompt) => ({
    role: "user",
    content: prompt,
  }));

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
      await publish(jobId, { type: "insufficient_credits" }, nextIndex());
      return assistant.content ?? "Stopped early: ran out of credits.";
    }

    if (!isToolTurn) {
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

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(output),
      });
    }
  }
};
