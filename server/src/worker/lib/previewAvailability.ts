import { bus } from "@/lib/bus";
import { prisma } from "@/lib/prisma";
import { getNextSequence } from "@/lib/sequence";
import { MessageRole, MessageType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { markProjectWorkspaceStarted } from "./projectWorkspace";
import { previewSupportsHealth } from "./previewReadiness";
import { publish } from "./publish";

/** Persist recovery before announcing it, so a refresh during the chat also
 * uses the replacement. Empty RESULT messages do not appear in the transcript. */
export async function announceAvailablePreview(jobId: string, projectId: string, url: string): Promise<void> {
  if (bus.isCancelled(jobId)) return;
  const existing = await prisma.fragment.findFirst({ where: { jobId, sandboxUrl: url }, select: { id: true } });
  if (existing) return; // The provisioner and preview-only runner share this path.
  const healthCheck = await previewSupportsHealth(url);
  if (bus.isCancelled(jobId)) return;
  await markProjectWorkspaceStarted(projectId);
  const fragment = await prisma.$transaction(async (tx) => {
    const sequence = await getNextSequence(tx, projectId);
    const message = await tx.message.create({
      data: {
        project: { connect: { id: projectId } }, job: { connect: { id: jobId } },
        role: MessageRole.ASSISTANT, type: MessageType.RESULT,
        content: { content: null } as unknown as Prisma.InputJsonValue, sequence,
      },
    });
    return tx.fragment.create({
      data: { message: { connect: { id: message.id } }, job: { connect: { id: jobId } }, sandboxUrl: url, title: "Preview" },
    });
  });
  if (!bus.isCancelled(jobId)) {
    await publish(jobId, { type: "preview_ready", url, healthCheck, restored: true, readyAt: fragment.createdAt.toISOString() });
  }
}
