import type Sandbox from "e2b";
import {
  asString,
  CHUNK_SIZE,
  chunkString,
  persistFile,
  toRelativePath,
} from "./utils";
import { publish } from "@/lib/publish";

export async function createFile(
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
