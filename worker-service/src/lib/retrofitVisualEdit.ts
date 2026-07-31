/**
 * Visual edit for projects that predate it — doc/VISUAL_EDIT_PLAN.md §6 Phase 5.
 *
 * Phases 1–4 ship the tagger inside the E2B template images, so every project
 * created after the image rebuild can be clicked and edited. Projects created
 * *before* it carry a `vite.config.ts` in their manifest that knows nothing
 * about `tauTagger()`, and rehydration faithfully writes that old config onto
 * the new sandbox — so the feature stays dark for them forever.
 *
 * ## Why this is a transform and not a prompt
 *
 * The same argument as `migrateTemplate`: the delta is mechanical and knowable
 * (two files, one import, one plugin entry, two devDependencies), so it is a
 * deterministic edit over `ProjectFile` rows and R2 blobs rather than a thing to
 * ask the agent to do.
 *
 * ## Why it runs before the next provision
 *
 * `provisionSandbox` calls this on the fresh-sandbox path, ahead of
 * `rehydrateSandbox`. Rehydration is what writes the manifest onto the new
 * sandbox, so patching first means the correct bytes land once, rather than
 * landing wrong and being patched in place afterwards (which would also need a
 * Vite restart to take effect — the config is read at boot).
 *
 * ## Why it is safe to wire the plugin before the deps are installed
 *
 * `vite.config.ts` imports `.tau/tagger.ts`, which imports `@babel/parser` and
 * `magic-string`. If those were missing from `node_modules`, Vite would fail to
 * start and the preview would be dead — a far worse outcome than no visual edit.
 * They are not missing: the sandbox boots from the current template image, which
 * has both baked in, and rehydration only ever *adds* files on top. The
 * package.json patch here exists so the user's exported repo installs them too,
 * not to get them into the running sandbox.
 *
 * ## Self-healing
 *
 * This is not a one-shot migration — it runs on every fresh provision and
 * re-applies whatever is missing. That is deliberate: §7's risk table lists "the
 * agent deletes the tagger" (it can edit `vite.config.ts`) with "re-add on
 * provision" as the mitigation, and it also means an improved tagger reaches
 * existing projects without a second migration.
 */
import { prisma } from "./prisma";
import { log } from "./log";
import { readManifestFile, writeManifestFile } from "./manifestFiles";
import { sha256Hex } from "../agent/tools/functions/utils";
import {
  VISUAL_EDIT_DEPS,
  VISUAL_EDIT_IMPORT_LINE,
  VISUAL_EDIT_PLUGIN_ENTRY,
  VITE_PLUGINS_PREFIX,
  VITE_TAILWIND_IMPORT_LINE,
  readVisualEditAsset,
} from "../templates/shared";

export const TAGGER_PATH = ".tau/tagger.ts";
export const RUNTIME_PATH = ".tau/runtime.js";

export type RetrofitOutcome =
  | { retrofitted: true; changed: string[] }
  | {
      retrofitted: false;
      reason:
        | "up_to_date"
        | "empty_manifest"
        | "no_vite_config"
        | "vite_config_unreadable"
        | "no_plugins_array"
        | "package_json_unusable";
    };

/**
 * Add the tagger import and the `tauTagger()` plugin entry to a `vite.config.ts`.
 *
 * Two tiers, on purpose:
 *
 * 1. **The template's own anchors.** An untouched config still contains
 *    `VITE_TAILWIND_IMPORT_LINE` and `VITE_PLUGINS_PREFIX`, so we can put both
 *    additions exactly where `writeViteConfigContent` puts them and the result
 *    is byte-identical to a freshly provisioned project's config.
 * 2. **Anything else.** The agent may have rewritten the file. Then we insert
 *    the import at the top and the plugin at the *front* of the plugins array.
 *    Front, not back, because finding the array's closing bracket means bracket
 *    matching through nested plugin options, and getting that wrong breaks the
 *    user's whole preview. Position is free to choose: `tauTagger()` declares
 *    `enforce: "pre"`, which is what actually orders it ahead of the React
 *    plugin (proved by Phase 0, which listed it last and it still worked).
 *
 * Returns the input unchanged when already wired, and `null` when there is no
 * plugins array to insert into — a config that far from the template is one we
 * decline to guess at. `migrateTemplate` regenerates from the template in that
 * situation; this must not, because that discards the agent's Vite settings and
 * unlike `enable_ai` nobody asked for it, nor is there anywhere to report it.
 */
