import type Sandbox from "e2b";
import { log } from "@/worker/lib/log";
import {
  isBinaryPath,
  isSecretPath,
  persistBinaryFile,
  persistFile,
  WORK_DIR,
} from "./utils";

/**
 * Keeping the files a shell command makes.
 *
 * The file tools save what they write as they write it. A shell command is
 * different: `bunx shadcn add dialog` writes `src/components/ui/dialog.tsx`,
 * `bun run gen` writes a data file, `curl -o` fetches an image, and none of it
 * is seen by anything that records files. It lives in the sandbox until the
 * sandbox is rebuilt, and then it is gone, along with every import of it. So
 * after each command, tau looks for what the command left behind and saves it.
 *
 * "What the command left behind" is found by time: a marker file is touched
 * just before, and `find -newer` lists what is newer after. That sees every
 * way a file can be made, without parsing commands, which would see only the
 * ones it was written to recognise.
 *
 * Saved is not the same as everything. Dependencies, build output, caches, logs
 * and secrets are not part of a project, and a runaway command must not fill
 * the project with whatever it spewed, so there are limits on how many files
 * and how many bytes.
 */

/** Where the marker goes. Outside the project, so it is never listed or saved. */
const MARKER = "/tmp/tau-command-start";

/** Directories that are not the project: found by prefix, anywhere in the tree. */
const SKIPPED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".vite",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".tau/logs",
];

/** Files that change with every run and mean nothing. */
const SKIPPED_FILE = /(\.tsbuildinfo|\.log|\.DS_Store|Thumbs\.db)$/i;

export const MAX_SHELL_FILES = 40;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_BINARY_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

export interface ChangedFile {
  path: string;
  size: number;
}

/** Whether a path, relative to the app, is part of the project. */
export function isProjectPath(path: string): boolean {
  if (!path || path.startsWith("/") || path.split("/").includes("..")) return false;
  if (SKIPPED_FILE.test(path)) return false;
  for (const dir of SKIPPED_DIRS) {
    if (path === dir || path.startsWith(`${dir}/`) || path.includes(`/${dir}/`)) return false;
  }
  return !isSecretPath(path.split("/").pop() ?? path) && !isSecretPath(path);
}

/** The output of `find … -printf "%s %P\n"`, as files. */
export function parseFound(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of output.split("\n")) {
    const m = /^(\d+) (.+)$/.exec(line.trimEnd());
    if (!m) continue;
    const path = m[2]!;
    if (isProjectPath(path)) files.push({ path, size: Number(m[1]) });
  }
  return files;
}

/** What of a list of changed files is saved, and what is left out and why. */
export function chooseFiles(files: readonly ChangedFile[]): {
  save: ChangedFile[];
  skipped: { path: string; why: string }[];
} {
  const save: ChangedFile[] = [];
  const skipped: { path: string; why: string }[] = [];
  let total = 0;
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const limit = isBinaryPath(file.path) ? MAX_BINARY_BYTES : MAX_TEXT_BYTES;
    if (file.size > limit) skipped.push({ path: file.path, why: `larger than ${limit / 1024 / 1024} MB` });
    else if (save.length >= MAX_SHELL_FILES) skipped.push({ path: file.path, why: `more than ${MAX_SHELL_FILES} files` });
    else if (total + file.size > MAX_TOTAL_BYTES) skipped.push({ path: file.path, why: "too much in all" });
    else {
      save.push(file);
      total += file.size;
    }
  }
  return { save, skipped };
}

/** Mark the moment before a command. Quietly does nothing if the sandbox cannot. */
export async function markBeforeCommand(sandbox: Sandbox): Promise<boolean> {
  try {
    await sandbox.commands.run(`touch ${MARKER}`, { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** The files the sandbox now has that are newer than the marker. */
export async function filesSinceMarker(sandbox: Sandbox): Promise<ChangedFile[]> {
  const skip = SKIPPED_DIRS.map((d) => `-not -path "./${d}/*" -not -path "*/${d}/*"`).join(" ");
  const found = await sandbox.commands.run(
    `find . -type f -newer ${MARKER} ${skip} -printf "%s %P\\n" 2>/dev/null | head -400`,
    { cwd: WORK_DIR, timeoutMs: 15_000 },
  );
  return parseFound(found.stdout);
}

export interface ShellSaveResult {
  saved: string[];
  skipped: { path: string; why: string }[];
}

/**
 * Save what the last command left behind. Never throws: a project that could not
 * be saved to is the same as one that never had this, and the command's own
 * result is what the agent is waiting for.
 */
export async function saveShellChanges(
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
): Promise<ShellSaveResult> {
  const result: ShellSaveResult = { saved: [], skipped: [] };
  try {
    const { save, skipped } = chooseFiles(await filesSinceMarker(sandbox));
    result.skipped = skipped;
    for (const file of save) {
      try {
        if (isBinaryPath(file.path)) {
          const bytes = await sandbox.files.read(`${WORK_DIR}/${file.path}`, { format: "bytes" });
          const { persisted } = await persistBinaryFile(jobId, projectId, userId, file.path, bytes, indexer);
          if (persisted) result.saved.push(file.path);
        } else {
          const text = await sandbox.files.read(`${WORK_DIR}/${file.path}`);
          // A file that is not text after all cannot be kept as text.
          if (text.includes("\0")) {
            result.skipped.push({ path: file.path, why: "not text" });
            continue;
          }
          const { persisted } = await persistFile(jobId, projectId, userId, file.path, text, indexer);
          if (persisted) result.saved.push(file.path);
        }
      } catch (err) {
        result.skipped.push({ path: file.path, why: "could not be read" });
        log.warn("job.shell_changes.file_failed", { jobId, projectId, path: file.path, error: String(err).slice(0, 160) });
      }
    }
  } catch (err) {
    log.warn("job.shell_changes.failed", { jobId, projectId, error: String(err).slice(0, 200) });
  }
  if (result.saved.length > 0 || result.skipped.length > 0) {
    log.info("job.shell_changes", { jobId, projectId, saved: result.saved.length, skipped: result.skipped.length });
  }
  return result;
}
