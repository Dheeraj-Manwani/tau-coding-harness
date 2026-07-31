/**
 * `frontend` → `fullstack`: giving an existing app a backend.
 *
 * "I built a to-do app, now add AI to it" used to be a dead end. AI needs a
 * server — a key in a Vite bundle is a public key — and `Project.templateKey` is
 * locked once the project has files, so `enable_ai` could only refuse and tell
 * the user to start over.
 *
 * ## Why this is a transform and not a prompt
 *
 * Diffing the two template definitions, `scaffoldBase`, `writeTsconfig`,
 * `shadcnInit`, `writeTheme` and `writeAppShell` are byte-identical between
 * `vite-react.ts` and `vite-react-hono.ts`. Exactly four things differ, and all
 * four are mechanical. So this is a deterministic edit over `ProjectFile` rows
 * and R2 blobs — the same principle `DEPLOY.md` §P2 applies to the PGlite
 * codemod: do it as a transform, not by asking the agent to do it.
 *
 * ## Why it runs before the next provision
 *
 * It rewrites the manifest and marks the sandbox dead. The next
 * `provisionSandbox` boots the `vite-hono-app` image and rehydrates the
 * transformed manifest onto it, so the correct bytes are written once rather
 * than being written wrong and then patched.
 *
 * See doc/AI_FOR_GENERATED_APPS.md §7.3.
 */
import { prisma } from "./prisma";
import { log } from "./log";
import { readManifestFile, writeManifestFile } from "./manifestFiles";
import { SandboxStatus } from "../generated/prisma/enums";
import {
  HONO_SERVER_INDEX,
  VITE_ALLOWED_HOSTS_LINE,
  VITE_API_PROXY_LINE,
  buildContextMd,
  writeViteConfigContent,
} from "../templates/shared";

export type MigrateOutcome =
  | { migrated: true; changed: string[]; notes: string[] }
  | { migrated: false; reason: "already_has_server" }
  | { migrated: false; reason: "hand_rolled_server"; detail: string };

/** The marker `.tau/CONTEXT.md` uses to separate template manifest from live
 *  app state. Everything from here down is the agent's and must survive. The
 *  full line carries trailing padding, so match the stable prefix. */
const DYNAMIC_MARKER = "<!-- DYNAMIC";

/**
 * Insert the `/api` proxy into an existing `vite.config.ts`.
 *
 * Anchored on the `allowedHosts` line the template writes. If the agent has
 * rewritten the file and the anchor is gone, the caller regenerates from
 * `writeViteConfigContent` instead and says so — a missing anchor means we
 * cannot know what else changed, and a blind regex would be worse than an
 * honest replacement.
 */
export function patchViteConfig(source: string): string | null {
  if (source.includes("proxy:") && source.includes("/api")) return source;
  if (!source.includes(VITE_ALLOWED_HOSTS_LINE)) return null;
  return source.replace(
    VITE_ALLOWED_HOSTS_LINE,
    `${VITE_ALLOWED_HOSTS_LINE}\n${VITE_API_PROXY_LINE}`,
  );
}

/** Add `hono` to dependencies, preserving everything else and the formatting
 *  style (2-space, trailing newline) the rest of the scaffold uses. */
