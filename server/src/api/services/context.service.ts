/**
 * User-triggered chat context actions from the project dropdown: "Clear chat"
 * and "Summarize chat" (doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md). Both
 * write a `ContextCheckpoint` row — the same mechanism the agent loop's own
 * auto-summarization uses — distinguished by `reason` so message-read paths
 * know a `MANUAL_CLEAR` checkpoint hides history while the others don't.
 *
 * Note: unlike the agent loop's auto-summarization, the manual "Summarize
 * chat" LLM call here is not metered/billed against credits — it has no
 * running Job to attach a TokenUsage/debit row to. Revisit if this needs to
 * cost credits.
 */
import * as projectRepo from "../repositories/project.repository";
import { Errors } from "../lib/errors";
import { loadHistory } from "@/worker/agent/loop";
import { summarize } from "@/worker/agent/context/summarize";
import { estimateTokens } from "@/worker/agent/context/tokens";
import {
  CONTEXT_KEEP_TAIL_TOKENS,
  MAX_TOOL_RESULT_TOKENS,
  modelForEffort,
} from "@/worker/agent/config";
import type { Entry } from "@/worker/agent/context/types";
import { ContextCheckpointReason } from "@/generated/prisma/enums";

async function requireOwnedProject(projectId: string, userId: string) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }
  return project;
}

async function requireNoActiveJob(projectId: string, action: string) {
  const activeJob = await projectRepo.findActiveJob(projectId);
  if (activeJob) {
    throw Errors.conflict(
      `Finish or cancel the current run before you can ${action}`,
    );
  }
}

export async function clearProjectChat(projectId: string, userId: string) {
  await requireOwnedProject(projectId, userId);
  await requireNoActiveJob(projectId, "clear this chat");

  const [upToSequence, history] = await Promise.all([
    projectRepo.maxMessageSequence(projectId),
    loadHistory(projectId),
  ]);
  if (upToSequence === null) {
    return { cleared: false, upToSequence: null };
  }

  const tokensBefore = estimateTokens(history.map((e) => e.param));
  await projectRepo.createContextCheckpoint({
    projectId,
    upToSequence,
    reason: ContextCheckpointReason.MANUAL_CLEAR,
    summary: "",
    tokensBefore,
    tokensAfter: 0,
  });

  return { cleared: true, upToSequence };
}

export async function summarizeProjectChat(projectId: string, userId: string) {
  await requireOwnedProject(projectId, userId);
  await requireNoActiveJob(projectId, "summarize this chat");

  const history = await loadHistory(projectId);
  const entries: Entry[] = [
    { param: { role: "system", content: "" }, seq: null },
    ...history,
  ];

  const result = await summarize(entries, {
    model: modelForEffort("HIGH"),
    keepTailTokens: CONTEXT_KEEP_TAIL_TOKENS,
    maxToolResultTokens: MAX_TOOL_RESULT_TOKENS,
  });
  if (!result) {
    throw Errors.badRequest("Not enough chat history to summarize yet");
  }

  await projectRepo.createContextCheckpoint({
    projectId,
    upToSequence: result.upToSequence,
    reason: ContextCheckpointReason.MANUAL_SUMMARIZE,
    summary: result.summary,
    tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter,
  });

  return {
    summarized: true,
    upToSequence: result.upToSequence,
    tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter,
  };
}
