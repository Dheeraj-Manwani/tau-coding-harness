import Sandbox, { FileType } from "e2b";
import { WORK_DIR } from "./utils";

const DEFAULT_DEPTH = 1;

export async function listDir(input: unknown, sandbox: Sandbox) {
  const { path: rawPath, depth: rawDepth } = input as {
    path?: unknown;
    depth?: unknown;
  };
  const path = typeof rawPath === "string" && rawPath.trim() ? rawPath : ".";
  const depth =
    typeof rawDepth === "number" && rawDepth > 0
      ? Math.floor(rawDepth)
      : DEFAULT_DEPTH;

  const entries = await sandbox.files.list(path, { depth });
  return {
    entries: entries.map((e) => ({
      name: e.name,
      path: e.path.startsWith(`${WORK_DIR}/`)
        ? e.path.slice(WORK_DIR.length + 1)
        : e.path,
      type: e.type === FileType.DIR ? "dir" : "file",
      size: e.size,
    })),
  };
}
