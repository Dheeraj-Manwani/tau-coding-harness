/**
 * A project's look, from the user's side: what it is, and changing it.
 *
 * When an app is created its design is decided and applied by the worker, in
 * the new sandbox (`worker/design/provision.ts`). Everything after that goes
 * through here:
 *
 *   - **the catalog** — the styles a user can pick from, for the composer and
 *     the restyle panel;
 *   - **the current design** — read back from the app's `.tau/DESIGN.md`;
 *   - **a restyle** — a different style, accent, mode, font pairing or feel
 *     applied to an app that already exists;
 *   - **keeping `DESIGN.md` true** after the theme panel changes a colour.
 *
 * A restyle costs no model call and no job. A design is two generated files,
 * so changing it is generating them again and writing them — into the live
 * sandbox when there is one, so the preview restyles as the user watches, and
 * into the project's stored files either way. What the app added to those two
 * files since is carried over (`worker/design/restyle.ts`). The agent is not
 * involved: it learns of the new design the way it learns of any, from the
 * `DESIGN.md` it is handed with the next request.
 *
 * The one case that does call a model is a restyle from an imported
 * `DESIGN.md` with no style named: something has to judge which of tau's
 * styles is closest to the file, and that is the design director's job.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5, layers 2 and 3.
 */
import { Sandbox } from "e2b";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getBlobText } from "@/lib/s3";
import { SandboxStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { log } from "@/worker/lib/log";
import { hasDependency } from "@/worker/lib/appStack";
import { applyDesignTo, type DesignTarget } from "@/worker/design/apply";
import { designCatalog } from "@/worker/design/catalog";
import { describeDesign, normalizeDesignConfig } from "@/worker/design/config";
import { DESIGN_PATH, syncDesignMd } from "@/worker/design/designMd";
import { directDesign } from "@/worker/design/director";
import { parseImportedDesign } from "@/worker/design/importDesign";
import { readOf, restyledChoice } from "@/worker/design/restyle";
import { STYLES, isFontPairing } from "@/worker/design/styles";
import type { DesignConfig } from "@/worker/design/types";
import { AppError, Errors } from "../lib/errors";
import { toWorkdirPath, writeProjectFile } from "../lib/projectFiles";
import * as projectRepo from "../repositories/project.repository";

const WORK_DIR = toWorkdirPath("");
const INSTALL_TIMEOUT_MS = 2 * 60_000;
const LOCKFILES = ["bun.lock", "bun.lockb"];

/**
 * The styles on offer. `enabled` is false where new projects are still built
 * on the older templates, which have no design step: the composer hides its
 * style picker there rather than offer a choice nothing would act on.
 */
export function getDesignCatalog() {
  return { ...designCatalog(), enabled: env.TEMPLATE_GENERATION === 2 };
}

type OwnedProject = NonNullable<Awaited<ReturnType<typeof projectRepo.findProjectById>>>;

async function ownedProject(projectId: string, userId: string): Promise<OwnedProject> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }
  return project;
}

/** The project's sandbox, when it has one that answers. */
async function liveSandbox(project: OwnedProject): Promise<Sandbox | null> {
  if (!project.sandboxId || project.sandboxStatus !== SandboxStatus.READY) return null;
  try {
    return await Sandbox.connect(project.sandboxId);
  } catch {
    return null;
  }
}

/** A stored file's text, or null when the project has no such file. */
async function storedFile(project: OwnedProject, path: string): Promise<string | null> {
  const record = await projectRepo.findProjectFileRecord(project.id, path);
  if (!record) return null;
  return getBlobText(project.userId, project.id, record.contentHash);
}

/**
 * The project as somewhere to put a design: its live sandbox if it has one,
 * and its stored files always.
 *
 * Reads prefer the sandbox, because that is what the user is looking at.
 * Writes go to both. Packages are installed in the sandbox when there is one,
 * and its `package.json` and lockfile are then stored; with no sandbox the
 * package is added to the stored `package.json` and the stored lockfile is
 * dropped, so the next sandbox to be built installs it fresh.
 */
