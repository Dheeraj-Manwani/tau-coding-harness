import { prisma } from "../lib/prisma";
import type {
  Prisma,
  Project,
  Message,
  Job,
  Fragment,
} from "../generated/prisma/client";
import { JobStatus } from "../generated/prisma/enums";

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

export function findActiveJob(projectId: string): Promise<Job | null> {
  return prisma.job.findFirst({
    where: {
      projectId,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
    },
  });
}

export async function findRecentMessages(
  projectId: string,
  limit: number,
): Promise<Message[]> {
  const rows = await prisma.message.findMany({
    where: { projectId },
    orderBy: { sequence: "desc" },
    take: limit,
  });
  return rows.reverse();
}

export async function listMessages(
  projectId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const rows = await prisma.message.findMany({
    where: { projectId },
    orderBy: { sequence: "asc" },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > opts.limit;
  const messages = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (messages.at(-1)?.id ?? null) : null;
  return { messages, nextCursor };
}

export function findLatestFragment(
  projectId: string,
): Promise<Fragment | null> {
  return prisma.fragment.findFirst({
    where: { message: { projectId } },
    orderBy: { createdAt: "desc" },
  });
}
