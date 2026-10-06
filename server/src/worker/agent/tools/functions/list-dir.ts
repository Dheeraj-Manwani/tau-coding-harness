import Sandbox, { FileType } from "e2b";
import { toWorkdirPath, WORK_DIR } from "./utils";
import { MAX_DIR_ENTRIES } from "./output";

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

  const entries = await sandbox.files.list(toWorkdirPath(path), { depth });
  // A deep listing that wanders into node_modules is tens of thousands of
  // entries. Cap it, and say so, rather than hand all of that to the model.
  const shown = entries.slice(0, MAX_DIR_ENTRIES);
  return {
    entries: shown.map((e) => ({
      name: e.name,
      path: e.path.startsWith(`${WORK_DIR}/`)
        ? e.path.slice(WORK_DIR.length + 1)
        : e.path,
      type: e.type === FileType.DIR ? "dir" : "file",
      size: e.size,
    })),
    ...(entries.length > shown.length
      ? {
          truncated: true,
          note: `Showing the first ${shown.length} of ${entries.length} entries. List a narrower path or a smaller depth, or use grep to find a file by its contents.`,
        }
      : {}),
  };
}
