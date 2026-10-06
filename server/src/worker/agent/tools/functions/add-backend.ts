import type Sandbox from "e2b";
import { addBackend } from "@/worker/lib/appStack";
import { readDoc } from "../../docs";

/**
 * `add_backend`: give a generation-2 app a Hono API, in place.
 *
 * The setup is `lib/appStack.ts`; this adds the part the model needs — the
 * routing guide, returned here rather than kept in the system prompt, so it is
 * paid for once, when a backend is actually being written, instead of on every
 * turn of every app. Calling it again on an app that already has a backend
 * changes nothing and returns the guide, which is how the agent gets it back
 * in a later run.
 */
export async function addBackendTool(
  _input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  const result = await addBackend({ sandbox, projectId, userId, jobId, indexer });
  if (!result.ok) return { error: result.error };

  return {
    success: true,
    ...(result.alreadySetUp
      ? { alreadySetUp: true }
      : { changed: result.changed }),
    serverRunning: result.serverRunning,
    ...(result.notes.length > 0 ? { warnings: result.notes } : {}),
    guide: readDoc("backend"),
  };
}
