import type Sandbox from "e2b";
import { addDatabase } from "@/worker/lib/appStack";
import { guideText } from "../../docs";

/**
 * `add_database`: give a generation-2 app a PGlite + Drizzle database, in
 * place, adding the backend first if the app has none.
 *
 * Returns the database guide for the same reason `add_backend` returns the
 * routing one (see add-backend.ts). The backend guide comes along too when this
 * call is what created the backend, since the agent has not seen it yet.
 */
export async function addDatabaseTool(
  _input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  const result = await addDatabase({ sandbox, projectId, userId, jobId, indexer });
  if (!result.ok) return { error: result.error };

  return {
    success: true,
    ...(result.alreadySetUp
      ? { alreadySetUp: true }
      : { changed: result.changed }),
    serverRunning: result.serverRunning,
    ...(result.notes.length > 0 ? { warnings: result.notes } : {}),
    guide: guideText("database"),
    ...(result.backendAdded ? { backendGuide: guideText("backend") } : {}),
  };
}
