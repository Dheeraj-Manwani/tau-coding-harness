/**
 * `.tau/deploy.json`: the env vars a deployed app will need, declared for the
 * deploy flow (doc/AI_FOR_GENERATED_APPS.md §10). Written by more than one tool
 * (`enable_ai`, `enable_storage`), so each merges its own entries and leaves the
 * rest alone.
 */
import type Sandbox from "e2b";
import { persistFile } from "../agent/tools/functions/utils";

const DEPLOY_MANIFEST_PATH = ".tau/deploy.json";

export interface DeployEnvEntry {
  key: string;
  description: string;
  secret?: boolean;
  managed?: string;
}

interface DeployManifest {
  envRequired?: DeployEnvEntry[];
}

export const AI_ENV_ENTRIES: DeployEnvEntry[] = [
  { key: "TAU_API_KEY", description: "tau AI credential", secret: true, managed: "tau" },
  { key: "TAU_AI_URL", description: "tau AI base URL (fetch surface)", managed: "tau" },
  { key: "TAU_API_URL", description: "tau AI base URL (OpenAI-compatible surface)", managed: "tau" },
];

export const STORAGE_ENV_ENTRIES: DeployEnvEntry[] = [
  { key: "TAU_STORAGE_KEY", description: "tau Cloud Storage credential", secret: true, managed: "tau" },
  { key: "TAU_STORAGE_URL", description: "tau Cloud Storage base URL", managed: "tau" },
];

/**
 * Merge `entries` into the manifest without clobbering anything else in it.
 * `managed: "tau"` tells the deploy flow to resolve the value itself rather
 * than prompting the user for it.
 *
 * This file IS persisted — it contains no secret, only the names of the vars.
 */
export async function upsertDeployManifest(
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
  entries: DeployEnvEntry[],
): Promise<void> {
  let manifest: DeployManifest = {};
  try {
    const existing = await sandbox.files.read(`/home/user/app/${DEPLOY_MANIFEST_PATH}`);
    manifest = JSON.parse(existing) as DeployManifest;
  } catch {
    // No manifest yet, or it is unparseable — start clean rather than fail the
    // tool over a file the user never sees.
  }

  const others = (manifest.envRequired ?? []).filter((e) => !entries.some((m) => m.key === e.key));
  const body = JSON.stringify({ ...manifest, envRequired: [...others, ...entries] }, null, 2);

  await sandbox.files.write(`/home/user/app/${DEPLOY_MANIFEST_PATH}`, body);
  await persistFile(jobId, projectId, userId, DEPLOY_MANIFEST_PATH, body, indexer);
}
