import type Sandbox from "e2b";
import { prisma } from "@/lib/prisma";
import { log } from "@/worker/lib/log";
import {
  buildProjectEnv,
  gatewayUsable,
  restartAppServer,
  writeEnvFile,
} from "@/worker/lib/aiEnv";
import { keyEncryptionConfigured } from "@/lib/apiKeys";
import { persistFile } from "./utils";
import { toTemplateKey, TEMPLATES } from "@/worker/templates/registry";
import { migrateTemplate, type MigrateOutcome } from "@/worker/lib/migrateTemplate";
import { addBackend } from "@/worker/lib/appStack";
import { guideText } from "../../docs";

/** The env vars a deployed app will need, declared for the deploy flow. */
const DEPLOY_MANIFEST_PATH = ".tau/deploy.json";

interface DeployManifest {
  envRequired?: {
    key: string;
    description: string;
    secret?: boolean;
    managed?: string;
  }[];
}

/**
 * Merge the tau-managed entries into `.tau/deploy.json` without clobbering
 * anything the agent put there. `managed: "tau"` tells the deploy flow to
 * resolve the value itself rather than prompting the user for it
 * (doc/AI_FOR_GENERATED_APPS.md §10).
 *
 * This file IS persisted — it contains no secret, only the names of the vars.
 */
async function upsertDeployManifest(
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
): Promise<void> {
  let manifest: DeployManifest = {};
  try {
    const existing = await sandbox.files.read(
      `/home/user/app/${DEPLOY_MANIFEST_PATH}`,
    );
    manifest = JSON.parse(existing) as DeployManifest;
  } catch {
    // No manifest yet, or it is unparseable — start clean rather than fail the
    // tool over a file the user never sees.
  }

  const managed = [
    {
      key: "TAU_API_KEY",
      description: "tau AI credential",
      secret: true,
      managed: "tau",
    },
    {
      key: "TAU_AI_URL",
      description: "tau AI base URL (fetch surface)",
      managed: "tau",
    },
    {
      key: "TAU_API_URL",
      description: "tau AI base URL (OpenAI-compatible surface)",
      managed: "tau",
    },
  ];

  const others = (manifest.envRequired ?? []).filter(
    (e) => !managed.some((m) => m.key === e.key),
  );
  const body = JSON.stringify(
    { ...manifest, envRequired: [...others, ...managed] },
    null,
    2,
  );

  await sandbox.files.write(`/home/user/app/${DEPLOY_MANIFEST_PATH}`, body);
  await persistFile(
    jobId,
    projectId,
    userId,
    DEPLOY_MANIFEST_PATH,
    body,
    indexer,
  );
}

/**
 * Turn on AI features for this project: mint/fetch the user's key, inject it
 * into the running sandbox, record the deploy requirement, and hand the agent a
 * usage recipe.
 *
 * Idempotent — calling it twice just re-injects.
 */
