/**
 * A published app's name, description and logo, from the owner's side.
 *
 * Everything here is mechanical: tau's server edits `index.html` and writes two
 * PNGs, and no model is involved (doc/PUBLISHING.md D7). The one model call is
 * the optional AI logo, which runs here on the server and is charged by the
 * picture. Prices are read from `pricing.ts` and sent to the client, never
 * repeated there.
 *
 * Saving goes through the same paths a hand edit does (`saveProjectFile`, the
 * binary writer), so the manifest gets a new sequence, a live sandbox gets the
 * files, and the change shows up as an unpublished change like any other.
 */
import { createHash, randomUUID } from "node:crypto";
import { Sandbox } from "e2b";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getBlobText } from "@/lib/s3";
import { generateImage, imageGenerationAvailable } from "@/lib/openrouter";
import {
  InsufficientCreditsError,
  chargeFlat,
  getBalance,
} from "@/lib/credits";
import {
  LOGO_GENERATION_FEE_MICRO,
  LOGO_UPLOAD_FEE_MICRO,
  PUBLISH_FEE_MICRO,
  toCredits,
} from "@/lib/pricing";
import { showsBadge } from "@/lib/badge";
import { LedgerType, SandboxStatus } from "@/generated/prisma/enums";
import { APP_ICON_SVG } from "@/worker/templates/shared";
import { artDirection } from "@/worker/agent/tools/functions/generate-image";
import { DESIGN_PATH } from "@/worker/design/designMd";
import { log } from "../lib/log";
import { Errors, AppError } from "../lib/errors";
import {
  DEFAULT_ICON_PATH,
  DESCRIPTION_MAX,
  FAVICON_PATH,
  ICON_512_PATH,
  TITLE_MAX,
  applyIdentity,
  logoFileProblem,
  readIdentity,
  type IconKind,
} from "../lib/appIdentity";
import {
  toWorkdirPath,
  writeProjectBinaryFile,
  writeProjectFile,
} from "../lib/projectFiles";
import * as projectRepo from "../repositories/project.repository";
import { allocateHeadSequence } from "@/lib/headSequence";
import { publicSiteUrl } from "@/lib/sites";
import { readProjectFileContent, saveProjectFile } from "./project.service";

const INDEX_HTML = "index.html";

/** AI logos one project may make in a day. Each costs real money. */
export const LOGO_GENERATIONS_PER_DAY = 10;

export interface Prices {
  publishFee: number;
  logoUpload: number;
  logoGeneration: number;
}

export function prices(): Prices {
  return {
    publishFee: toCredits(PUBLISH_FEE_MICRO),
    logoUpload: toCredits(LOGO_UPLOAD_FEE_MICRO),
    logoGeneration: toCredits(LOGO_GENERATION_FEE_MICRO),
  };
}

type Owned = NonNullable<Awaited<ReturnType<typeof projectRepo.findProjectById>>>;

async function ownedProject(projectId: string, userId: string): Promise<Owned> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }
  return project;
}

async function planOf(userId: string) {
  const account = await prisma.billingAccount.findUnique({
    where: { userId },
    select: { plan: true },
  });
  return account?.plan ?? "FREE";
}

async function liveSandbox(project: Owned): Promise<Sandbox | null> {
  if (!project.sandboxId || project.sandboxStatus !== SandboxStatus.READY) return null;
  try {
    return await Sandbox.connect(project.sandboxId);
  } catch {
    return null;
  }
}

export interface IdentityView {
  title: string | null;
  description: string | null;
  icon: IconKind;
  /** What to prefill the name with when the page still carries the scaffold's title. */
  projectName: string;
  plan: "FREE" | "PRO";
  prices: Prices;
  /** AI logos can be made here: configured on this server and on a Pro plan. */
  canGenerate: boolean;
  generationsLeftToday: number;
}

export async function getIdentity(projectId: string, userId: string): Promise<IdentityView> {
  const project = await ownedProject(projectId, userId);
  const plan = await planOf(userId);

  let identity = { title: null, description: null, icon: null } as ReturnType<typeof readIdentity>;
  if (await projectRepo.findProjectFileRecord(projectId, INDEX_HTML)) {
    const file = await readProjectFileContent(project, userId, INDEX_HTML);
    identity = readIdentity(file.content);
  }

  return {
    ...identity,
    projectName: project.name,
    plan,
    prices: prices(),
    canGenerate: imageGenerationAvailable() && !showsBadge(plan),
    generationsLeftToday: Math.max(0, LOGO_GENERATIONS_PER_DAY - (await generationsToday(projectId))),
  };
}

