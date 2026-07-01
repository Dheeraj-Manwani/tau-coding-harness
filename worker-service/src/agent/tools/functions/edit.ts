import type Sandbox from "e2b";
import {
  asString,
  CHUNK_SIZE,
  chunkString,
  persistFile,
  toRelativePath,
} from "./utils";
import { publish } from "@/lib/publish";

export async function editFile(
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
