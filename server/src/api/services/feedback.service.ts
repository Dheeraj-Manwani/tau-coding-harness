import { prisma } from "@/lib/prisma";
import { presignGet } from "@/lib/s3";
import { Errors } from "../lib/errors";
import type { FeedbackInput } from "../schemas/feedback.schema";

export async function submitFeedback(userId: string, input: FeedbackInput) {
  const feedback = await prisma.$transaction(async (tx) => {
    if (input.projectId && !await tx.project.findFirst({ where: { id: input.projectId, userId }, select: { id: true } })) {
      throw Errors.notFound("Project not found");
    }
    const row = await tx.feedback.create({ data: {
      userId, rating: input.rating, kind: input.kind, message: input.message || null,
      projectId: input.projectId, source: input.source,
    } });
    if (input.attachmentIds.length) {
      // Atomic claiming prevents reuse in two feedback submissions or a chat.
      const claimed = await tx.attachment.updateMany({
        where: {
          id: { in: input.attachmentIds }, userId, messageId: null, feedbackId: null,
          status: { in: ["READY", "FAILED"] }, blobKey: { not: null },
        },
        data: { feedbackId: row.id },
      });
      if (claimed.count !== input.attachmentIds.length) {
        throw Errors.badRequest("Some files are unavailable or still uploading. Remove them or try again.");
      }
    }
    return row;
  });
  const redeemed = await prisma.promoRedemption.findFirst({ where: { userId, code: { code: "EXTRA100" } }, select: { id: true } });
  return { id: feedback.id, promoCode: "EXTRA100", credits: 100, alreadyRedeemed: Boolean(redeemed) };
}

export async function listFeedback(cursor?: string) {
  const rows = await prisma.feedback.findMany({
    take: 51, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { email: true } }, attachments: true },
  });
  const entries = await Promise.all(rows.slice(0, 50).map(async (row) => ({
    ...row,
    attachments: await Promise.all(row.attachments.map(async (file) => ({
      id: file.id, filename: file.filename, mimeType: file.mimeType,
      url: file.blobKey ? await presignGet(file.blobKey) : null,
    }))),
  })));
  return { entries, nextCursor: rows.length > 50 ? entries.at(-1)!.id : null };
}