async function generationsToday(projectId: string): Promise<number> {
  return prisma.logoGeneration.count({
    where: { projectId, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
  });
}

export interface SaveIdentityInput {
  title?: string;
  description?: string;
  logo?: {
    favicon: Uint8Array;
    icon512: Uint8Array;
    /** From {@link generateLogo}: the fee for this picture was already paid. */
    generationId?: string;
  };
}

export async function saveIdentity(projectId: string, userId: string, input: SaveIdentityInput) {
  const project = await ownedProject(projectId, userId);

  const active = await projectRepo.findActiveJob(projectId);
  if (active) throw Errors.conflict("generation in progress");

  const title = input.title?.trim();
  const description = input.description?.trim();
  if (title !== undefined && (title.length === 0 || title.length > TITLE_MAX)) {
    throw Errors.badRequest(`The name must be 1 to ${TITLE_MAX} characters.`);
  }
  if (description !== undefined && description.length > DESCRIPTION_MAX) {
    throw Errors.badRequest(`The description can be at most ${DESCRIPTION_MAX} characters.`);
  }

  const record = await projectRepo.findProjectFileRecord(projectId, INDEX_HTML);
  if (!record) throw Errors.badRequest("This project has no index.html to name.");
  const page = await readProjectFileContent(project, userId, INDEX_HTML);

  // Checked before anything is charged or written.
  if (input.logo) {
    const bad =
      logoFileProblem(input.logo.favicon, "small icon") ??
      logoFileProblem(input.logo.icon512, "large icon");
    if (bad) throw Errors.badRequest(bad);
  }

  const current = readIdentity(page.content);
  const sandbox = await liveSandbox(project);
  let balanceAfter: number | null = null;

  if (input.logo) {
    const hash = createHash("sha256")
      .update(input.logo.favicon)
      .update(input.logo.icon512)
      .digest("hex");
    const charge = await chargeForLogo(project, userId, hash, input.logo.generationId);
    balanceAfter = charge;

    await writeBinary(project, sandbox, FAVICON_PATH, input.logo.favicon);
    await writeBinary(project, sandbox, ICON_512_PATH, input.logo.icon512);
    await removeProjectFile(project, sandbox, DEFAULT_ICON_PATH);
  } else if (current.icon === null) {
    // No icon at all: a project made before the template had one, or an older
    // generation. Publishing it should still carry tau's mark.
    await writeText(project, sandbox, DEFAULT_ICON_PATH, APP_ICON_SVG);
  }

  const next = applyIdentity(page.content, {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(input.logo
      ? { icon: "custom" as const, ...siteUrlOf(project) }
      : current.icon === null
        ? { icon: "default" as const }
        : {}),
  });
  if (next !== page.content) {
    await saveProjectFile(projectId, userId, INDEX_HTML, next, page.contentHash);
  }

  const fresh = await ownedProject(projectId, userId);
  log.info("identity.saved", {
    projectId,
    title: title !== undefined,
    description: description !== undefined,
    logo: Boolean(input.logo),
  });
  return {
    identity: readIdentity(next),
    headSequence: fresh.headSequence,
    ...(balanceAfter !== null ? { balance: balanceAfter } : {}),
  };
}

/** `og:image` needs an absolute URL, so only a subdomain site that has its address qualifies. */
function siteUrlOf(project: Owned): { siteUrl?: string } {
  return project.slug && env.SITES_DOMAIN
    ? { siteUrl: publicSiteUrl(project.slug).replace(/\/+$/, "") }
    : {};
}

/**
 * Take the fee for saving a logo, once.
 *
 * A picture this server generated for this project, not yet used, has been paid
 * for (the generation charge is the whole price). Saving the same logo again,
 * or retrying a save that failed after charging, is also free, because both
 * keys below are derived from the content. Anything else pays the upload fee.
 * Returns the balance afterwards in credits.
 */
async function chargeForLogo(
  project: Owned,
  userId: string,
  hash: string,
  generationId: string | undefined,
): Promise<number> {
  if (generationId) {
    // One conditional update, so two saves racing for one picture cannot both
    // waive it, and a retry of the same save still can.
    const claimed = await prisma.logoGeneration.updateMany({
      where: {
        id: generationId,
        projectId: project.id,
        userId,
        OR: [{ usedAt: null }, { usedHash: hash }],
      },
      data: { usedAt: new Date(), usedHash: hash },
    });
    if (claimed.count === 1) {
      return toCredits((await getBalance(userId)).available);
    }
    throw Errors.badRequest("That generated logo was already used or isn't yours. Generate a new one.");
  }

  try {
    const charge = await chargeFlat(
      userId,
      LOGO_UPLOAD_FEE_MICRO,
      `logo-upload:${project.id}:${hash}`,
      LedgerType.LOGO_FEE,
      `logo for ${project.name}`,
      { enforce: env.CREDITS_ENFORCE },
    );
    return toCredits(charge.available);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      throw Errors.paymentRequired(
        `Saving a logo costs ${toCredits(LOGO_UPLOAD_FEE_MICRO)} credits and your balance is short.`,
      );
    }
    throw err;
  }
}

async function writeBinary(project: Owned, sandbox: Sandbox | null, path: string, bytes: Uint8Array) {
  if (sandbox) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await sandbox.files.write(toWorkdirPath(path), buf).catch((err) => {
      log.warn("identity.sandbox_write_failed", { projectId: project.id, path, error: String(err) });
    });
  }
  await writeProjectBinaryFile(project.id, project.userId, path, bytes);
}

