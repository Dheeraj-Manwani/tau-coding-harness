import { createHash } from "crypto";
import { CommandExitError } from "e2b";
import { provisionSandbox } from "../lib/sandbox";
import type { Sandbox } from "../lib/sandbox";
import { publish } from "../lib/publish";
import { redis } from "../lib/redis";
import type { SandboxRef } from "./loop";
import { prisma } from "../lib/prisma";
import { putBlob } from "../lib/s3";
import { allocateHeadSequence } from "../lib/headSequence";

const CHUNK_SIZE = 80;
const WORK_DIR = "/home/user/app";

/** Strip the sandbox WORK_DIR prefix so all stored/published paths are relative. */
function toRelativePath(p: string): string {
  return p.startsWith(`${WORK_DIR}/`) ? p.slice(WORK_DIR.length + 1) : p;
}

function chunkString(s: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += size) {
    chunks.push(s.slice(i, i + size));
  }
  return chunks;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Tool input '${field}' must be a string`);
  }
  return value;
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function isLongRunning(command: string): boolean {
  return (
    /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/.test(
      command,
    ) ||
    /\bvite\b/.test(command) ||
    /\bnext\s+(dev|start)\b/.test(command) ||
    /--port\b/.test(command)
  );
}

async function persistFile(
  jobId: string,
  projectId: string,
  userId: string,
  path: string,
  content: string,
  indexer: () => number,
): Promise<void> {
  const hash = sha256Hex(content);
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  const existing = await prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { contentHash: true },
  });

  if (existing?.contentHash === hash) {
    await publish(jobId, { type: "file_done", path }, indexer());
    return;
  }

  await putBlob(userId, projectId, hash, content);

  const seq = await prisma.$transaction(async (tx) => {
    const s = await allocateHeadSequence(tx, projectId);
    await tx.projectFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: {
        projectId,
        path,
        contentHash: hash,
        sizeBytes,
        lastSequence: s,
      },
      update: { contentHash: hash, sizeBytes, lastSequence: s },
    });
    return s;
  });

  await publish(
    jobId,
    { type: "file_done", path, headSequence: seq },
    indexer(),
  );
}

async function createFile(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  const { path, content } = input as { path?: unknown; content?: unknown };
  const p = asString(path, "path");
  const c = asString(content, "content");

  const relPath = toRelativePath(p);
  await publish(jobId, { type: "file_start", path: relPath }, indexer());

  await sandbox.files.write(p, c);

  for (const chunk of chunkString(c, CHUNK_SIZE)) {
    await publish(
      jobId,
      { type: "file_chunk", path: relPath, content: chunk },
      indexer(),
    );
  }

  await persistFile(jobId, projectId, userId, relPath, c, indexer);
  return { success: true, path: p };
}

async function editFile(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  const { path, old_string, new_string, replace_all } = input as {
    path?: unknown;
    old_string?: unknown;
    new_string?: unknown;
    replace_all?: unknown;
  };
  const p = asString(path, "path");
  const oldStr = asString(old_string, "old_string");
  const newStr = asString(new_string, "new_string");
  const replaceAll = replace_all === true;

  const original = await sandbox.files.read(p);

  const occurrences = original.split(oldStr).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_string not found in ${p}`);
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(
      `old_string is not unique in ${p} (${occurrences} matches); set replace_all to true or provide more context`,
    );
  }

  const updated = replaceAll
    ? original.split(oldStr).join(newStr)
    : original.replace(oldStr, newStr);

  const relPath = toRelativePath(p);
  await publish(jobId, { type: "file_start", path: relPath }, indexer());

  await sandbox.files.write(p, updated);

  for (const chunk of chunkString(updated, CHUNK_SIZE)) {
    await publish(
      jobId,
      { type: "file_chunk", path: relPath, content: chunk },
      indexer(),
    );
  }

  await persistFile(jobId, projectId, userId, relPath, updated, indexer);
  return { success: true, path: p, replacements: replaceAll ? occurrences : 1 };
}

async function readFile(input: unknown, sandbox: Sandbox) {
  const p = asString((input as { path?: unknown }).path, "path");
  const content = await sandbox.files.read(p);
  return { content };
}