export function patchPackageJson(source: string): string | null {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  if (deps.hono) return source;

  // Sorted, because bun and npm both write dependencies sorted and leaving it
  // unsorted makes the next lockfile diff noisier than the change itself.
  const next = Object.fromEntries(
    Object.entries({ ...deps, hono: "^4.6.0" }).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  return `${JSON.stringify({ ...pkg, dependencies: next }, null, 2)}\n`;
}

/**
 * Regenerate the static half of CONTEXT.md, keeping everything the agent wrote
 * below the DYNAMIC marker. That marker exists for exactly this kind of surgery.
 */
export function patchContextMd(source: string | null): string {
  const fresh = buildContextMd({ hasServer: true, hasDb: false });
  if (!source) return fresh;

  const idx = source.indexOf(DYNAMIC_MARKER);
  if (idx === -1) return fresh;

  return `${fresh.split(DYNAMIC_MARKER)[0] ?? ""}${source.slice(idx)}`;
}

export async function migrateTemplate(
  projectId: string,
  userId: string,
): Promise<MigrateOutcome> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { templateKey: true },
  });

  // Guard: only ever `frontend` → `fullstack`. Never the reverse (destructive),
  // and never → `fullstack-db` (the no-DB template already carries the PGlite
  // recipe in CONTEXT.md for a project that later needs one).
  if (project?.templateKey !== "frontend") {
    return { migrated: false, reason: "already_has_server" };
  }

  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, contentHash: true },
  });

  // A hand-rolled `server/` means the agent has already built something here.
  // Merging our scaffold into it is a conflict we cannot resolve blind, so bail
  // with something the agent can relay rather than clobbering their work.
  const existingServer = files.find(
    (f) => f.path === "server/index.ts" || f.path.startsWith("server/"),
  );
  if (existingServer) {
    return {
      migrated: false,
      reason: "hand_rolled_server",
      detail: `The project already has ${existingServer.path}.`,
    };
  }

  const byPath = new Map(files.map((f) => [f.path, f]));
  const changed: string[] = [];
  const notes: string[] = [];

  // 1) vite.config.ts — the /api proxy.
  const viteRow = byPath.get("vite.config.ts");
  const viteSource = viteRow
    ? await readManifestFile(userId, projectId, viteRow)
    : null;
  const patchedVite = viteSource ? patchViteConfig(viteSource) : null;
  if (patchedVite) {
    await writeManifestFile(userId, projectId, "vite.config.ts", patchedVite);
  } else {
    await writeManifestFile(
      userId,
      projectId,
      "vite.config.ts",
      writeViteConfigContent({ proxyApi: true }),
    );
    notes.push(
      "vite.config.ts had been rewritten, so it was regenerated from the template with the /api proxy added. Any custom Vite settings in it were lost — check it if the app used any.",
    );
  }
  changed.push("vite.config.ts");

  // 2) package.json — the hono dependency, and drop the now-stale lockfile.
  const pkgRow = byPath.get("package.json");
  const pkgSource = pkgRow ? await readManifestFile(userId, projectId, pkgRow) : null;
  const patchedPkg = pkgSource ? patchPackageJson(pkgSource) : null;
  if (patchedPkg) {
    await writeManifestFile(userId, projectId, "package.json", patchedPkg);
    changed.push("package.json");
  } else {
    notes.push(
      "package.json could not be parsed, so `hono` was not added to it — run `bun add hono` before using the server.",
    );
  }

  // The stored lockfile no longer matches package.json. Deleting the row means
  // the next boot resolves cleanly instead of failing `--frozen-lockfile`.
  const deletedLock = await prisma.projectFile.deleteMany({
    where: { projectId, path: { in: ["bun.lock", "bun.lockb"] } },
  });
  if (deletedLock.count > 0) changed.push("bun.lock (removed)");

  // 3) server/index.ts — the same bytes the template bakes in.
  await writeManifestFile(userId, projectId, "server/index.ts", HONO_SERVER_INDEX);
  changed.push("server/index.ts");

  // 4) .tau/CONTEXT.md — regenerate the static half only.
  const ctxRow = byPath.get(".tau/CONTEXT.md");
  const ctxSource = ctxRow ? await readManifestFile(userId, projectId, ctxRow) : null;
  await writeManifestFile(
    userId,
    projectId,
    ".tau/CONTEXT.md",
    patchContextMd(ctxSource),
  );
  changed.push(".tau/CONTEXT.md");

  // 5) Flip the template and kill the sandbox. The next provision boots
  //    `vite-hono-app` and rehydrates the transformed manifest onto it.
  await prisma.project.update({
    where: { id: projectId },
    data: {
      templateKey: "fullstack",
      sandboxStatus: SandboxStatus.DEAD,
    },
  });

  log.info("migrate.template", {
    projectId,
    from: "frontend",
    to: "fullstack",
    changed,
    notes: notes.length,
  });

  return { migrated: true, changed, notes };
}
