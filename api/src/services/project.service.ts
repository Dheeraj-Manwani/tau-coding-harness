import { Sandbox } from "e2b";
import { prisma } from "../lib/prisma";
import * as projectRepo from "../repositories/project.repository";
import { getNextSequence } from "../lib/sequence";
import { enqueueJob } from "../lib/queue";
import { deepseek } from "../lib/deepseek";
import { env } from "../lib/env";
import { Errors } from "../lib/errors";
import { getBlobText, deleteProjectBlobs } from "../lib/s3";
import {
  MessageRole,
  MessageType,
  JobType,
  SandboxStatus,
} from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";

const MAX_NAME_LENGTH = 80;

function clampName(name: string): string {
  return name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…`
    : name;
}

function deriveProjectName(message: string): string {
  const firstLine = message.trim().split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "Untitled project";
  return clampName(firstLine);
}

async function generateProjectName(message: string): Promise<string> {
  if (!deepseek) return deriveProjectName(message);
  try {
    const completion = await deepseek.chat.completions.create({
      model: env.DEEPSEEK_MODEL,
      temperature: 0.3,
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "You generate concise names for software projects. Given the user's first request, reply with ONLY a short, descriptive title of 3-6 words in Title Case. No quotes, no trailing punctuation, no explanation.",
        },
        { role: "user", content: message },
      ],
    });

    const raw = completion.choices[0]?.message.content?.trim();
    if (!raw) return deriveProjectName(message);

    const name = raw.replace(/^["']|["']$/g, "").trim();
    return name ? clampName(name) : deriveProjectName(message);
  } catch (err) {
    console.error("DeepSeek project naming failed; using fallback", err);
    return deriveProjectName(message);
  }
}

function userMessageContent(text: string): Prisma.InputJsonValue {
  return [{ type: "text", text }];
}

export interface InitializeProjectResult {
  projectId: string;
  jobId: string;
}

export async function initializeProject(
  userId: string,
  message: string,
): Promise<InitializeProjectResult> {
  const name = await generateProjectName(message);

  const { projectId, jobId } = await prisma.$transaction(async (tx) => {
    const project = await projectRepo.createProject(tx, {
      name,
      userId,
    });

    const job = await projectRepo.createJob(tx, {
      projectId: project.id,
      prompt: message,
      type: JobType.GENERATION,
    });

    const sequence = await getNextSequence(tx, project.id);
    await projectRepo.createMessage(tx, {
      projectId: project.id,
      role: MessageRole.USER,
      type: MessageType.USER,
      content: userMessageContent(message),
      sequence,
    });

    return { projectId: project.id, jobId: job.id };
  });

  const queueJobId = await enqueueJob({
    jobId,
    projectId,
    userId,
    prompt: message,
  });
  await projectRepo.setJobQueueId(jobId, queueJobId);

  return { projectId, jobId };
}

export interface AddMessageResult {
  jobId: string;
}

export async function addMessage(
  projectId: string,
  userId: string,
  content: string,
): Promise<AddMessageResult> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const active = await projectRepo.findActiveJob(projectId);
  if (active) throw Errors.conflict("generation in progress");

  const jobId = await prisma.$transaction(async (tx) => {
    const job = await projectRepo.createJob(tx, {
      projectId,
      prompt: content,
      type: JobType.GENERATION,
    });

    const sequence = await getNextSequence(tx, projectId);
    await projectRepo.createMessage(tx, {
      projectId,
      role: MessageRole.USER,
      type: MessageType.USER,
      content: userMessageContent(content),
      sequence,
    });

    return job.id;
  });

  const queueJobId = await enqueueJob({
    jobId,
    projectId,
    userId,
    prompt: content,
  });
  await projectRepo.setJobQueueId(jobId, queueJobId);

  return { jobId };
}

export async function listProjects(
  userId: string,
  opts: { cursor?: string; limit: number },
) {
  const { projects, nextCursor } = await projectRepo.listProjectsByUser(
    userId,
    opts,
  );

  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      sandboxStatus: p.sandboxStatus,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    nextCursor,
  };
}

export async function getProject(projectId: string, userId: string) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  const [messages, latestFragment, activeJob] = await Promise.all([
    projectRepo.findRecentMessages(projectId, 50),
    projectRepo.findLatestFragment(projectId),
    projectRepo.findActiveJob(projectId),
  ]);

  return {
    project,
    messages,
    latestFragment,
    activeJobId: activeJob?.id ?? null,
  };
}

export async function listMessages(
  projectId: string,
  userId: string,
  opts: { cursor?: string; before?: number; limit: number },
) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  if (opts.before !== undefined) {
    return projectRepo.findMessagesBefore(projectId, opts.before, opts.limit);
  }

  return projectRepo.listMessages(projectId, opts);
}

export async function getProjectTree(projectId: string, userId: string) {
  const project = await projectRepo.findProjectWithTree(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  return {
    files: project.files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes })),
    headSequence: project.headSequence,
  };
}

export async function deleteProject(
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }
  // Delete R2 blobs first; if this fails we abort before touching the DB.
  await deleteProjectBlobs(userId, projectId);
  await projectRepo.deleteProject(projectId);
}

export async function getProjectFile(
  projectId: string,
  userId: string,
  filePath: string,
) {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }

  // Sandbox-first: return live content when sandbox is up.
  const WORK_DIR = "/home/user/app";
  if (project.sandboxId && project.sandboxStatus === SandboxStatus.READY) {
    try {
      const sandbox = await Sandbox.connect(project.sandboxId);
      const absPath = filePath.startsWith("/")
        ? filePath
        : `${WORK_DIR}/${filePath}`;
      const content = await sandbox.files.read(absPath);
      return { content };
    } catch {
      // Sandbox unreachable — fall through to R2 blob.
    }
  }

  // R2 blob fallback via manifest hash.
  const record = await projectRepo.findProjectFileRecord(projectId, filePath);
  if (!record) throw Errors.notFound("File not found");

  const content = await getBlobText(userId, projectId, record.contentHash);
  return { content };
}