export function patchViteConfigForVisualEdit(source: string): string | null {
  const hasImport = source.includes(VISUAL_EDIT_IMPORT_LINE);
  const hasPlugin = source.includes(VISUAL_EDIT_PLUGIN_ENTRY);
  if (hasImport && hasPlugin) return source;

  let out = source;

  if (!hasPlugin) {
    if (out.includes(`${VITE_PLUGINS_PREFIX}]`)) {
      out = out.replace(
        `${VITE_PLUGINS_PREFIX}]`,
        `${VITE_PLUGINS_PREFIX}, ${VISUAL_EDIT_PLUGIN_ENTRY}]`,
      );
    } else {
      const open = /plugins\s*:\s*\[/.exec(out);
      if (!open) return null;
      const at = open.index + open[0].length;
      const rest = out.slice(at);
      // `[]` → `[tauTagger()]`, not `[tauTagger(), ]`.
      const sep = /^\s*\]/.test(rest) ? "" : ", ";
      out = `${out.slice(0, at)}${VISUAL_EDIT_PLUGIN_ENTRY}${sep}${rest}`;
    }
  }

  if (!hasImport) {
    if (out.includes(VITE_TAILWIND_IMPORT_LINE)) {
      out = out.replace(
        VITE_TAILWIND_IMPORT_LINE,
        `${VITE_TAILWIND_IMPORT_LINE}\n${VISUAL_EDIT_IMPORT_LINE}`,
      );
    } else {
      // Top of file. Imports are hoisted, so this is always valid — and it is
      // the only insertion point that cannot land in the middle of a multi-line
      // `import { … } from '…'`, which "after the last import line" would.
      out = `${VISUAL_EDIT_IMPORT_LINE}\n${out}`;
    }
  }

  return out;
}

/**
 * Add the tagger's devDependencies, preserving everything else and the
 * formatting style (2-space, trailing newline) the rest of the scaffold uses.
 *
 * Returns the input unchanged when both are already declared, and `null` on
 * unparseable JSON — the caller then skips the whole retrofit rather than
 * shipping a config that imports a plugin the user's own `bun install` would
 * never fetch.
 */
export function patchPackageJsonForVisualEdit(source: string): string | null {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }

  const dev = (pkg.devDependencies ?? {}) as Record<string, string>;
  const missing = Object.entries(VISUAL_EDIT_DEPS).filter(
    ([name]) => !dev[name],
  );
  if (missing.length === 0) return source;

  // Sorted, because bun and npm both write dependencies sorted and leaving it
  // unsorted makes the next lockfile diff noisier than the change itself.
  const next = Object.fromEntries(
    Object.entries({ ...dev, ...Object.fromEntries(missing) }).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  return `${JSON.stringify({ ...pkg, devDependencies: next }, null, 2)}\n`;
}

export async function retrofitVisualEdit(
  projectId: string,
  userId: string,
): Promise<RetrofitOutcome> {
  const rows = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, contentHash: true },
  });
  // A project with no files has not been seeded yet; the template image is about
  // to give it a tagger for free.
  if (rows.length === 0) return { retrofitted: false, reason: "empty_manifest" };

  const byPath = new Map(rows.map((f) => [f.path, f]));

  const viteRow = byPath.get("vite.config.ts");
  if (!viteRow) return { retrofitted: false, reason: "no_vite_config" };
  const viteSource = await readManifestFile(userId, projectId, viteRow);
  if (viteSource === null) {
    return { retrofitted: false, reason: "vite_config_unreadable" };
  }
  const patchedVite = patchViteConfigForVisualEdit(viteSource);
  if (patchedVite === null) {
    return { retrofitted: false, reason: "no_plugins_array" };
  }

  const pkgRow = byPath.get("package.json");
  const pkgSource = pkgRow
    ? await readManifestFile(userId, projectId, pkgRow)
    : null;
  const patchedPkg =
    pkgSource === null ? null : patchPackageJsonForVisualEdit(pkgSource);
  if (patchedPkg === null) {
    return { retrofitted: false, reason: "package_json_unusable" };
  }

  const tagger = readVisualEditAsset("tagger.ts");
  const runtime = readVisualEditAsset("runtime.js");
  const taggerStale = byPath.get(TAGGER_PATH)?.contentHash !== sha256Hex(tagger);
  const runtimeStale =
    byPath.get(RUNTIME_PATH)?.contentHash !== sha256Hex(runtime);

  if (
    patchedVite === viteSource &&
    patchedPkg === pkgSource &&
    !taggerStale &&
    !runtimeStale
  ) {
    return { retrofitted: false, reason: "up_to_date" };
  }

  const changed: string[] = [];

  // Order matters: assets and dependencies first, `vite.config.ts` last. If a
  // write fails halfway the project is left un-wired (visual edit simply stays
  // off and the next provision tries again) rather than wired to a tagger that
  // isn't there, which would take the preview down with it.
  if (taggerStale) {
    await writeManifestFile(userId, projectId, TAGGER_PATH, tagger);
    changed.push(TAGGER_PATH);
  }
  if (runtimeStale) {
    await writeManifestFile(userId, projectId, RUNTIME_PATH, runtime);
    changed.push(RUNTIME_PATH);
  }

  if (patchedPkg !== pkgSource) {
    await writeManifestFile(userId, projectId, "package.json", patchedPkg);
    changed.push("package.json");

    // The stored lockfile no longer matches package.json. Deleting the row means
    // the next boot resolves cleanly, instead of failing `--frozen-lockfile`
    // first and only then falling back — sandbox.ts pays for both attempts.
    const deletedLock = await prisma.projectFile.deleteMany({
      where: { projectId, path: { in: ["bun.lock", "bun.lockb"] } },
    });
    if (deletedLock.count > 0) changed.push("bun.lock (removed)");
  }

  if (patchedVite !== viteSource) {
    await writeManifestFile(userId, projectId, "vite.config.ts", patchedVite);
    changed.push("vite.config.ts");
  }

  log.info("visual_edit.retrofit", { projectId, changed });

  return { retrofitted: true, changed };
}
