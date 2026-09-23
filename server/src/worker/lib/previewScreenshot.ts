import { JobType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/** A preview restart should refresh the cover only if it may be out of date. */
export async function previewNeedsScreenshot(projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { previewImageKey: true, previewImageUpdatedAt: true },
  });
  if (!project?.previewImageKey || !project.previewImageUpdatedAt) return true;

  const capturedAt = project.previewImageUpdatedAt;
  const [changedFile, newerGeneration] = await Promise.all([
    prisma.projectFile.findFirst({
      where: { projectId, updatedAt: { gt: capturedAt } },
      select: { id: true },
    }),
    // A generation may have deleted the last changed file, leaving no newer
    // ProjectFile row to detect. Preview/deploy jobs do not change app source.
    prisma.job.findFirst({
      where: {
        projectId,
        type: { in: [JobType.GENERATION, JobType.RECOVERY] },
        queuedAt: { gt: capturedAt },
      },
      select: { id: true },
    }),
  ]);

  return changedFile !== null || newerGeneration !== null;
}