async function deleteFile(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  indexer: () => number,
) {
  const p = asString((input as { path?: unknown }).path, "path");
  const relPath = toRelativePath(p);
  await sandbox.files.remove(p);

  // Invariant 3: remove manifest row + bump headSequence in one tx; blob is left untouched.
  const existing = await prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path: relPath } },
    select: { id: true },
  });

  if (existing) {
    const seq = await prisma.$transaction(async (tx) => {
      await tx.projectFile.delete({
        where: { projectId_path: { projectId, path: relPath } },
      });
      return allocateHeadSequence(tx, projectId);
    });
    await publish(
      jobId,
      { type: "file_delete", path: relPath, headSequence: seq },
      indexer(),
    );
  }

  return { success: true, path: p };
}

async function createPlan(
  input: unknown,
  jobId: string,
  indexer: () => number,
) {
  const { name, description, todos } = input as {
    name?: unknown;
    description?: unknown;
    todos?: unknown;
  };
  const planName = asString(name, "name");
  const planDescription = asString(description, "description");
  const todoList =
    typeof todos === "string" && todos.trim()
      ? todos
          .split(/[,，;]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  await publish(
    jobId,
    {
      type: "plan_created",
      name: planName,
      description: planDescription,
      todos: todoList,
    },
    indexer(),
  );
  return { success: true };
}

async function updateTodo(
  input: unknown,
  jobId: string,
  indexer: () => number,
) {
  const { sno, status } = input as { sno?: unknown; status?: unknown };
  if (typeof sno !== "number")
    throw new Error("Tool input 'sno' must be a number");
  const todoStatus = asString(status, "status");

  await publish(
    jobId,
    { type: "todo_updated", sno, status: todoStatus },
    indexer(),
  );
  return { success: true };
}

async function runCommand(input: unknown, sandbox: Sandbox) {
  const command = asString((input as { command?: unknown }).command, "command");

  if (isLongRunning(command)) {
    const handle = await sandbox.commands.run(command, {
      background: true,
      cwd: WORK_DIR,
    });
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      background: true,
      pid: handle.pid,
    };
  }

  try {
    const result = await sandbox.commands.run(command, { cwd: WORK_DIR });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err) {
    if (err instanceof CommandExitError) {
      return {
        exitCode: err.exitCode,
        stdout: err.stdout,
        stderr: err.stderr,
      };
    }
    throw err;
  }
}

export async function executeTool(
  name: string,
  input: unknown,
  sandboxRef: SandboxRef,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
): Promise<unknown> {
  console.log("tool call :: ", name, input);

  switch (name) {
    case "ask_user": {
      const { question, options } = input as {
        question?: unknown;
        options?: unknown;
      };
      const q = asString(question, "question");
      const opts = Array.isArray(options)
        ? (options as unknown[]).map((o) => asString(o, "options[]"))
        : [];

      await publish(jobId, { type: "ask_user", question: q, options: opts }, indexer());

      const responseKey = `job:${jobId}:user_response`;
      const conn = redis.duplicate();
      try {
        const result = await conn.blpop(responseKey, 600); // 10 min timeout
        if (!result) return { answer: null, timedOut: true };
        const { answer } = JSON.parse(result[1]) as { answer: string };

        // The answer is returned as this tool call's result and persisted as
        // part of the standard TOOL_RES row by the agent loop — no separate
        // USER message row here, or the UI would render it twice.
        return { answer };
      } finally {
        await conn.quit();
      }
    }
    case "provision_sandbox": {
      if (!sandboxRef.current) {
        sandboxRef.current = await provisionSandbox(projectId, userId, jobId);
      }
      return { success: true };
    }
    case "create_plan":
      return createPlan(input, jobId, indexer);
    case "update_todo":
      return updateTodo(input, jobId, indexer);
    case "report_progress":
    case "report_plan":
      return { success: true };
    default:
      break;
  }

  const sandbox = sandboxRef.current;
  if (!sandbox) {
    return { error: "Sandbox not provisioned. Call provision_sandbox first." };
  }

  switch (name) {
    case "create_file":
      return createFile(input, sandbox, jobId, projectId, userId, indexer);
    case "edit_file":
      return editFile(input, sandbox, jobId, projectId, userId, indexer);
    case "read_file":
      return readFile(input, sandbox);
    case "delete_file":
      return deleteFile(input, sandbox, jobId, projectId, indexer);
    case "run_command":
      return runCommand(input, sandbox);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
