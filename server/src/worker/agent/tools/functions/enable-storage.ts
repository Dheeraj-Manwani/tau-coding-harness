import type Sandbox from "e2b";
import { prisma } from "@/lib/prisma";
import { log } from "@/worker/lib/log";
import {
  buildProjectEnv,
  restartAppServer,
  storageUsable,
  writeEnvFile,
} from "@/worker/lib/aiEnv";
import { keyEncryptionConfigured } from "@/lib/apiKeys";
import { ensureStorageKey } from "@/lib/storageKeys";
import { TEMPLATES, toTemplateKey } from "@/worker/templates/registry";
import { addBackend, readOrNull, writeTracked } from "@/worker/lib/appStack";
import { STORAGE_ENV_ENTRIES, upsertDeployManifest } from "@/worker/lib/deployManifest";
import { STORAGE_SCAFFOLD } from "@/worker/lib/storageScaffold";
import { guideText } from "../../docs";

const NOT_AVAILABLE =
  "File storage is not available on this tau instance, so this app cannot keep uploaded files. Tell the user plainly. Do NOT write uploads to the server's disk, do NOT keep a file as base64 in a table or in the browser's storage, and do NOT ask the user for an S3 or Cloudinary key. Build the rest of the request without file uploads.";

/**
 * Turn on file storage for this project: mint the preview key, put it in the
 * app's environment, record the deploy requirement, write the two helper files,
 * and hand the agent the guide.
 *
 * Idempotent — a second call re-injects and returns the guide. A helper file
 * that already exists is left alone, so an edit the agent made survives.
 */
export async function enableStorage(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  const { purpose } = (input ?? {}) as { purpose?: unknown };

  if (!keyEncryptionConfigured()) return { error: NOT_AVAILABLE };

  // Before anything is minted or written, for the reason enable_ai does the
  // same: an app that looks wired up and fails on every upload is worse than a
  // plain refusal.
  const reachable = storageUsable();
  if (!reachable.ok) {
    log.error("storage.enable_refused", { jobId, projectId, reason: reachable.reason, detail: reachable.detail });
    return { error: NOT_AVAILABLE };
  }

  // Anyone can then upload files to this app and tau stores them, so it needs an
  // address that someone answers: the rule publishing applies (requestDeploy).
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  if (!user?.emailVerifiedAt) {
    return {
      error:
        "File storage needs a verified email address, and this account has not verified its email yet. Tell the user to verify their email, then ask for file uploads again. Build the rest of the request without uploads for now, and do NOT write uploads to the server's disk or keep files as base64.",
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { templateKey: true, storageEnabled: true },
  });
  if (!project) return { error: `Project ${projectId} not found` };

  const template = TEMPLATES[toTemplateKey(project.templateKey)];
  if (template.generation !== 2) {
    return {
      error:
        "This project's stack was fixed when it was created, so file storage cannot be added to it. Tell the user plainly that this app cannot keep uploaded files, and build the rest of the request without them.",
    };
  }

  const ctx = { sandbox, projectId, userId, jobId, indexer };
  let backendAdded = false;
  if (!template.hasServer) {
    // Not started here: the restart below does that, after `.env` is written.
    const added = await addBackend(ctx, { start: false });
    if (!added.ok) {
      return {
        error: `File storage needs a server, and setting one up for this app failed: ${added.error} Tell the user plainly that file uploads could not be turned on, then build the rest of what they asked for without them.`,
      };
    }
    backendAdded = true;
  }

  await ensureStorageKey(projectId, userId, "PREVIEW");
  await prisma.project.update({ where: { id: projectId }, data: { storageEnabled: true } });

  // The whole .env is rewritten, so it is built with the user's own keys and the
  // AI vars too.
  const flags = await prisma.project.findUnique({ where: { id: projectId }, select: { aiEnabled: true } });
  const vars = await buildProjectEnv(userId, projectId, jobId, {
    aiEnabled: flags?.aiEnabled ?? false,
    storage: "PREVIEW",
  });
  await writeEnvFile(sandbox, vars);

  await upsertDeployManifest(sandbox, jobId, projectId, userId, indexer, STORAGE_ENV_ENTRIES);

  const helpers: string[] = [];
  for (const file of STORAGE_SCAFFOLD) {
    if ((await readOrNull(sandbox, file.path)) === null) {
      await writeTracked(ctx, file.path, file.content());
    }
    helpers.push(file.path);
  }

  // The server read its environment at boot.
  await restartAppServer(sandbox, jobId);

  log.info("storage.enabled", {
    jobId,
    projectId,
    purpose: typeof purpose === "string" ? purpose.slice(0, 200) : null,
    alreadyEnabled: project.storageEnabled,
  });

  return {
    success: true,
    // Names only: the model has no reason to see the key.
    envVars: ["TAU_STORAGE_KEY", "TAU_STORAGE_URL"],
    helpers,
    ...(backendAdded
      ? {
          backendAdded:
            "This app had no server, so one was set up in place: `server/index.ts`, a Hono API the frontend reaches at `/api/*`. Nothing was rebuilt and the existing UI is untouched. Add the file routes there, as the guide shows.",
        }
      : {}),
    // docs/storage.md — the same text `read_doc("storage")` returns.
    recipe: guideText("storage"),
  };
}
