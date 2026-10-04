import { prisma } from "@/lib/prisma";
import type {
  Prisma,
  Project,
  Message,
  Job,
  Fragment,
} from "@/generated/prisma/client";
import { JobStatus, MessageType } from "@/generated/prisma/enums";

export function createProject(
  tx: Prisma.TransactionClient,
  data: { name: string; userId: string },
): Promise<Project> {
  return tx.project.create({ data });
}

export function createMessage(
  tx: Prisma.TransactionClient,
  data: {
    projectId: string;
    role: Prisma.MessageCreateInput["role"];
    type: Prisma.MessageCreateInput["type"];
    content: Prisma.InputJsonValue;
    sequence: number;
    jobId?: string;
  },
): Promise<Message> {
  const { projectId, jobId, ...rest } = data;
  return tx.message.create({
    data: {
      ...rest,
      project: { connect: { id: projectId } },
      ...(jobId ? { job: { connect: { id: jobId } } } : {}),
    },
  });
}

export function createJob(
  tx: Prisma.TransactionClient,
  data: {
    projectId: string;
    prompt: string;
    type: Prisma.JobCreateInput["type"];
    effort?: Prisma.JobCreateInput["effort"];
  },
): Promise<Job> {
  const { projectId, ...rest } = data;
  return tx.job.create({
    data: { ...rest, project: { connect: { id: projectId } } },
  });
}

export function setJobQueueId(jobId: string, queueJobId: string): Promise<Job> {
  return prisma.job.update({
    where: { id: jobId },
    data: { queueJobId },
  });
}

export function findProjectById(id: string): Promise<Project | null> {
  return prisma.project.findUnique({ where: { id } });
}

export function updateProject(
  projectId: string,
  data: { name?: string; description?: string | null; tags?: string[] },
): Promise<Project> {
  return prisma.project.update({ where: { id: projectId }, data });
}

export function countProjectsByUser(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  return client.project.count({ where: { userId } });
}

export async function listProjectsByUser(
  userId: string,
  opts: { cursor?: string; limit: number; search?: string },
): Promise<{ projects: Project[]; nextCursor: string | null }> {
  const rows = await prisma.project.findMany({
    where: {
      userId,
      ...(opts.search ? { OR: [
        { name: { contains: opts.search, mode: "insensitive" as const } },
        { description: { contains: opts.search, mode: "insensitive" as const } },
      ] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > opts.limit;
  const projects = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (projects.at(-1)?.id ?? null) : null;
  return { projects, nextCursor };
}

export function findActiveJob(
  projectId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Job | null> {
  return client.job.findFirst({
    where: {
      projectId,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
    },
  });
}

/**
 * Rows the chat transcript is built from.
 *
 * USER_EDIT rows are hidden by design — they exist only to tell the model about
 * a manual edit (doc/USER_CODE_EDITING.md). Excluding them here rather than
 * client-side matters for correctness, not just bytes: every feed query below is
 * `take: limit`, so hidden rows would eat the page window and silently push real
 * messages out of the transcript.
 */
const CHAT_MESSAGE_TYPES = {
  type: { not: MessageType.USER_EDIT },
} satisfies Prisma.MessageWhereInput;

/** Enough to render a chip. `extractedText` is excluded on purpose — up to
 *  500KB per paste that the bubble never shows; the modal fetches it on demand.
 *  `preview` is the denormalised first 240 chars, which a paste chip DOES show. */
const ATTACHMENT_SUMMARY = {
  select: {
    id: true,
    kind: true,
    status: true,
    filename: true,
    mimeType: true,
    sizeBytes: true,
    extractionError: true,
    preview: true,
  },
  orderBy: { createdAt: "asc" },
} satisfies Prisma.Message$attachmentsArgs;

export type MessageWithAttachments = Message & {
  attachments: {
    id: string;
    kind: string;
    status: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    extractionError: string | null;
    preview: string | null;
  }[];
};

export async function findRecentMessages(
  projectId: string,
  limit: number,
): Promise<MessageWithAttachments[]> {
  const rows = await prisma.message.findMany({
    where: { projectId, ...CHAT_MESSAGE_TYPES },
    orderBy: { sequence: "desc" },
    take: limit,
    include: { attachments: ATTACHMENT_SUMMARY },
  });
  return rows.reverse();
}

export async function findMessagesBefore(
  projectId: string,
  beforeSequence: number,
  limit: number,
): Promise<{ messages: MessageWithAttachments[]; hasMore: boolean }> {
  const rows = await prisma.message.findMany({
    where: { projectId, sequence: { lt: beforeSequence }, ...CHAT_MESSAGE_TYPES },
    orderBy: { sequence: "desc" },
    take: limit + 1,
    include: { attachments: ATTACHMENT_SUMMARY },
  });
  const hasMore = rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows).reverse();
  return { messages, hasMore };
}

export async function listMessages(
  projectId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ messages: MessageWithAttachments[]; nextCursor: string | null }> {
  const rows = await prisma.message.findMany({
    where: { projectId, ...CHAT_MESSAGE_TYPES },
    orderBy: { sequence: "asc" },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { attachments: ATTACHMENT_SUMMARY },
  });

  const hasMore = rows.length > opts.limit;
  const messages = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (messages.at(-1)?.id ?? null) : null;
  return { messages, nextCursor };
}

export function findCheckpointsInRange(
  projectId: string,
  gteSeq: number,
  lteSeq: number,
) {
  return prisma.contextCheckpoint.findMany({
    where: { projectId, upToSequence: { gte: gteSeq, lte: lteSeq } },
    orderBy: { upToSequence: "asc" },
    select: {
      id: true,
      upToSequence: true,
      summary: true,
      tokensBefore: true,
      tokensAfter: true,
      createdAt: true,
    },
  });
}

export function findLatestFragment(
  projectId: string,
): Promise<Fragment | null> {
  return prisma.fragment.findFirst({
    where: { message: { projectId } },
    orderBy: { createdAt: "desc" },
  });
}

export function findProjectWithTree(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      files: {
          select: { path: true, sizeBytes: true, contentHash: true },
        orderBy: { path: "asc" },
      },
    },
  });
}

export function findProjectFileRecord(projectId: string, path: string) {
  return prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { contentHash: true },
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // TokenUsage has onDelete: Restrict, so remove it before the project.
    await tx.tokenUsage.deleteMany({ where: { projectId } });
    await tx.project.delete({ where: { id: projectId } });
  });
}
