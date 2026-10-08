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
 * One more thing counts as a choice though nobody opened the picker to make
 * it: a screenshot sent with the first message, with words to the effect of
 * "make it look like this". That is read for its design here
 * (`fromImage.ts`) and treated from then on as a design the user brought.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { designReferenceKey, getObjectBytes, putAttachmentBytes } from "@/lib/s3";
import { AttachmentKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { log } from "../lib/log";
import { meterModelCall } from "../lib/meterCall";
import { withDeadline } from "../lib/sandbox";
import { loadStanding } from "../agent/context/standing";
import type { StackContext } from "../lib/appStack";
import { applyDesign, type ApplyResult } from "./apply";
import { normalizeDesignConfig } from "./config";
import { directDesign, type DirectorResult } from "./director";
import { imageReadingAvailable, readDesignImage } from "./fromImage";
import { parseImportedDesign } from "./importDesign";
import type { DesignChoice, DesignConfig } from "./types";

/** What a model call cost, for metering. */
type Usage = NonNullable<DirectorResult["usage"]>;

/** A decided design, and what deciding it cost beyond the director's own call. */
export interface StartedDesign extends DirectorResult {
  /** The call that read a design from a picture, when one was made. */
  readingUsage?: Usage;
}

/**
 * Reading a picture is given this long. It runs while the sandbox boots, which
 * takes about as long; past that it would be holding the build up, and an app
 * without the picture's design is better than an app that is late.
 */
const IMAGE_READ_DEADLINE_MS = 40_000;

/** The message that started the project: the user's own words, and its id. */
async function firstUserMessage(projectId: string): Promise<{ id: string | null; text: string }> {
  const row = await prisma.message.findFirst({
    where: { projectId, role: "USER", type: "USER" },
    orderBy: { sequence: "asc" },
    select: { id: true, content: true },
  });
  const content = row?.content as unknown;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return { id: row?.id ?? null, text };
}

/** A message without the descriptions of what was attached to it. */
export function ownWords(message: string): string {
  return message
    .replace(/<attachment\b[^>]*>[\s\S]*?<\/attachment>/g, "")
    .replace(/\[Attached: [^\]]*\]/g, "")
    .trim();
}

/**
 * The design in a picture sent with the first message, when the message asks
 * for the app to look like it. Null — and the app designed as usual — when
 * there is no picture, when the picture is there for another reason (a logo to
 * use, an error to fix), or when it could not be read in time.
 *
 * What is read is stored with the project as the design the user brought, with
 * the picture it came from, so a later restyle starts from it.
 */
async function designFromFirstMessage(
  projectId: string,
  messageId: string | null,
  said: string,
  config: DesignConfig,
): Promise<{ config: DesignConfig; usage: Usage } | null> {
  if (!messageId || !imageReadingAvailable()) return null;
  try {
    const picture = await prisma.attachment.findFirst({
      where: { messageId, kind: AttachmentKind.IMAGE, blobKey: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { blobKey: true, mimeType: true, userId: true },
    });
    if (!picture?.blobKey) return null;

    const bytes = await getObjectBytes(picture.blobKey);
    const { design, usage } = await withDeadline(
      readDesignImage({ bytes, mimeType: picture.mimeType, message: ownWords(said) }),
      IMAGE_READ_DEADLINE_MS,
      "reading the design from the attached picture",
    );
    const asked = design !== null && design.reading.isInterface && design.reading.wanted === true;
    log.info("design.from_message", {
      projectId,
      read: design !== null,
      isInterface: design?.reading.isInterface ?? null,
      wanted: design?.reading.wanted ?? null,
      used: asked,
    });
    if (!asked) return { config, usage };

    const hash = createHash("sha256").update(bytes).digest("hex");
    await putAttachmentBytes(designReferenceKey(picture.userId, hash), Buffer.from(bytes), picture.mimeType);
    const next: DesignConfig = {
      ...config,
      designMd: design.designMd,
      reference: { hash, mimeType: picture.mimeType.toLowerCase() },
    };
    await prisma.project.update({
      where: { id: projectId },
      data: { designConfig: next as Prisma.InputJsonValue },
    });
    return { config: next, usage };
  } catch (err) {
    log.warn("design.from_message.failed", { projectId, error: String(err).slice(0, 300) });
    return null;
  }
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
export function startDesign(projectId: string, agentBrief: string): Promise<StartedDesign> {
  return (async () => {
    const [first, chosen, standing] = await Promise.all([
      firstUserMessage(projectId).catch(() => ({ id: null, text: "" })),
      userChoices(projectId).catch((): DesignConfig => ({})),
      loadStanding(projectId),
    ]);
    // A design file the user brought is the design; a picture is only looked
    // at when they brought none.
    const fromPicture = chosen.designMd
      ? null
      : await designFromFirstMessage(projectId, first.id, first.text, chosen);
    const config = fromPicture?.config ?? chosen;
    const said = first.text;
    // Standing instructions can be about the look — "always dark", "our brand
    // colour is #0b5fff" — and the director is who acts on those.
    const told = [standing.user, standing.project].filter(Boolean).join("\n");
    const brief = [
      said.trim() ? `What the user asked for:\n${said.trim()}` : "",
      told ? `Standing instructions from the user, which apply to everything they build:\n${told}` : "",
      agentBrief.trim() ? `What is about to be built:\n${agentBrief.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const imported = config.designMd ? parseImportedDesign(config.designMd) : undefined;
    const decided = await directDesign(brief, projectId, config, imported);
    return fromPicture ? { ...decided, readingUsage: fromPicture.usage } : decided;
  })();
}

/**
 * Apply the decided design to the new sandbox. Never throws: an app that
 * could not be designed keeps the neutral look it booted with.
 */
export async function finishDesign(
  ctx: StackContext,
  pending: Promise<StartedDesign>,
): Promise<{ choice: DesignChoice; result: ApplyResult } | null> {
  try {
    const { choice, usage, readingUsage } = await pending;
    if (readingUsage) await meterModelCall(ctx, readingUsage, "design from image");
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