function projectTarget(project: OwnedProject, sandbox: Sandbox | null): DesignTarget {
  const store = (path: string, content: string) =>
    writeProjectFile(project.id, project.userId, path, content);

  return {
    installsNow: sandbox !== null,

    async read(path) {
      if (sandbox) {
        try {
          return await sandbox.files.read(toWorkdirPath(path));
        } catch {
          // Not in the sandbox, or the sandbox has gone: the stored copy decides.
        }
      }
      return storedFile(project, path);
    },

    async write(path, content) {
      if (sandbox) {
        await sandbox.files.write(toWorkdirPath(path), content).catch((err) => {
          log.warn("design.sandbox_write_failed", { projectId: project.id, path, error: String(err) });
        });
      }
      await store(path, content);
    },

    async addPackages(packages) {
      if (sandbox) {
        try {
          await sandbox.commands.run(`bun add ${packages.join(" ")}`, {
            cwd: WORK_DIR,
            timeoutMs: INSTALL_TIMEOUT_MS,
          });
          for (const file of ["package.json", "bun.lock"]) {
            const content = await sandbox.files.read(toWorkdirPath(file)).catch(() => null);
            if (content !== null) await store(file, content);
          }
          return { ok: true };
        } catch (err) {
          return { ok: false, detail: String(err).slice(-400) };
        }
      }

      const source = await storedFile(project, "package.json");
      if (!source) return { ok: false, detail: "the project has no package.json" };
      let pkg: { dependencies?: Record<string, string> };
      try {
        pkg = JSON.parse(source) as typeof pkg;
      } catch {
        return { ok: false, detail: "package.json could not be read" };
      }
      pkg.dependencies = { ...pkg.dependencies };
      for (const name of packages) {
        if (!hasDependency(source, name)) pkg.dependencies[name] = "latest";
      }
      await store("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
      // The stored lockfile no longer matches; without it the next sandbox
      // resolves the new packages instead of failing a frozen install.
      await prisma.projectFile.deleteMany({
        where: { projectId: project.id, path: { in: LOCKFILES } },
      });
      return { ok: true };
    },
  };
}

/** What the user chose, without the text of a file they imported. */
function publicConfig(raw: unknown) {
  const config = normalizeDesignConfig(raw) ?? {};
  const { designMd, ...rest } = config;
  return { ...rest, imported: designMd !== undefined };
}

/**
 * How the project looks now, and which parts of that the user chose.
 *
 * `design` is null for an app tau did not design (an older project, or one
 * whose `DESIGN.md` was replaced by hand); such an app cannot be restyled,
 * because there is no tau stylesheet to regenerate.
 */
export async function getProjectDesign(projectId: string, userId: string) {
  const project = await ownedProject(projectId, userId);
  const designMd = await projectTarget(project, await liveSandbox(project)).read(DESIGN_PATH);
  const design = describeDesign(designMd);
  return {
    design,
    chosen: publicConfig(project.designConfig),
    restylable: design !== null,
  };
}

/**
 * The user's choices after a restyle: what they had chosen before, with this
 * request's on top.
 *
 * Light-or-dark and the dials belong to a style, and a restyle to a different
 * one takes the new style's unless the request says otherwise
 * (`restyledChoice`). An earlier choice of those no longer describes the app,
 * so it is not kept as if it did.
 */
export function mergedConfig(
  previous: unknown,
  request: DesignConfig,
  styleKey: string,
  styleChanged: boolean,
): DesignConfig {
  const before = normalizeDesignConfig(previous) ?? {};
  if (styleChanged) {
    delete before.mode;
    delete before.dials;
  }
  const merged: DesignConfig = { ...before, ...request };
  if (request.dials) merged.dials = { ...before.dials, ...request.dials };
  // A pairing belongs to the style it was chosen for.
  if (merged.fonts && !(merged.style === styleKey && isFontPairing(STYLES[merged.style], merged.fonts))) {
    delete merged.fonts;
  }
  // An imported file was replaced by a style of tau's unless this request brought one.
  if (!request.designMd && request.style) delete merged.designMd;
  return merged;
}

/**
 * Change how an existing app looks.
 *
 * `request` holds only what the user wants changed; everything else carries
 * over from the app's current design (`restyledChoice`). Refused while the
 * agent is running — it writes the same files.
 */
export async function restyleProject(projectId: string, userId: string, request: DesignConfig) {
  const project = await ownedProject(projectId, userId);

  const active = await projectRepo.findActiveJob(projectId);
  if (active) throw Errors.conflict("generation in progress");

  const sandbox = await liveSandbox(project);
  const target = projectTarget(project, sandbox);

  const currentMd = await target.read(DESIGN_PATH);
  const current = describeDesign(currentMd);
  if (!current) {
    throw Errors.badRequest(
      "This app's design was not set up by tau, so its style cannot be changed here. Ask tau to restyle it in the chat instead.",
    );
  }

  const imported = request.designMd ? parseImportedDesign(request.designMd) : undefined;
  const read = readOf(currentMd);

  // A colour the user chose themselves is still theirs after a restyle: it
  // stays exactly as chosen instead of being refitted to the new style. Not so
  // once the theme panel has changed it, when the stored choice is out of date.
  const chosenAccent = normalizeDesignConfig(project.designConfig)?.accent;
  let config: DesignConfig =
    !request.accent && chosenAccent && chosenAccent === current.accent
      ? { ...request, accent: chosenAccent }
      : request;

  // An imported design with no style named: find the closest one.
  if (imported && !request.style) {
    const { choice } = await directDesign(read ?? "", projectId, config, imported);
    config = { ...config, style: choice.style };
  }

  const choice = restyledChoice(current, config, read, projectId, imported);
  const result = await applyDesignTo(target, choice, {
    restyle: true,
    logWith: { projectId, live: sandbox !== null },
  });
  if (!result.applied) {
    throw new AppError("The new style could not be written to the app.", 500);
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      designConfig: mergedConfig(
        project.designConfig,
        request,
        choice.style,
        choice.style !== current.style,
      ) as Prisma.InputJsonValue,
    },
    select: { headSequence: true, designConfig: true },
  });

  return {
    applied: true as const,
    design: describeDesign(await target.read(DESIGN_PATH)),
    chosen: publicConfig(updated.designConfig),
    fontsInstalled: result.fontsInstalled,
    skipped: result.skipped,
    headSequence: updated.headSequence,
    /** False when the app was not running: the change shows when the preview next starts. */
    live: sandbox !== null,
  };
}

/**
 * After the theme panel has changed `src/index.css`, make `DESIGN.md` say the
 * same. Best effort and silent: the stylesheet is what the app runs on, and a
 * failure here must not undo or fail a theme edit that has already been saved.
 *
 * @param tokens  the palette the app opens in, as the panel reads it, plus `--radius`
 */
export async function syncDesignAfterThemeEdit(
  projectId: string,
  userId: string,
  tokens: Readonly<Record<string, string>>,
): Promise<void> {
  try {
    const project = await ownedProject(projectId, userId);
    const target = projectTarget(project, await liveSandbox(project));
    const before = await target.read(DESIGN_PATH);
    if (!before) return;
    const after = syncDesignMd(before, tokens);
    if (after !== before) await target.write(DESIGN_PATH, after);
  } catch (err) {
    log.warn("design.sync_failed", { projectId, error: String(err) });
  }
}
