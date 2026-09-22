import { prisma } from "@/lib/prisma";

// Avoid one no-op UPDATE for every subsequent file in the same worker process.
// The database predicate remains the authority across restarts/processes.
const markedProjects = new Set<string>();

/** Persist the project's one-way transition from chat-only to workspace mode. */
export async function markProjectWorkspaceStarted(
  projectId: string,
): Promise<void> {
  if (markedProjects.has(projectId)) return;

  await prisma.project.updateMany({
    where: { id: projectId, workspaceStartedAt: null },
    data: { workspaceStartedAt: new Date() },
  });
  markedProjects.add(projectId);
}
