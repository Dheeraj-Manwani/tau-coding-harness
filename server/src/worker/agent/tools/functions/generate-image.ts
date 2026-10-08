import type Sandbox from "e2b";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ToolCallStatus } from "@/generated/prisma/enums";
import { generateImage, imageGenerationAvailable, isImageAspect } from "@/lib/openrouter";
import { log } from "@/worker/lib/log";
import { publish } from "@/worker/lib/publish";
import { meterModelCall } from "@/worker/lib/meterCall";
import { markProjectWorkspaceStarted } from "@/worker/lib/projectWorkspace";
import { readOrNull } from "@/worker/lib/appStack";
import { DESIGN_PATH, readDesignMeta } from "@/worker/design/designMd";
import { STYLES } from "@/worker/design/styles";
import { isStyleKey } from "@/worker/design/types";
import { asString, persistBinaryFile, toRelativePath, toWorkdirPath } from "./utils";

const TOOL_NAME = "generate_image";

/** What every picture is told, whatever the app: nothing the app could not use as it is. */
const ALWAYS =
  "No text, letters, numbers, logos, watermarks or interface elements in the picture. Natural composition, clean edges.";

/** A file extension for a picture type. */
function extensionOf(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

/**
 * The path a picture is saved at: the one asked for, under `public/`, with the
 * extension of what actually came back. A model that returns a JPEG for a path
 * ending `.png` would otherwise leave a file whose name lies about it.
 */
export function imagePath(requested: string, mimeType: string): string {
  const rel = toRelativePath(requested).replace(/^\/+/, "");
  const inPublic = rel.startsWith("public/") ? rel : `public/${rel.split("/").pop()}`;
  const stem = inPublic.replace(/\.[a-z0-9]{2,5}$/i, "");
  return `${stem}.${extensionOf(mimeType)}`;
}

/**
 * The direction every picture in an app is given, so pictures made one at a
 * time look like one set: the style's art direction, if it has one, and the
 * app's accent colour and mode.
 */
export function artDirection(designMd: string | null): string {
  const meta = designMd ? readDesignMeta(designMd) : null;
  const style = meta && isStyleKey(meta.style) ? STYLES[meta.style] : null;
  const parts = [
    style?.art,
    meta?.accent ? `A palette that suits ${meta.accent} as the main colour` : "",
    meta?.mode === "dark" ? "a darker, moodier tone overall" : "",
  ].filter(Boolean);
  return parts.join("; ");
}

/** The whole prompt sent to the model. */
export function fullPrompt(prompt: string, direction: string): string {
  return [direction && `Art direction: ${direction}.`, prompt.trim(), ALWAYS].filter(Boolean).join("\n\n");
}

/**
 * Pictures this run has made already, from its own tool calls. A call that was
 * refused or failed is also a finished call, so the count is of the ones whose
 * result says a picture was saved.
 */
async function madeSoFar(jobId: string): Promise<number> {
  return prisma.toolCall.count({
    where: {
      message: { jobId },
      toolName: TOOL_NAME,
      status: ToolCallStatus.SUCCESS,
      output: { path: ["success"], equals: true },
    },
  });
}

/**
 * `generate_image`: make a picture and save it into the project.
 *
 * For what image search cannot find: artwork for an app whose look is made of
 * it, a hero picture for a subject with no good photographs. Limited to
 * `IMAGE_MAX_PER_RUN` a run, because each costs real money, and kept out of
 * quick (LOW) builds. The picture is saved the way `download_asset` saves one,
 * so it survives the sandbox and goes with the project.
 */
export async function generateImageTool(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  if (!imageGenerationAvailable()) {
    return {
      unavailable: true,
      error: "Picture generation is not available on this tau instance. Use `search_images` and `download_asset`, or build the spot from the theme. Do not call this again.",
    };
  }
  const { prompt, path, aspect_ratio } = (input ?? {}) as { prompt?: unknown; path?: unknown; aspect_ratio?: unknown };
  const description = asString(prompt, "prompt");
  const requested = asString(path, "path");
  if (description.trim().length < 12) {
    return { error: "Describe the picture in a sentence or two: the subject, the setting, the light, the mood." };
  }

  if ((await madeSoFar(jobId)) >= env.IMAGE_MAX_PER_RUN) {
    return {
      refused: true,
      error: `This run has made its ${env.IMAGE_MAX_PER_RUN} pictures. Do not call this again: use the ones you have, or \`search_images\`, or build the spot from the theme.`,
    };
  }

  const designMd = await readOrNull(sandbox, DESIGN_PATH);
  const aspect = isImageAspect(aspect_ratio) ? aspect_ratio : "16:9";

  let made;
  try {
    made = await generateImage(fullPrompt(description, artDirection(designMd)), aspect);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("image.failed", { jobId, projectId, error: message.slice(0, 300) });
    return { error: message };
  }

  await meterModelCall({ userId, projectId, jobId, indexer }, made.usage, "generated image");

  const dest = imagePath(requested, made.mimeType);
  await markProjectWorkspaceStarted(projectId);
  await publish(jobId, { type: "file_start", path: dest });
  const body = made.bytes.buffer.slice(made.bytes.byteOffset, made.bytes.byteOffset + made.bytes.byteLength) as ArrayBuffer;
  await sandbox.files.write(toWorkdirPath(dest), body);
  const { persisted } = await persistBinaryFile(jobId, projectId, userId, dest, made.bytes, indexer);

  log.info("image.generated", {
    jobId,
    projectId,
    model: made.usage.model,
    aspect,
    bytes: made.bytes.byteLength,
    outputTokens: made.usage.outputTokens,
    costUsd: made.costUsd,
  });
  return {
    success: true,
    path: `/${dest.replace(/^public\//, "")}`,
    file: dest,
    aspect,
    bytes: made.bytes.byteLength,
    madeThisRun: (await madeSoFar(jobId)) + 1,
    of: env.IMAGE_MAX_PER_RUN,
    ...(persisted ? {} : { persisted, warning: "The picture could not be saved with the project." }),
  };
}