async function writeText(project: Owned, sandbox: Sandbox | null, path: string, content: string) {
  if (sandbox) {
    await sandbox.files.write(toWorkdirPath(path), content).catch((err) => {
      log.warn("identity.sandbox_write_failed", { projectId: project.id, path, error: String(err) });
    });
  }
  await writeProjectFile(project.id, project.userId, path, content);
}

/** Remove a file from the sandbox and the manifest. The blob stays: blobs are immutable. */
async function removeProjectFile(project: Owned, sandbox: Sandbox | null, path: string) {
  if (sandbox) {
    await sandbox.files.remove(toWorkdirPath(path)).catch(() => {});
  }
  const existing = await projectRepo.findProjectFileRecord(project.id, path);
  if (!existing) return;
  await prisma.$transaction(async (tx) => {
    await tx.projectFile.delete({
      where: { projectId_path: { projectId: project.id, path } },
    });
    await allocateHeadSequence(tx, project.id);
  });
}

// ── AI logos ─────────────────────────────────────────────────────────────────

/**
 * The prompt for a logo. A flat mark on a plain background with no lettering:
 * image models draw text badly, and a word is unreadable at 16 pixels anyway.
 */
export function logoPrompt(args: { name: string; description: string | null; direction: string }): string {
  return [
    `A simple flat app icon for an app called "${args.name}".`,
    args.description ? `What it is: ${args.description}` : "",
    args.direction && `Art direction: ${args.direction}.`,
    "One bold, simple symbol, centred, on a solid single-colour background that fills the whole square. Two or three flat colours, clean geometric shapes, no gradients, no shadows, no outline frame.",
    "No text, letters, numbers, words, watermarks or interface elements. It must stay recognisable when shrunk to 16 pixels.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateLogo(projectId: string, userId: string) {
  const project = await ownedProject(projectId, userId);

  if (showsBadge(await planOf(userId))) {
    throw Errors.forbidden("Generating a logo is part of the Pro plan.");
  }
  if (!imageGenerationAvailable()) {
    throw Errors.badRequest("Logo generation isn't set up on this tau.");
  }
  if ((await generationsToday(projectId)) >= LOGO_GENERATIONS_PER_DAY) {
    throw Errors.tooMany(`You can generate ${LOGO_GENERATIONS_PER_DAY} logos a day for one app. Try again tomorrow, or upload one.`);
  }

  // Refused before the model is called, so a short balance costs nothing.
  const balance = await getBalance(userId);
  if (env.CREDITS_ENFORCE && balance.available < LOGO_GENERATION_FEE_MICRO) {
    throw Errors.paymentRequired(
      `Generating a logo costs ${toCredits(LOGO_GENERATION_FEE_MICRO)} credits and your balance is short.`,
    );
  }

  let name = project.name;
  let description: string | null = null;
  let direction = "";
  try {
    if (await projectRepo.findProjectFileRecord(projectId, INDEX_HTML)) {
      const page = readIdentity((await readProjectFileContent(project, userId, INDEX_HTML)).content);
      if (page.title && !/vite/i.test(page.title)) name = page.title;
      description = page.description;
    }
    const design = await projectRepo.findProjectFileRecord(projectId, DESIGN_PATH);
    if (design) direction = artDirection(await getBlobText(userId, projectId, design.contentHash));
  } catch (err) {
    // Context makes a better logo; its absence is not a reason to refuse one.
    log.warn("identity.logo_context_failed", { projectId, error: String(err).slice(0, 200) });
  }

  let made;
  try {
    made = await generateImage(logoPrompt({ name, description, direction }), "1:1");
  } catch (err) {
    // Nothing was charged: the model gave nothing back.
    log.warn("identity.logo_failed", { projectId, error: String(err).slice(0, 300) });
    throw new AppError(err instanceof Error ? err.message : "The logo couldn't be made.", 502);
  }

  const generationId = randomUUID();
  try {
    const charge = await prisma.$transaction(async (tx) => {
      const paid = await chargeFlat(
        userId,
        LOGO_GENERATION_FEE_MICRO,
        `logo-generate:${generationId}`,
        LedgerType.LOGO_FEE,
        `generated logo for ${project.name}`,
        { enforce: env.CREDITS_ENFORCE, tx },
      );
      await tx.logoGeneration.create({ data: { id: generationId, projectId, userId } });
      return paid;
    });
    log.info("identity.logo_generated", { projectId, model: made.usage.model, outputTokens: made.usage.outputTokens });
    return {
      generationId,
      mimeType: made.mimeType,
      image: Buffer.from(made.bytes).toString("base64"),
      balance: toCredits(charge.available),
      generationsLeftToday: Math.max(0, LOGO_GENERATIONS_PER_DAY - (await generationsToday(projectId))),
    };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      throw Errors.paymentRequired(
        `Generating a logo costs ${toCredits(LOGO_GENERATION_FEE_MICRO)} credits and your balance is short.`,
      );
    }
    throw err;
  }
}