export async function enableAi(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  const { purpose } = (input ?? {}) as { purpose?: unknown };

  if (!keyEncryptionConfigured()) {
    return {
      error:
        "AI features are not available on this tau instance. Tell the user this app cannot call an AI model, and build the rest of the request without it.",
    };
  }

  // Checked before anything is minted or written. The failure this prevents is
  // the expensive one: an app that looks wired up, that the user is told works,
  // and that 502s on every AI call because the address it was given is not
  // reachable from the sandbox it runs in.
  const reachable = gatewayUsable();
  if (!reachable.ok) {
    log.error("ai.enable_refused", {
      jobId,
      projectId,
      reason: reachable.reason,
      detail: reachable.detail,
    });
    return {
      error:
        "The tau AI gateway is not reachable from this sandbox, so AI features cannot be turned on right now. This is a configuration problem on tau's side, not something you or the user can work around — do NOT try another provider, do NOT ask the user for an API key, and do NOT write code that calls a model. Tell the user plainly that AI is unavailable on this instance, then build the rest of what they asked for without it.",
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { templateKey: true, aiEnabled: true },
  });
  if (!project) return { error: `Project ${projectId} not found` };

  // The key has to live somewhere only the server can read it. A frontend-only
  // app has no server — so give it one, rather than refusing. This is a real
  // sandbox rebuild, which is why the tool reports it loudly instead of doing it
  // silently (doc/AI_FOR_GENERATED_APPS.md §7.3).
  const template = TEMPLATES[toTemplateKey(project.templateKey)];
  let migrated: MigrateOutcome | null = null;
  let backendAdded = false;

  if (!template.hasServer && template.generation === 2) {
    // Generation 2: the backend is added to the running sandbox, so there is no
    // rebuild and no second call — this one carries straight on. Not started
    // here: the restart further down does that, after `.env` is written, so
    // the server's first boot already has the key.
    const added = await addBackend(
      { sandbox, projectId, userId, jobId, indexer },
      { start: false },
    );
    if (!added.ok) {
      return {
        error: `AI features need a server, and setting one up for this app failed: ${added.error} Do NOT call a model from frontend code and do NOT ask the user for an API key. Tell the user plainly that AI could not be turned on, then build the rest of what they asked for without it.`,
      };
    }
    backendAdded = true;
  } else if (!template.hasServer) {
    migrated = await migrateTemplate(projectId, userId);

    if (!migrated.migrated && migrated.reason === "hand_rolled_server") {
      return {
        error: `This app is frontend-only but already has its own \`server/\` directory, so tau cannot safely add the standard backend on top of it. ${migrated.detail} Tell the user what you found and ask whether to remove it first — do not merge or overwrite it yourself.`,
      };
    }

    if (migrated.migrated) {
      // The sandbox is now marked DEAD and the manifest has changed underneath
      // us, so the currently-connected sandbox is stale. Everything below —
      // writing .env, restarting Hono — would land on a sandbox that is about to
      // be replaced. Stop here and make the agent come back after a reprovision.
      return {
        migrated: true,
        needsReprovision: true,
        changed: migrated.changed,
        ...(migrated.notes.length > 0 ? { warnings: migrated.notes } : {}),
        message:
          "This app was frontend-only, so it is being given a backend (a Hono server) — that is the only place an AI key can live safely. TELL THE USER this is happening and that their app is being rebuilt; it takes a moment and the preview will reload. Then call `provision_sandbox` to boot the new stack, and call `enable_ai` again to finish turning AI on. The existing UI and all their files are preserved.",
      };
    }
  }

  // The whole .env is rewritten, so build it with the user's own keys too —
  // writing only the AI vars would wipe every key they already supplied.
  const vars = await buildProjectEnv(userId, projectId, jobId, { aiEnabled: true });
  await writeEnvFile(sandbox, vars);

  await prisma.project.update({
    where: { id: projectId },
    data: { aiEnabled: true },
  });

  await upsertDeployManifest(sandbox, jobId, projectId, userId, indexer);

  // The server is already running and read its environment at boot, so it will
  // not see the new .env without this.
  await restartAppServer(sandbox, jobId);

  log.info("ai.enabled", {
    jobId,
    projectId,
    purpose: typeof purpose === "string" ? purpose.slice(0, 200) : null,
    alreadyEnabled: project.aiEnabled,
  });

  return {
    success: true,
    // Named so the agent can talk about them; the VALUES are never returned —
    // the model has no reason to see the key and every reason not to.
    envVars: ["TAU_API_KEY", "TAU_AI_URL", "TAU_PROJECT_ID"],
    endpoint: "POST ${TAU_AI_URL}/chat",
    models: ["tau-fast", "tau-smart", "tau-max"],
    ...(backendAdded
      ? {
          backendAdded:
            "This app had no server, so one was set up in place: `server/index.ts`, a Hono API the frontend reaches at `/api/*`. Nothing was rebuilt and the existing UI is untouched. Add the AI route there, as the recipe shows.",
        }
      : {}),
    // docs/ai.md — the same text `read_doc("ai")` returns, so there is one
    // copy of the recipe to keep right.
    recipe: guideText("ai"),
  };
}
