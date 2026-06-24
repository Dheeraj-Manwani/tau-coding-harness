import { CommandExitError } from "e2b";
import type { Sandbox } from "../lib/sandbox";
import { publish } from "../lib/publish";

const CHUNK_SIZE = 80;

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

async function createFile(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  indexer: () => number,
) {
  const { path, content } = input as { path?: unknown; content?: unknown };
  const p = asString(path, "path");
  const c = asString(content, "content");

  await publish(jobId, { type: "file_start", path: p }, indexer());

  await sandbox.files.write(p, c);

  for (const chunk of chunkString(c, CHUNK_SIZE)) {
    await publish(
      jobId,
      { type: "file_chunk", path: p, content: chunk },
      indexer(),
    );
  }

  await publish(jobId, { type: "file_done", path: p }, indexer());
  return { success: true, path: p };
}

async function readFile(input: unknown, sandbox: Sandbox) {
  const p = asString((input as { path?: unknown }).path, "path");
  const content = await sandbox.files.read(p);
  return { content };
}

async function deleteFile(input: unknown, sandbox: Sandbox) {
  const p = asString((input as { path?: unknown }).path, "path");
  await sandbox.files.remove(p);
  return { success: true, path: p };
}

async function runCommand(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  indexer: () => number,
) {
  const command = asString((input as { command?: unknown }).command, "command");

  const onStdout = (line: string) =>
    publish(jobId, { type: "shell_output", stream: "stdout", line }, indexer());
  const onStderr = (line: string) =>
    publish(jobId, { type: "shell_output", stream: "stderr", line }, indexer());

  if (isLongRunning(command)) {
    const handle = await sandbox.commands.run(command, {
      onStdout,
      onStderr,
      background: true,
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
    const result = await sandbox.commands.run(command, { onStdout, onStderr });
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
  sandbox: Sandbox,
  jobId: string,
  indexer: () => number,
): Promise<unknown> {
  switch (name) {
    case "create_file":
      return createFile(input, sandbox, jobId, indexer);
    case "read_file":
      return readFile(input, sandbox);
    case "delete_file":
      return deleteFile(input, sandbox);
    case "run_command":
      return runCommand(input, sandbox, jobId, indexer);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
