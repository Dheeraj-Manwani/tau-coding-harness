/**
 * Designing a new app as it is created.
 *
 * Split in two so the decision costs no time: `startDesign` kicks off the
 * design director's model call and returns at once, the sandbox boots
 * meanwhile, and `finishDesign` applies whatever was decided once there is a
 * sandbox to apply it to.
 *
 * Only a brand-new app is designed this way. An app that already has files
 * has a look already — one tau gave it, or one the user has since changed —
 * and overwriting its stylesheet on a later request would undo their work.
 * Changing that look on purpose is a restyle (`api/services/design.service.ts`).
 *
 * Whatever the user chose in the composer (`Project.designConfig`) is read
 * here and handed to the director, which decides only what they left open.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import { prisma } from "@/lib/prisma";
import { log } from "../lib/log";
import { meterModelCall } from "../lib/meterCall";
import type { StackContext } from "../lib/appStack";
import { applyDesign, type ApplyResult } from "./apply";
import { normalizeDesignConfig } from "./config";
import { directDesign, type DirectorResult } from "./director";
import { parseImportedDesign } from "./importDesign";
import type { DesignChoice, DesignConfig } from "./types";

/** The user's own words: the message that started the project. */
async function firstUserMessage(projectId: string): Promise<string> {
  const row = await prisma.message.findFirst({
    where: { projectId, role: "USER", type: "USER" },
    orderBy: { sequence: "asc" },
    select: { content: true },
  });
  const content = row?.content as unknown;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** What the user chose for this project's look; empty when they chose nothing. */
async function userChoices(projectId: string): Promise<DesignConfig> {
  const row = await prisma.project.findUnique({
    where: { id: projectId },
    select: { designConfig: true },
  });
  return normalizeDesignConfig(row?.designConfig) ?? {};
}

/**
 * Begin deciding the design. Resolves to the choice; never rejects.
 *
 * @param agentBrief  the agent's own summary of what it is about to build,
 *                    which carries anything the user said after the first
 *                    message (an answer to a clarifying question, say)
 */
export function startDesign(projectId: string, agentBrief: string): Promise<DirectorResult> {
  return (async () => {
    const [said, config] = await Promise.all([
      firstUserMessage(projectId).catch(() => ""),
      userChoices(projectId).catch((): DesignConfig => ({})),
    ]);
    const brief = [
      said.trim() ? `What the user asked for:\n${said.trim()}` : "",
      agentBrief.trim() ? `What is about to be built:\n${agentBrief.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const imported = config.designMd ? parseImportedDesign(config.designMd) : undefined;
    return directDesign(brief, projectId, config, imported);
  })();
}

/**
 * Apply the decided design to the new sandbox. Never throws: an app that
 * could not be designed keeps the neutral look it booted with.
 */
export async function finishDesign(
  ctx: StackContext,
  pending: Promise<DirectorResult>,
): Promise<{ choice: DesignChoice; result: ApplyResult } | null> {
  try {
    const { choice, usage } = await pending;
    if (usage) await meterModelCall(ctx, usage, "design director");
    const result = await applyDesign(ctx, choice);
    return { choice, result };
  } catch (err) {
    log.warn("design.failed", {
      jobId: ctx.jobId,
      projectId: ctx.projectId,
      error: String(err),
    });
    return null;
  }
}
